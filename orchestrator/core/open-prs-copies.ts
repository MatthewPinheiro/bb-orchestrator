// "Since your last copy" (2026-11-18, folded in from a contributor's public PR #4): what changed in a section's PRs since
// the owner last copied or posted that section's review ask. Pure: the server keeps one baseline per section in plugin
// storage (open-prs/copies.ts) and the page compares and draws. A baseline moves only on a successful copy or post.

import { prRef, type Ci, type ReviewState } from "./open-prs.ts";

/** The sections a review ask is copied from: the Open PRs filters that have one. */
export type Section = "needs" | "first" | "rereview";
export const SECTIONS: readonly Section[] = ["needs", "first", "rereview"];

/** One PR as a baseline keeps it: what a change is judged on. */
export interface CopiedPr {
  url: string;
  repo: string;
  number: number;
  title: string;
  sha: string;
  state: ReviewState | null;
  review: string; // the review in words ("changes requested", "approved", …)
  ci: Ci;
}
export type CopyHistory = Partial<Record<Section, { at: number; prs: CopiedPr[] }>>;
/** What GitHub says of a PR that left the open list: merged, closed, or still open (the search missed it). */
export type Departed = Record<string, "MERGED" | "CLOSED" | "OPEN">;

export interface CopyChange {
  url: string;
  repo: string;
  number: number;
  title: string;
  reasons: string[];
}

const STATE: Record<ReviewState, string> = { first: "first review", rereview: "re-review", approved: "approved on this head" };
const CI_WORDS: Record<Ci, string> = { pass: "passing", pending: "running", fail: "failing", none: "no checks" };

export const copiedPr = (p: CopiedPr): CopiedPr => ({ url: p.url, repo: p.repo, number: p.number, title: p.title, sha: p.sha, state: p.state, review: p.review, ci: p.ci });

/** The history with one section's baseline replaced by exactly these PRs (an empty list included); the others kept. */
export function saveCopy(history: CopyHistory, section: Section, prs: CopiedPr[], at: number): CopyHistory {
  return { ...history, [section]: { at, prs: prs.map(copiedPr) } };
}

function compare(old: CopiedPr, now: CopiedPr): string[] {
  return [
    ...(old.state !== now.state ? [now.state ? `now ${STATE[now.state]}` : "no longer in a review state"] : []),
    ...(old.sha !== now.sha ? ["new commits"] : []),
    ...(old.review !== now.review ? [`review: ${old.review} → ${now.review}`] : []),
    ...(old.ci !== now.ci ? [`CI: ${CI_WORDS[old.ci]} → ${CI_WORDS[now.ci]}`] : []),
    ...(old.title !== now.title ? ["title changed"] : []),
  ];
}

/**
 * A section's changes since its baseline: PRs new to it, PRs that left it (merged and closed only when GitHub said so,
 * else "status unconfirmed"), and changes to the PRs still in it. No baseline: nothing (the first copy sets one).
 */
export function changesSince(baseline: { prs: CopiedPr[] } | undefined, inSection: CopiedPr[], open: CopiedPr[], departed: Departed): CopyChange[] {
  if (!baseline) return [];
  const out: CopyChange[] = [];
  const add = (p: CopiedPr, reasons: string[]) => {
    if (reasons.length) out.push({ url: p.url, repo: p.repo, number: p.number, title: p.title, reasons });
  };
  const was = new Map(baseline.prs.map((p) => [p.url, p]));
  const here = new Set(inSection.map((p) => p.url));
  const openBy = new Map(open.map((p) => [p.url, p]));
  for (const p of inSection) {
    const old = was.get(p.url);
    add(p, old ? compare(old, p) : ["new here"]);
  }
  for (const old of baseline.prs) {
    if (here.has(old.url)) continue;
    const now = openBy.get(old.url);
    if (now) {
      add(now, ["left this list", ...compare(old, now)]);
      continue;
    }
    const s = Object.hasOwn(departed, old.url) ? departed[old.url] : undefined;
    add(old, [s === "MERGED" ? "merged" : s === "CLOSED" ? "closed" : s === "OPEN" ? "no longer listed (still open)" : "no longer listed (status unconfirmed)"]);
  }
  return out;
}

/**
 * The changes a message that holds only some of the section's PRs may say: those about the PRs it holds, and those
 * about PRs that left the list. A PR left unticked in Post is in neither, so the message never names it.
 */
export const changesForSent = (changes: CopyChange[], sent: Iterable<string>, listed: Iterable<string>): CopyChange[] => {
  const s = new Set(sent);
  const l = new Set(listed);
  return changes.filter((c) => s.has(c.url) || !l.has(c.url));
};

export const CHANGES_LEAD = "Since the last copy:";
const MAX_LINES = 6;

/** The copied text's change header: at most six PRs, then how many more; empty when nothing changed. */
export function changeHeader(changes: CopyChange[]): string {
  if (!changes.length) return "";
  const lines = changes.slice(0, MAX_LINES).map((c) => `• ${prRef(c)}: ${c.reasons.join("; ")}`);
  if (changes.length > MAX_LINES) lines.push(`• ${changes.length - MAX_LINES} more changed PRs`);
  return [CHANGES_LEAD, ...lines].join("\n");
}

/**
 * The review ask with the change header above it, when there is a baseline and something changed; else the ask alone
 * (2026-11-18, the owner's layout feedback: no "no changes." line in a message).
 */
export const withChanges = (text: string, changes: CopyChange[] | null): string => (text && changes?.length ? `${changeHeader(changes)}\n\n${text}` : text);

/** The PRs whose URLs left the open list but sit in a baseline: the ones to ask GitHub about, each once, at most `max`. */
export function departedUrls(history: CopyHistory, openUrls: Iterable<string>, max = 20): string[] {
  const open = new Set(openUrls);
  const out = new Set<string>();
  for (const s of SECTIONS) for (const p of history[s]?.prs ?? []) if (!open.has(p.url)) out.add(p.url);
  return [...out].slice(0, max);
}
