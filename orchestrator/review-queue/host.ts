// The review queue's host handlers (2026-11-18, ported from a contributor's public PR): gh on the connected machine,
// with that machine's own login. Every call is a queueArgs list (core/review-queue.ts) run with execFile, never a
// shell, and gh's errors leave with tokens redacted.
//
// The plugin's only GitHub write is in post() below: one queueArgs.trigger call, after identity, head and eligibility
// are re-read here on the machine that holds the credential, and after the dry-run return.
import { execFile } from "node:child_process";
import { z } from "zod";
import { redact } from "../cloud/core/mask.ts";
import { reviewState } from "../core/open-prs.ts";
import { assess, CODERABBIT, cooldownUntil, parsePrUrl, queueArgs, replyOutcome, TRIGGER, type Comment, type Facts } from "../core/review-queue.ts";

type Result = { stdout: string; stderr: string; code: number };
export type Run = (args: string[], signal?: AbortSignal) => Promise<Result>;

const GH_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})/g;
const clean = (s: string) => redact(s.replace(GH_TOKEN, "[redacted]")).slice(0, 800);

/** gh with its exit code kept: `gh pr checks` answers pending with 8, and post() reads a failed write's stderr. */
const gh: Run = (args, signal) =>
  new Promise((resolve, reject) => {
    execFile("gh", args, { signal, timeout: 45_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } }, (e, stdout, stderr) => {
      if (signal?.aborted) return reject(new Error("GitHub read cancelled"));
      resolve({ stdout, stderr: clean(stderr), code: e ? Number(e.code) || 1 : 0 });
    });
  });

const user = z.object({ login: z.string(), type: z.string() });
const review = z.object({ user: user.nullable(), state: z.string(), commit_id: z.string(), submitted_at: z.string().nullable() });
const comment = z.object({ user: user.nullable(), body: z.string(), created_at: z.string(), updated_at: z.string(), html_url: z.string() });
const pull = z.object({
  title: z.string(),
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  draft: z.boolean(),
  head: z.object({ sha: z.string().min(1) }),
  user,
  mergeable: z.boolean().nullable(),
  mergeable_state: z.string(),
});
const threadsPage = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({ nodes: z.array(z.object({ isResolved: z.boolean() })), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
      }),
    }),
  }),
  errors: z.array(z.unknown()).optional(),
});
const stamp = (s: string | null) => (s ? Date.parse(s) || 0 : 0);

