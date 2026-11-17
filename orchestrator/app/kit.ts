// The Projects tab's components, as data (2026-11-17, the approved grading: thread orchestrator:40's mockups, picked as
// "All five + pinned documents"). No JSX, so node --test checks what the components draw:
// - the state chip's one vocabulary: an icon, a word and a tone for a project's state, a PR's state, CI when it isn't
//   green, and an age with its source; never colour alone;
// - the list row: one state chip, the one number that matters, the status's age;
// - the thread card's order: what waits on the owner, then what works, then the rest receding; five shown;
// - the detail layout: Needs | Blocked first, then Now | PRs + Record; each PR once, its wait folded into its row;
// - a pin's "updated" words.
import type { Projects, SummaryWait } from "../contract.ts";
import { blockersOf, stateOf, statusStale, type RowState } from "./command-center.ts";
import { age, type Lane } from "./lanes.ts";
import { otherWaits, prsInFlight } from "./source.ts";

type Project = Projects[number];
type ProjectPr = NonNullable<Project["prs"]>[number];

export type Tone = "need" | "blocked" | "warn" | "good" | "info" | "quiet";
export type IconName =
  | "you" | "blocked" | "wait" | "moving" | "quiet" | "held" | "nolead" | "pr" | "check" | "x" | "draft" | "eye" | "merged"
  | "doc" | "page" | "link" | "box" | "report" | "pin" | "unpin" | "more" | "said" | "live" | "plus" | "chev" | "copy" | "open" | "scope";

/** One chip: never a colour alone, always an icon and a word. */
export interface ChipSpec {
  tone: Tone;
  icon: IconName;
  word: string;
}

/**
 * A project's own state, without "needs you": what waits on the owner is a number beside it, not a state. "scoping"
 * (1.11.0): the owner and its lead are still settling what it is, in the Scope tab.
 */
export type ProjectState = Exclude<RowState, "you"> | "scoping";
export const STATE_CHIP: Record<ProjectState, ChipSpec> = {
  blocked: { tone: "blocked", icon: "blocked", word: "Blocked" },
  moving: { tone: "good", icon: "moving", word: "Moving" },
  waiting: { tone: "warn", icon: "wait", word: "Waiting" },
  quiet: { tone: "quiet", icon: "quiet", word: "Quiet" },
  held: { tone: "quiet", icon: "held", word: "On hold" },
  nolead: { tone: "quiet", icon: "nolead", word: "No lead" },
  scoping: { tone: "info", icon: "scope", word: "Scoping" },
};

/** The project's state as motion: blocked when the lead says so, else moving while a lane works, else waiting. */
export function projectState(p: Project, lanes: Lane[] | undefined): ProjectState {
  // scoping says what the project is for now, over its motion; a hold still wins (nothing moves while held)
  if (p.mode === "scoping" && p.heldAt === null) return "scoping";
  const st = stateOf(p, lanes);
  if (st !== "you") return st;
  if (blockersOf(p).length) return "blocked";
  if (p.heldAt !== null) return "held";
  return (lanes ?? []).some((l) => l.state === "working") ? "moving" : "waiting";
}

/** What waits on the owner in a project: its open cards and its agents' own prompts. */
export const needCount = (p: Project, lanes: Lane[] | undefined) => (p.summary?.needsYou.count ?? 0) + (lanes ?? []).filter((l) => l.state === "waiting" && l.wait?.on === "owner" && !l.wait.cardId).length;

type PrLike = { state: string | null; attention: string | null; checks: string | null; review?: string | null };

/** A PR's state as one chip, then CI as a second only when it isn't green ("CI passing" is the normal case: unsaid). */
export function prChips(pr: PrLike): ChipSpec[] {
  const out: ChipSpec[] = [];
  const a = pr.attention ?? "";
  const r = pr.review ?? "";
  if (pr.state === "merged") out.push({ tone: "quiet", icon: "merged", word: "merged" });
  else if (pr.state === "closed") out.push({ tone: "quiet", icon: "x", word: "closed" });
  else if (a === "ready_to_merge") out.push({ tone: "good", icon: "check", word: "ready to merge" });
  else if (a === "conflicts") out.push({ tone: "blocked", icon: "x", word: "conflicts" });
  // blocked outranks a review's approval: a PR that can't merge must never read green
  else if (a === "blocked") out.push({ tone: "blocked", icon: "blocked", word: "blocked" });
  else if (r === "changes_requested") out.push({ tone: "warn", icon: "eye", word: "changes asked" });
  else if (pr.state === "draft") out.push({ tone: "quiet", icon: "draft", word: "draft" });
  else if (r === "approved") out.push({ tone: "good", icon: "check", word: "approved" });
  else if (r === "review_required" || r === "review_requested" || a === "review_requested") out.push({ tone: "info", icon: "eye", word: "in review" });
  else out.push({ tone: "quiet", icon: "pr", word: "open" });
  const live = pr.state === "open" || pr.state === "draft";
  if (live && (pr.checks === "failing" || a === "checks_failed")) out.push({ tone: "blocked", icon: "x", word: "CI failing" });
  else if (live && pr.checks === "pending") out.push({ tone: "warn", icon: "wait", word: "CI running" });
  return out;
}

