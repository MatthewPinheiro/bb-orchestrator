// References in the command center's text become links (2026-11-16, the owner: "we also need links to prs and shit").
// Found by pattern in what leads already write (the status, waits, blockers, Done lines); leads change nothing. Each one
// links only when it resolves to something the plugin knows, else it stays plain text, and never inside a word:
// - a PR number (#4534, "PR 4101", "PRs 4101, 4102"): through the plugin's known PRs (the prs table), the project's
//   own first; a number two repos share stays plain. No repo is ever guessed;
// - a Linear id (ABC-123): only with the linearWorkspace setting, and with linearTeams set only for those team keys;
// - a decision card (d-…) or a deliverable (v-…) the page has loaded; a thread (thread 17, thread:<project>:<n>) or a
//   lead (lead:<project>) that is live;
// - a full URL, as written. CI and Sentry URLs are never built from ids.
// No JSX, so node --test checks it; RefText (ref-text.tsx) draws the tokens and opens each through openInBb.
import type { Openable } from "./open-proof.ts";

/** A PR the plugin knows, with what its chip says. */
export interface PrRef {
  number: number;
  url: string;
  state: string; // open, draft, merged, closed
  checks: string | null; // passing, failing, pending
  review: string | null; // approved, changes_requested, review_required
  attention: string | null;
}

export interface RefContext {
  /** This project's PRs, then every known PR (for a number this project doesn't hold). */
  projectPrs: PrRef[];
  allPrs: PrRef[];
  /** The Linear workspace slug; empty: Linear ids stay plain. */
  linearWorkspace: string;
  /** Team keys allowed to link; empty: every key. */
  linearTeams: string[];
  /** Cards the page knows: open ones open in Needs you, answered ones in Activity. */
  cards: Map<string, "open" | "answered">;
  deliverables: Set<string>;
  /** Live addresses to their bb thread ids. */
  threads: Map<string, string>;
  /** The project the text belongs to: "thread 17" is thread:<project>:17. */
  project: string;
}

export type Token =
  | { kind: "text"; text: string }
  | { kind: "url"; text: string; open: Openable }
  | { kind: "pr"; text: string; open: Openable; pr: PrRef }
  | { kind: "linear"; text: string; open: Openable }
  | { kind: "card"; text: string; open: Openable; answered: boolean }
  | { kind: "deliverable"; text: string; open: Openable }
  | { kind: "thread"; text: string; open: Openable };

/** Where the plugin's own views open: its panel and the view's sub-path, then the element scrolled into sight. */
export const panel = (subPath: string, selector: string, deliverable?: string): Openable => ({ panel: { subPath, selector, ...(deliverable ? { deliverable } : {}) } });

// One pass over the text: the first alternative that matches at a position wins. Every pattern is fenced so it never
// starts or ends inside a word (ABC-4321x, xd-…, v2-3 stay text).
// a list joins with a comma, or with "and" or "&" standing as words
const JOIN = String.raw`(?:\s*,\s*|\s+(?:and|&)\s+)`;
const URL_RE = String.raw`(?<![\w])https?:\/\/[^\s<>"'\`]+`;
const PR_LIST_RE = String.raw`\bPRs?\s+#?\d+(?:${JOIN}#?\d+)*(?![\w-])`;
const HASH_RE = String.raw`(?<![\w&#/])#\d+\b`;
const CARD_RE = String.raw`(?<![\w-])d-\d{8}T\d{6}Z-[0-9a-f]{6}(?![\w-])`;
const DELIV_RE = String.raw`(?<![\w-])v-[0-9a-f]{12}(?![\w-])`;
const THREAD_RE = String.raw`\b(?:thread|lead):[a-z0-9][a-z0-9-]*(?::\d+)?(?![\w-])|\bthreads?\s+\d+(?:${JOIN}\d+)*(?![\w-])`;
const LINEAR_RE = String.raw`(?<![\w-])[A-Z][A-Z0-9]+-\d+(?![\w-])`;
const ALL = new RegExp([URL_RE, PR_LIST_RE, HASH_RE, CARD_RE, DELIV_RE, THREAD_RE, LINEAR_RE].map((r) => `(${r})`).join("|"), "g");