export function makeQueueGitHub(run: Run = gh) {
  async function json(args: string[], signal?: AbortSignal): Promise<unknown> {
    const r = await run(args, signal);
    if (r.code) throw new Error(`GitHub read failed: ${r.stderr}`);
    return JSON.parse(r.stdout);
  }
  /** Every page, up to 2,000 records; more than that is an error, never a partial answer. */
  async function pages(page: (n: number) => string[], signal?: AbortSignal): Promise<unknown[]> {
    const all: unknown[] = [];
    for (let n = 1; n <= 20; n++) {
      const rows = z.array(z.unknown()).parse(await json(page(n), signal));
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw new Error("GitHub pagination limit reached; no trigger from incomplete facts");
  }
  async function identity(signal?: AbortSignal): Promise<string> {
    return user.parse(await json(queueArgs.user(), signal)).login;
  }
  async function comments(url: string, signal?: AbortSignal): Promise<Comment[]> {
    const { repo, number } = parsePrUrl(url);
    return z
      .array(comment)
      .parse(await pages((n) => queueArgs.comments(repo, number, n), signal))
      .map((c) => ({ author: c.user?.login ?? "", body: c.body, at: stamp(c.created_at), updatedAt: stamp(c.updated_at), url: c.html_url }));
  }
  async function unresolvedThreads(repo: string, number: number, signal?: AbortSignal): Promise<number> {
    let threads = 0;
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const r = threadsPage.parse(await json(queueArgs.threads(repo, number, after), signal));
      if (r.errors?.length) throw new Error("Incomplete GitHub review threads response");
      const t = r.data.repository.pullRequest.reviewThreads;
      threads += t.nodes.filter((n) => !n.isResolved).length;
      if (!t.pageInfo.hasNextPage) return threads;
      if (page === 19 || !t.pageInfo.endCursor || after === t.pageInfo.endCursor) throw new Error("Incomplete review threads pagination");
      after = t.pageInfo.endCursor;
    }
    return threads;
  }
  /** Required checks only: none required (gh says so) passes; anything unreadable is unknown. */
  async function requiredChecks(repo: string, number: number, signal?: AbortSignal): Promise<Facts["ci"]> {
    const checks = await run(queueArgs.checks(repo, number), signal);
    if (/no required checks/i.test(checks.stderr + checks.stdout)) return "pass";
    if (checks.code !== 0 && checks.code !== 1 && checks.code !== 8) return "unknown";
    try {
      const rows = z.array(z.object({ bucket: z.string() })).parse(JSON.parse(checks.stdout));
      if (rows.some((r) => ["fail", "cancel"].includes(r.bucket))) return "fail";
      if (rows.some((r) => r.bucket === "pending")) return "pending";
      return rows.every((r) => ["pass", "skipping"].includes(r.bucket)) ? "pass" : "unknown";
    } catch {
      return "unknown";
    }
  }
  async function inspect(url: string, signal?: AbortSignal): Promise<Facts> {
    const { repo, number, url: canonical } = parsePrUrl(url);
    const login = await identity(signal);
    const p = pull.parse(await json(queueArgs.pull(repo, number), signal));
    const reviews = z.array(review).parse(await pages((n) => queueArgs.reviews(repo, number, n), signal));
    const cs = await comments(url, signal);
    const ci = await requiredChecks(repo, number, signal);
    const threads = await unresolvedThreads(repo, number, signal);
    const rabbit = reviews.filter((r) => r.user?.login === CODERABBIT && r.state !== "PENDING").sort((a, b) => stamp(b.submitted_at) - stamp(a.submitted_at));
    // Approvals on the head: Open PRs' own rule (core/open-prs.ts reviewState, from public PR #4): each person's latest
    // opinionated review, approved on this head; never the author's, never a bot's. Reviews go in oldest first, and only
    // those GitHub marks as a person's.
    const people = [...reviews]
      .sort((a, b) => stamp(a.submitted_at) - stamp(b.submitted_at))
      .filter((r) => r.user?.type === "User")
      .map((r) => ({ login: r.user!.login, state: r.state, sha: r.commit_id }));
    const onHead = reviewState({ draft: false, sha: p.head.sha, author: p.user.login, reviews: people, requested: [] });
    const summary = cs.filter((c) => c.author === CODERABBIT && /summarize by coderabbit.ai/i.test(c.body)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    const latest = rabbit[0];
    return {
      url: canonical,
      title: p.title.slice(0, 300),
      head: p.head.sha,
      author: p.user.login,
      state: p.merged ? "merged" : p.state,
      draft: p.draft,
      conflict: p.mergeable === false || p.mergeable_state === "dirty",
      ci,
      approvals: onHead.state === "approved" ? onHead.who.length : 0,
      threads,
      reviewedHead: rabbit.some((r) => r.commit_id === p.head.sha),
      lastReview: latest ? { head: latest.commit_id, at: stamp(latest.submitted_at), state: latest.state } : null,
      inProgressAt: summary && /review in progress by coderabbit.ai/i.test(summary.body) ? (summary.updatedAt ?? 0) : null,
      recentRequestAt: cs.filter((c) => c.author.toLowerCase() === login.toLowerCase() && c.body.trim() === TRIGGER).sort((a, b) => b.at - a.at)[0]?.at ?? null,
    };
  }
  /** The signed-in user's open PRs, most recently updated first (gh's login, never a setting). */
  async function discover(signal?: AbortSignal): Promise<string[]> {
    const login = await identity(signal);
    const rows = z.array(z.object({ url: z.string() })).parse(await json(queueArgs.discover(login), signal));
    return rows.map((r) => parsePrUrl(r.url).url);
  }
  async function outcome(url: string, at: number, signal?: AbortSignal) {
    const cs = await comments(url, signal);
    const result = replyOutcome(cs, at);
    const summary = cs.filter((c) => c.author === CODERABBIT && /Next included review available in/i.test(c.body)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    return { outcome: result, cooldownUntil: result === "rate_limited" ? cooldownUntil(summary?.body ?? "", summary?.updatedAt ?? Date.now(), Date.now()) : null };
  }
  /** Ask for one review: recheck everything here, return on dry-run, else write TRIGGER once and never retry. */
  async function post(input: { url: string; head: string; login: string; auto: boolean; dryRun: boolean }, signal?: AbortSignal) {
    const login = await identity(signal);
    const f = await inspect(input.url, signal);
    const a = assess({ url: input.url, auto: input.auto, pinned: false, addedAt: Date.now(), facts: f, error: null, fetchedAt: Date.now() }, null, login, Date.now());
    if (login.toLowerCase() !== input.login.toLowerCase() || f.head !== input.head || !a.eligible)
      return { outcome: "post_failed" as const, commentUrl: null, note: "Identity, head or eligibility changed; nothing posted" };
    if (input.dryRun) return { outcome: "dry_run" as const, commentUrl: null, note: "Dry-run: would request CodeRabbit review; nothing posted" };
    signal?.throwIfAborted();
    const { repo, number } = parsePrUrl(input.url);
    const at = Date.now();
    const r = await run(queueArgs.trigger(repo, number), signal);
    if (r.code === 0) {
      try {
        const c = comment.parse(JSON.parse(r.stdout));
        return { outcome: "posted" as const, commentUrl: c.html_url, note: "Review requested; waiting for CodeRabbit reply" };
      } catch {
        // an answer that doesn't parse: reconcile below, as for a lost one
      }
    }
    // Lost or unclear: look for the comment before calling it failed. Only a definite rejection with no comment is safe.
    const cs = await comments(input.url, signal).catch(() => null);
    const landed = cs?.find((c) => c.author.toLowerCase() === login.toLowerCase() && c.body.trim() === TRIGGER && c.at >= at - 5000);
    if (landed) return { outcome: "posted" as const, commentUrl: landed.url ?? null, note: "Posted; recovered comment after an ambiguous response" };
    const definite = cs !== null && /HTTP (400|401|403|404|422)\b/.test(r.stderr);
    return definite
      ? { outcome: "post_failed" as const, commentUrl: null, note: "GitHub rejected the request; no matching comment found" }
      : { outcome: "unknown" as const, commentUrl: null, note: "Uncertain post result; held for 3 hours to avoid duplicates" };
  }
  return { identity, inspect, discover, outcome, post };
}

const github = makeQueueGitHub();
type Context = { signal: AbortSignal };
export const queueHandlers = {
  "reviewQueue.identity": (_: null, c: Context) => github.identity(c.signal),
  "reviewQueue.discover": (_: null, c: Context) => github.discover(c.signal),
  "reviewQueue.inspect": (a: { url: string }, c: Context) => github.inspect(a.url, c.signal),
  "reviewQueue.outcome": (a: { url: string; at: number }, c: Context) => github.outcome(a.url, a.at, c.signal),
  "reviewQueue.post": (a: Parameters<typeof github.post>[0], c: Context) => github.post(a, c.signal),
};