/** An age with its source: "6h" and a mark for live, the lead's word or a thread's report. Old turns it amber. */
export interface AgeSpec {
  text: string;
  source: "live" | "lead" | "thread" | null;
  old: boolean;
  title: string;
}
const SOURCE_WORD = { live: "live", lead: "lead said", thread: "thread said" } as const;
export const OLD_MS = 4 * 3_600_000;
export function ageSpec(since: number | null, now: number, source: AgeSpec["source"], oldAfter = OLD_MS): AgeSpec | null {
  const a = age(since, now);
  if (!a && !source) return null;
  const old = since !== null && now - since > oldAfter;
  return { text: a ?? "now", source, old, title: [a ? (old ? `unchanged ${a}` : a) : null, source ? SOURCE_WORD[source] : null].filter(Boolean).join(" · ") };
}

// ---------------------------------------------------------------- the list row

export interface ListRowSpec {
  state: ProjectState;
  chip: ChipSpec;
  /** the one number that matters, as a chip: for you, else blocked (when the state doesn't already say it), waits, PRs */
  number: ChipSpec | null;
  working: string | null;
  age: { text: string; old: boolean; title: string };
  quiet: boolean;
}

export function listRow(p: Project, lanes: Lane[] | undefined, now: number, quiet: boolean): ListRowSpec {
  const state = projectState(p, lanes);
  const needs = needCount(p, lanes);
  const blocked = blockersOf(p).length;
  const waits = p.summary?.waits.length ?? 0;
  const prs = prsInFlight(p).length;
  const number: ChipSpec | null = needs
    ? { tone: "need", icon: "you", word: `${needs} for you` }
    : blocked && state !== "blocked"
      ? { tone: "blocked", icon: "blocked", word: `${blocked} blocked` }
      : waits
        ? { tone: "quiet", icon: "wait", word: `${waits} ${waits === 1 ? "wait" : "waits"}` }
        : prs
          ? { tone: "quiet", icon: "pr", word: `${prs} ${prs === 1 ? "PR" : "PRs"}` }
          : null;
  const t = p.summary?.threads;
  const s = p.status;
  const out = !!p.summary?.statusOutOfDate;
  const stale = statusStale(p, now) && p.heldAt === null;
  const a = s ? age(s.updatedAt, now) : null;
  const ageOut = s
    ? { text: a ?? "now", old: out || stale, title: `lead said ${a ?? "now"}${a ? " ago" : ""}${out ? " · status out of date" : stale ? " · status old" : ""}` }
    : { text: p.lead ? "no status" : "no lead", old: false, title: p.lead ? "no status from the lead yet" : "no lead" };
  return { state, chip: STATE_CHIP[state], number, working: t && t.total ? `${t.working} of ${t.total} working` : null, age: ageOut, quiet };
}

// ---------------------------------------------------------------- the detail layout

/**
 * Where each section sits. What needs the owner and what blocks come first, side by side, so the answer is in the first
 * row; then what is happening (Now, the waits) beside the PRs and the record (Done | Decided). One column below 1200 px
 * keeps the same order.
 */
export const DETAIL_LAYOUT = {
  attention: ["needs", "blocked"],
  left: ["now", "waits"],
  right: ["prs", "record"],
} as const;
export type DetailSection = (typeof DETAIL_LAYOUT)[keyof typeof DETAIL_LAYOUT][number];
/** Reading order (one column, and screen readers on the wide one). */
export const detailOrder = (): DetailSection[] => [...DETAIL_LAYOUT.attention, ...DETAIL_LAYOUT.left, ...DETAIL_LAYOUT.right];

/** One PR row: the PR, its title from its thread, its chips, and every wait the lead or a live read names on it (oldest first). */
export interface PrRow {
  pr: ProjectPr;
  title: string | null;
  chips: ChipSpec[];
  waits: SummaryWait[];
}

const TICKET = /^t-\d+\s·\s/;
/** A lane's activity as a title: the ticket prefix goes (it is said on the card's second line). */
export const titleOf = (activity: string | null) => (activity ?? "").replace(TICKET, "") || null;
export const ticketOf = (activity: string | null) => TICKET.exec(activity ?? "")?.[0].replace(/\s·\s$/, "") ?? null;

