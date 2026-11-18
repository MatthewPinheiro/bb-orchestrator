// The review queue's host side (2026-11-18, ported with a contributor's public PR's tests): post() re-reads everything
// on the machine that holds the gh login before its one write, and dry-run never reaches it. A fake gh records every
// argument list, so "zero writes" means no POST argv was ever run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeQueueGitHub, type Run } from "../review-queue/host.ts";
import { TRIGGER } from "../core/review-queue.ts";

const url = "https://github.com/acme/app/pull/1";
const user = { login: "owner", type: "User" };
const bot = { login: "coderabbitai[bot]", type: "Bot" };
const input = { url, head: "abc", login: "owner", auto: false, dryRun: true };
const response = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: "", code: 0 });

function fake(opts: { post?: "fail" | "unknown" | "landed"; reviews?: unknown[]; checks?: string[]; threadError?: boolean } = {}) {
  const calls: string[][] = [];
  let written = false;
  const run: Run = async (args) => {
    calls.push(args);
    if (args[0] === "api" && args[2] === "POST") {
      written = true;
      return opts.post === "fail" ? { stdout: "", stderr: "HTTP 403 Forbidden", code: 1 } : { stdout: "", stderr: "connection reset", code: 1 };
    }
    if (args[0] === "pr") return response((opts.checks ?? ["pass"]).map((bucket) => ({ bucket })));
    if (args[0] === "search") return response([{ url }]);
    if (args[1] === "graphql")
      return response({
        data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }], pageInfo: { hasNextPage: false, endCursor: null } } } } },
        ...(opts.threadError ? { errors: [{ message: "incomplete" }] } : {}),
      });
    const path = args[3]!;
    if (path === "user") return response(user);
    if (path === "repos/acme/app/pulls/1") return response({ title: "A PR", head: { sha: "abc" }, user, state: "open", merged: false, draft: false, mergeable: true, mergeable_state: "clean" });
    if (path.includes("/reviews?")) return response(opts.reviews ?? []);
    if (path.includes("/comments?"))
      return response(
        written && opts.post === "landed"
          ? [{ user, body: TRIGGER, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), html_url: url + "#issuecomment-123" }]
          : [],
      );
    throw new Error(`Unexpected command ${args.join(" ")}`);
  };
  const writes = () => calls.filter((a) => a.includes("POST") || a.includes("-X")).length;
  return { github: makeQueueGitHub(run), writes, calls };
}

test("host dry-run revalidates but performs zero GitHub writes", async () => {
  const t = fake();
  assert.equal((await t.github.post(input)).outcome, "dry_run");
  assert.ok(t.calls.length > 0, "it did read: identity, the PR, reviews, comments, checks, threads");
  assert.equal(t.writes(), 0);
});

test("host refuses changed identity or head even when live was requested", async () => {
  const t = fake();
  assert.equal((await t.github.post({ ...input, dryRun: false, head: "old" })).outcome, "post_failed");
  assert.equal((await t.github.post({ ...input, dryRun: false, login: "other" })).outcome, "post_failed");
  assert.equal(t.writes(), 0);
});

test("host skips a CodeRabbit COMMENTED review on the current head", async () => {
  const t = fake({ reviews: [{ user: bot, state: "COMMENTED", commit_id: "abc", submitted_at: new Date().toISOString() }] });
  assert.equal((await t.github.post({ ...input, dryRun: false })).outcome, "post_failed");
  assert.equal(t.writes(), 0);
});

test("host Auto mode waits for pending required checks", async () => {
  const t = fake({ checks: ["pending"] });
  assert.equal((await t.github.post({ ...input, auto: true, dryRun: false })).outcome, "post_failed");
  assert.equal(t.writes(), 0);
});

test("partial GraphQL responses refuse a trigger", async () => {
  const t = fake({ threadError: true });
  await assert.rejects(t.github.post({ ...input, dryRun: false }), /Incomplete/);
  assert.equal(t.writes(), 0);
});

test("an ambiguous write is reconciled once and never reposted", async () => {
  for (const post of ["fail", "unknown", "landed"] as const) {
    const t = fake({ post });
    assert.equal((await t.github.post({ ...input, dryRun: false })).outcome, post === "fail" ? "post_failed" : post === "landed" ? "posted" : "unknown");
    assert.equal(t.writes(), 1, `${post}: exactly one write`);
    assert.deepEqual(t.calls.find((a) => a.includes("POST")), ["api", "--method", "POST", "repos/acme/app/issues/1/comments", "-f", `body=${TRIGGER}`], "the write is the fixed trigger");
  }
});

test("the latest human opinion wins; author and bot approvals never count", async () => {
  const t = fake({
    reviews: [
      { user: { login: "peer", type: "User" }, state: "APPROVED", commit_id: "abc", submitted_at: "2026-01-01" },
      { user: { login: "peer", type: "User" }, state: "DISMISSED", commit_id: "abc", submitted_at: "2026-01-02" },
      { user, state: "APPROVED", commit_id: "abc", submitted_at: "2026-01-03" },
      { user: bot, state: "APPROVED", commit_id: "old", submitted_at: "2026-01-03" },
    ],
  });
  assert.equal((await t.github.inspect(url)).approvals, 0);
});

test("an approval on an older head doesn't count on the new one", async () => {
  const t = fake({ reviews: [{ user: { login: "peer", type: "User" }, state: "APPROVED", commit_id: "older", submitted_at: "2026-01-01" }] });
  assert.equal((await t.github.inspect(url)).approvals, 0);
});

test("discover lists the signed-in user's open PRs through a read; inspect reads only", async () => {
  const t = fake();
  assert.deepEqual(await t.github.discover(), [url]);
  assert.deepEqual(t.calls.at(-1)?.slice(0, 4), ["search", "prs", "--author", "owner"], "gh's own login, never a setting");
  await t.github.inspect(url);
  await t.github.outcome(url, Date.now());
  assert.equal(t.writes(), 0);
});

test("a person's approval on the head counts, and a later comment doesn't take it back (Open PRs' rule, from #4)", async () => {
  const peer = { login: "peer", type: "User" };
  const t = fake({
    reviews: [
      { user: peer, state: "APPROVED", commit_id: "abc", submitted_at: "2026-01-01" },
      { user: peer, state: "COMMENTED", commit_id: "abc", submitted_at: "2026-01-02" },
      { user: { login: "other", type: "User" }, state: "APPROVED", commit_id: "abc", submitted_at: "2026-01-03" },
    ],
  });
  assert.equal((await t.github.inspect(url)).approvals, 2);
});