/** A URL ends before trailing punctuation and an unmatched closing bracket. */
function trimUrl(u: string): string {
  let s = u.replace(/[.,;:!?]+$/, "");
  // a closing bracket the URL didn't open ends it: "(see https://x/y)", "[https://x/y]"
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const)
    while (s.endsWith(close) && s.split(open).length < s.split(close).length) s = s.slice(0, -1).replace(/[.,;:!?]+$/, "");
  return s;
}

/**
 * The context for a structured wait's words, which shorten its ref ("PR #41", "thread 17"): a PR number links only to
 * that ref's PR (plain if the plugin hasn't read it), and a thread number reads in the ref's own project.
 */
export function exactCtx(ctx: RefContext, exact: string | null | undefined): RefContext {
  if (!exact) return ctx;
  if (/^https?:\/\//.test(exact)) {
    const only = [...ctx.projectPrs, ...ctx.allPrs].filter((p) => p.url === exact).slice(0, 1);
    return { ...ctx, projectPrs: only, allPrs: only };
  }
  const there = /^thread:([^:]+):\d+$/.exec(exact);
  return there ? { ...ctx, project: there[1]! } : ctx;
}

/** A PR by number: this project's first; else the only known PR with that number; else none. */
export function resolvePr(n: number, ctx: Pick<RefContext, "projectPrs" | "allPrs">): PrRef | null {
  const pick = (list: PrRef[]) => {
    const urls = new Set(list.filter((p) => p.number === n).map((p) => p.url));
    return urls.size === 1 ? list.find((p) => p.number === n)! : null;
  };
  const mine = ctx.projectPrs.filter((p) => p.number === n);
  if (mine.length) return pick(ctx.projectPrs);
  return pick(ctx.allPrs);
}

/** A Linear issue's URL, or null without a workspace, or for a team key not in the list. */
export function linearUrl(id: string, ctx: Pick<RefContext, "linearWorkspace" | "linearTeams">): string | null {
  const slug = ctx.linearWorkspace.trim();
  if (!slug || !/^[A-Za-z0-9-]+$/.test(slug)) return null;
  const team = id.slice(0, id.lastIndexOf("-"));
  const teams = ctx.linearTeams.map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (teams.length && !teams.includes(team)) return null;
  return `https://linear.app/${slug}/issue/${id}`;
}