/**
 * The PRs in flight, each once: every wait that names a shown PR (by its URL) folds into that PR's row, so a PR is never
 * also a "waiting on" line; the row keeps what the waits say (project-book.tsx draws it). Ready to merge first, drafts last. `loose`: the waits outside the owner that name no shown PR.
 */
export function prRows(p: Project, lanes: Lane[] | undefined): { rows: PrRow[]; loose: SummaryWait[] } {
  const prs = prsInFlight(p);
  const urls = new Set(prs.map((x) => x.url));
  const waits = otherWaits(p);
  const byUrl = new Map<string, SummaryWait[]>();
  for (const w of waits) if (w.ref && urls.has(w.ref)) byUrl.set(w.ref, [...(byUrl.get(w.ref) ?? []), w]);
  const oldest = (ws: SummaryWait[]) => [...ws].sort((x, y) => (x.since ?? Infinity) - (y.since ?? Infinity));
  const titles = new Map((lanes ?? []).filter((l) => l.agent.pr?.url).map((l) => [l.agent.pr!.url!, titleOf(l.activity)] as const));
  const order = (x: ProjectPr) => (x.attention === "ready_to_merge" ? 0 : x.state === "draft" ? 2 : 1);
  const rows = [...prs].sort((a, b) => order(a) - order(b) || b.number - a.number).map((pr) => ({ pr, title: titles.get(pr.url) ?? null, chips: prChips(pr), waits: oldest(byUrl.get(pr.url) ?? []) }));
  const folded = new Set([...byUrl.values()].flat());
  return { rows, loose: waits.filter((w) => !folded.has(w)) };
}

// ---------------------------------------------------------------- the thread card

export const THREADS_SHOWN = 5;
export const ROWS_SHOWN = 5;
const IDLE_LONG_MS = 24 * 3_600_000;

export interface ThreadSpec {
  lane: Lane;
  /** idle, nothing for the owner, no PR to merge: drawn lighter */
  rest: boolean;
  chip: ChipSpec;
}

const readyToMerge = (l: Lane) => l.agent.pr?.attention === "ready_to_merge" && (l.agent.pr.state === "open" || l.agent.pr.state === "draft");

/** The lane's state as a chip (a lane waiting on the owner gets the owner's chip, drawn by the card as a button). */
export function laneChip(l: Lane, now: number, owner: string): ChipSpec {
  const a = age(l.since, now);
  if (l.state === "waiting") return { tone: "need", icon: "you", word: a ? `${owner} · ${a}` : owner };
  if (l.state === "working") return { tone: "good", icon: "moving", word: "working" };
  if (l.state === "blocked") return { tone: "blocked", icon: "blocked", word: "blocked" };
  if (l.state === "released") return { tone: "quiet", icon: "quiet", word: "released" };
  const long = l.since !== null && now - l.since > IDLE_LONG_MS;
  return { tone: long ? "warn" : "quiet", icon: long ? "wait" : "quiet", word: a ? `idle ${a}` : "idle" };
}

/** Waiting on the owner, then blocked, then working, then the lead, then a PR to merge, then the rest, longest idle last. */
export function threadCards(lanes: Lane[] | undefined, now: number, owner: string): ThreadSpec[] {
  const live = (lanes ?? []).filter((l) => l.state !== "released");
  const rank = (l: Lane) =>
    l.state === "waiting" ? 0 : l.state === "blocked" ? 1 : l.state === "working" ? 2 : l.agent.role === "lead" ? 3 : readyToMerge(l) ? 4 : 5 + (l.since === null ? 0 : (now - l.since) / 1e12);
  return [...live]
    .sort((a, b) => rank(a) - rank(b))
    .map((lane) => ({ lane, rest: lane.state === "idle" && !readyToMerge(lane) && lane.agent.role !== "lead", chip: laneChip(lane, now, owner) }));
}

// ---------------------------------------------------------------- pins

export const PINS_SHOWN = 4;
/** A pin's second line: "updated 3d ago", a deliverable's "rev 2 · 6h ago", or that the file is gone. */
export function pinWhen(p: { kind: string; updatedAt: number | null; rev: number | null; missing: boolean }, now: number): string {
  if (p.missing) return p.kind === "file" ? "file not found" : "not found";
  const a = age(p.updatedAt, now);
  const when = a ? `${a} ago` : "just now";
  if (p.kind === "deliverable") return `rev ${p.rev ?? 1} · ${when}`;
  if (p.kind === "link") return `pinned ${when}`;
  return `updated ${when}`;
}