/** Splits a run like "PRs 4101, 4102" or "threads 3 and 4" into its numbers, each its own token, the joins as text. */
function numbered(text: string, link: (n: number, piece: string) => Token | null): Token[] {
  const out: Token[] = [];
  let at = 0;
  for (const m of text.matchAll(/#?(\d+)/g)) {
    const t = link(Number(m[1]), m[0]);
    if (!t) continue;
    if (m.index! > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    out.push(t);
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/** The text as tokens: plain runs and resolved references. Joining every token's text gives the text back. */
export function tokenize(text: string, ctx: RefContext): Token[] {
  const out: Token[] = [];
  const push = (t: Token) => {
    const prev = out[out.length - 1];
    if (t.kind === "text" && prev?.kind === "text") prev.text += t.text;
    else if (t.text) out.push(t);
  };
  const prToken = (n: number, piece: string): Token | null => {
    const pr = resolvePr(n, ctx);
    return pr ? { kind: "pr", text: piece, open: { url: pr.url }, pr } : null;
  };
  const threadToken = (address: string, piece: string): Token | null => {
    const id = ctx.threads.get(address);
    return id ? { kind: "thread", text: piece, open: { threadId: id } } : null;
  };
  let at = 0;
  for (const m of text.matchAll(ALL)) {
    const [whole, url, prList, hash, card, deliv, thread, linear] = m;
    let start = m.index!;
    let piece = whole;
    let tokens: Token[] | null = null;
    if (url) {
      piece = trimUrl(url);
      tokens = [{ kind: "url", text: piece, open: { url: piece } }];
    } else if (prList) {
      const head = /^PRs?\s+/.exec(prList)![0];
      const rest = numbered(prList.slice(head.length), prToken);
      // "PR 4101": the word and the number are one link; a list links each number
      if (rest.length === 1 && rest[0]!.kind === "pr") tokens = [{ ...rest[0]!, text: prList }];
      else tokens = [{ kind: "text", text: head }, ...rest];
    } else if (hash) {
      const t = prToken(Number(hash.slice(1)), hash);
      tokens = t ? [t] : null;
    } else if (card) {
      const state = ctx.cards.get(card);
      tokens = state
        ? [{ kind: "card", text: card, answered: state === "answered", open: state === "open" ? panel("needs-you", `[data-card="${card}"]`) : panel("board", `[data-decision="${card}"]`) }]
        : null;
    } else if (deliv) {
      tokens = ctx.deliverables.has(deliv) ? [{ kind: "deliverable", text: deliv, open: panel("deliverables", `[data-deliverable="${deliv}"], [data-tree-key="d:${deliv}"]`, deliv) }] : null;
    } else if (thread) {
      if (/^(?:thread|lead):/.test(thread)) {
        const t = threadToken(thread, thread);
        tokens = t ? [t] : null;
      } else {
        const head = /^threads?\s+/.exec(thread)![0];
        const rest = numbered(thread.slice(head.length), (n, p) => threadToken(`thread:${ctx.project}:${n}`, p));
        tokens = rest.length === 1 && rest[0]!.kind === "thread" ? [{ ...rest[0]!, text: thread }] : [{ kind: "text", text: head }, ...rest];
      }
    } else if (linear) {
      const u = linearUrl(linear, ctx);
      tokens = u ? [{ kind: "linear", text: linear, open: { url: u } }] : null;
    }
    if (!tokens || !tokens.some((t) => t.kind !== "text")) continue;
    if (start > at) push({ kind: "text", text: text.slice(at, start) });
    for (const t of tokens) push(t);
    at = start + piece.length;
  }
  if (at < text.length) push({ kind: "text", text: text.slice(at) });
  return out;
}

/**
 * The words right after a PR say the state the plugin knows it in ("PR #41 merged", and it is merged): its chip would
 * only repeat it. When the words and the live state disagree (the text says merged, the PR is open with failing
 * checks), the chip stays: the live state is the news.
 */
export const saysState = (t: Token | undefined, next: Token | undefined) => {
  if (t?.kind !== "pr" || next?.kind !== "text") return false;
  const said = /^\s*(merged|closed)\b/i.exec(next.text)?.[1]?.toLowerCase();
  return !!said && t.pr.state === said;
};

const CI_WORD: Record<string, string> = { passing: "CI passing", failing: "CI failing", pending: "CI running" };
const REVIEW_WORD: Record<string, string> = { approved: "approved", changes_requested: "changes asked", review_required: "in review", review_requested: "in review" };

/** A PR's chip in words: draft or ready (or merged, closed), the review decision, CI. No approval count is stored. */
export function prChip(pr: PrRef): { stage: string; review: string | null; ci: string | null; tone: "good" | "bad" | "wait" | "none" } {
  const stage = pr.state === "open" ? (pr.attention === "ready_to_merge" ? "ready to merge" : "ready") : pr.state;
  const live = pr.state === "open" || pr.state === "draft";
  const review = live ? (REVIEW_WORD[pr.review ?? ""] ?? null) : null;
  const ci = live && pr.checks ? (CI_WORD[pr.checks] ?? null) : null;
  const tone = !live ? "none" : pr.checks === "failing" || pr.review === "changes_requested" ? "bad" : pr.checks === "pending" ? "wait" : pr.checks === "passing" ? "good" : "none";
  return { stage, review, ci, tone };
}
