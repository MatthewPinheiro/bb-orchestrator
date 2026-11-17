// A lead's structured status (2026-11-16: "make it very structured and make sure that it's very clear what step it's
// on"): its goal, numbered steps with at most one current, what it waits on and its blockers. orch_status publishes it,
// the engine keeps the latest per project (and logs each publish), and the project page draws it as a step bar.
// Pure and browser-safe: the app imports the words and the staleness rule from here.
import { z } from "zod";
import { fromJson } from "../blocks.ts";

export const STEP_STATES = ["done", "current", "next", "skipped"] as const;
export type StepState = (typeof STEP_STATES)[number];
export const WAIT_KINDS = ["owner", "pr", "thread", "ci", "external", "none"] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];
/**
 * Kinds only the `waits` list carries (2026-11-16, the Projects command center): a named person who isn't the owner, another
 * project's lead, a deploy, a quota. The stored `waitingOn` keeps the six kinds above (one of these is written there as
 * external), so an older page or a rollback still reads it.
 */
export const EXTRA_WAIT_KINDS = ["colleague", "lead", "deploy", "quota"] as const;
export const LIST_WAIT_KINDS = ["owner", "pr", "thread", "ci", "external", ...EXTRA_WAIT_KINDS] as const;
export type ListWaitKind = (typeof LIST_WAIT_KINDS)[number];

/** A status older than this is stale: the page says so, and the lead is nudged once. */
export const STATUS_STALE_MS = 2 * 3_600_000;
/** Short caps ("way less text"). Enforced here, never in the tool schema: a running agent keeps the schema it started with. */
export const STATUS_CAPS = { goal: 100, steps: 8, step: 48, label: 60, ref: 300, who: 40, waits: 3, blockers: 3, blocker: 100 } as const;

/** One thing the lead waits on. `since`: when this kind and ref were first published (kept while they stay the same). */
export interface Wait {
  kind: ListWaitKind;
  ref: string | null;
  label: string | null;
  who: string | null;
  since: number;
}

export interface LeadStatus {
  goal: string;
  steps: { title: string; state: StepState }[];
  waitingOn: { kind: WaitKind; ref: string | null; label: string | null };
  /** Up to STATUS_CAPS.waits, the first one mirrored in waitingOn. Absent in statuses stored before 2026-11-16: waitsOf. */
  waits?: Wait[];
  blockers: string[];
  updatedAt: number;
  by: string;
}

// Every parameter optional, nullable, and accepted as a JSON string too: agents on an older schema send what they can.
const stepIn = z.union([z.string(), z.object({ title: z.string().nullish(), state: z.string().nullish() })]);
const waitIn = z.union([z.string(), z.object({ kind: z.string().nullish(), ref: z.string().nullish(), label: z.string().nullish(), who: z.string().nullish() })]);
export const statusParams = z.object({
  goal: z.string().max(4000).nullish().describe(`The project's goal in one line, at most ${STATUS_CAPS.goal} characters`),
  steps: z
    .preprocess(fromJson, z.array(stepIn).max(50))
    .nullish()
    .describe(`Your plan in order, at most ${STATUS_CAPS.steps}: {title (at most ${STATUS_CAPS.step}), state: done|current|next|skipped}; at most one current`),
  waiting_on: z
    .preprocess(fromJson, z.union([waitIn, z.array(waitIn).max(20)]))
    .nullish()
    .describe(
      `What you wait on now, one wait or a list of at most ${STATUS_CAPS.waits}: {kind: owner|pr|thread|ci|external|colleague|lead|deploy|quota|none, ref: a PR URL, thread address, card id or URL, ` +
        `label (at most ${STATUS_CAPS.label}), who: the person, the project of another lead, or a PR's reviewer (at most ${STATUS_CAPS.who})}; null or [] clears it`,
    ),
  blockers: z
    .preprocess(fromJson, z.union([z.string(), z.array(z.string())]))
    .nullish()
    .describe(`What stops you, at most ${STATUS_CAPS.blockers}, one line each (at most ${STATUS_CAPS.blocker}); [] clears them`),
});
export type StatusParams = z.infer<typeof statusParams>;

const STATE_ALIAS: Record<string, StepState> = { todo: "next", pending: "next", active: "current", doing: "current", in_progress: "current", complete: "done", completed: "done", skip: "skipped" };
const line = (s: string) => s.replace(/\s+/g, " ").trim();
const over = (what: string, n: number, cap: number, how: string) => `${what} is ${n} characters; the cap is ${cap}. ${how}`;

/** "owner", or the owner's own name as agents say it (so an agent can write their name). */
function waitKind(raw: string, ownerName: string): ListWaitKind | "none" | null {
  const k = line(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "none" || (LIST_WAIT_KINDS as readonly string[]).includes(k)) return k as ListWaitKind | "none";
  if (k === "person" || (ownerName.trim() && k === ownerName.trim().toLowerCase())) return "owner";
  return null;
}

/** A status's waits: its list, or (stored before the list) its one waitingOn, dated from the status. */
export function waitsOf(s: Pick<LeadStatus, "waitingOn" | "waits" | "updatedAt">): Wait[] {
  if (s.waits) return s.waits;
  const w = s.waitingOn;
  return w.kind === "none" ? [] : [{ kind: w.kind, ref: w.ref, label: w.label, who: null, since: s.updatedAt }];
}

/** The one wait the legacy waitingOn field holds: the six old kinds only, a newer kind written as external. */
export function legacyWait(w: Wait | undefined): LeadStatus["waitingOn"] {
  if (!w) return { kind: "none", ref: null, label: null };
  if ((WAIT_KINDS as readonly string[]).includes(w.kind)) return { kind: w.kind as WaitKind, ref: w.ref, label: w.label };
  return { kind: "external", ref: w.ref, label: w.label ?? w.who };
}

/** The same wait: kind and ref both match. */
export const sameWait = (a: { kind: string; ref: string | null }, b: { kind: string; ref: string | null }) => a.kind === b.kind && (a.ref ?? null) === (b.ref ?? null);

/**
 * The status to store: the previous one with the fields given replaced (a missing field keeps its old value; null or
 * [] clears it), stamped `now`. A refusal names the field, its size and the cap, as the card caps do.
 */
export function normalizeStatus(
  p: StatusParams,
  prev: LeadStatus | null,
  ctx: { now: number; by: string; ownerName: string; legacySince?: number | null },
): { status: LeadStatus } | { refusal: string } {
  // a status stored before the list keeps its one wait, dated from the log when the engine knows (legacySince)
  const prevWaits = prev ? (prev.waits ? prev.waits.map((w) => ({ ...w })) : waitsOf(prev).map((w) => ({ ...w, since: ctx.legacySince ?? w.since }))) : [];
  const out: LeadStatus = prev
    ? { ...prev, steps: [...prev.steps], blockers: [...prev.blockers], waitingOn: { ...prev.waitingOn }, waits: prevWaits }
    : { goal: "", steps: [], waitingOn: { kind: "none", ref: null, label: null }, waits: [], blockers: [], updatedAt: ctx.now, by: ctx.by };
  if (p.goal !== undefined) {
    const g = line(p.goal ?? "");
    if (g.length > STATUS_CAPS.goal) return { refusal: over("goal", g.length, STATUS_CAPS.goal, "Say it in one short line") };
    out.goal = g;
  }
  if (p.steps !== undefined) {
    const steps = p.steps ?? [];
    if (steps.length > STATUS_CAPS.steps) return { refusal: `${steps.length} steps; the cap is ${STATUS_CAPS.steps}. Merge small ones into one step` };
    out.steps = [];
    for (const [i, s] of steps.entries()) {
      const title = line(typeof s === "string" ? s : (s.title ?? ""));
      if (!title) return { refusal: `step ${i + 1} has no title` };
      if (title.length > STATUS_CAPS.step) return { refusal: over(`step ${i + 1}'s title`, title.length, STATUS_CAPS.step, "Name the step in a few words") };
      const raw = typeof s === "string" ? "next" : line(s.state ?? "next").toLowerCase().replace(/[\s-]+/g, "_");
      const state = (STEP_STATES as readonly string[]).includes(raw) ? (raw as StepState) : STATE_ALIAS[raw];
      if (!state) return { refusal: `step ${i + 1}'s state "${raw}" is not one of ${STEP_STATES.join(", ")}` };
      out.steps.push({ title, state });
    }
  }
  if (p.waiting_on !== undefined) {
    const raw = p.waiting_on === null ? [] : Array.isArray(p.waiting_on) ? p.waiting_on : [p.waiting_on];
    const list: Wait[] = [];
    for (const [i, w] of raw.entries()) {
      const at = raw.length > 1 ? `waiting_on[${i}]` : "waiting_on";
      const o = typeof w === "string" ? { kind: w, ref: null, label: null, who: null } : w;
      const ref = line(o.ref ?? "") || null;
      const label = line(o.label ?? "") || null;
      const who = line(("who" in o ? o.who : null) ?? "") || null;
      // no kind: what the ref says (a PR link, a thread address), else something outside
      const kind = o.kind ? waitKind(o.kind, ctx.ownerName) : !ref && !label && !who ? "none" : ref && /\/pull\/\d+/.test(ref) ? "pr" : ref?.startsWith("thread:") ? "thread" : "external";
      if (!kind) return { refusal: `${at}.kind "${o.kind}" is not one of ${[...LIST_WAIT_KINDS, "none"].join(", ")}` };
      if (ref && ref.length > STATUS_CAPS.ref) return { refusal: over(`${at}.ref`, ref.length, STATUS_CAPS.ref, "Give one id, address or URL") };
      if (label && label.length > STATUS_CAPS.label) return { refusal: over(`${at}.label`, label.length, STATUS_CAPS.label, "Say what you wait for in a few words") };
      if (who && who.length > STATUS_CAPS.who) return { refusal: over(`${at}.who`, who.length, STATUS_CAPS.who, "Name one person, project or reviewer") };
      if (kind === "none") continue;
      // the same wait as before keeps its start, so its age is how long it has been waited on
      const since = prevWaits.find((x) => sameWait(x, { kind, ref }))?.since ?? ctx.now;
      list.push({ kind, ref, label, who, since });
    }
    if (list.length > STATUS_CAPS.waits) return { refusal: `${list.length} waits; the cap is ${STATUS_CAPS.waits}. Keep the ones that hold you up most` };
    out.waits = list;
    out.waitingOn = legacyWait(list[0]);
  }
  if (p.blockers !== undefined) {
    const list = (typeof p.blockers === "string" ? [p.blockers] : (p.blockers ?? [])).map(line).filter(Boolean);
    if (list.length > STATUS_CAPS.blockers) return { refusal: `${list.length} blockers; the cap is ${STATUS_CAPS.blockers}. Keep the ones that stop you now` };
    for (const [i, b] of list.entries()) if (b.length > STATUS_CAPS.blocker) return { refusal: over(`blocker ${i + 1}`, b.length, STATUS_CAPS.blocker, "One line: what stops you") };
    out.blockers = list;
  }
  const current = out.steps.filter((s) => s.state === "current").length;
  if (current > 1) return { refusal: `${current} steps are current; at most one is. Mark the others done or next` };
  if (!out.goal && out.steps.length === 0) return { refusal: "nothing to publish: give at least goal and steps" };
  out.updatedAt = ctx.now;
  out.by = ctx.by;
  return { status: out };
}

// ---------------------------------------------------------------- words (the page, the Projects line and the nudge)

export function isStale(s: Pick<LeadStatus, "updatedAt">, now: number): boolean {
  return now - s.updatedAt > STATUS_STALE_MS;
}

/** Where the lead is: the current step, else the next one to start, else all done. Numbers count from 1. */
export function position(s: Pick<LeadStatus, "steps">): { at: number; total: number; title: string; kind: "current" | "next" | "done" | "none" } {
  const total = s.steps.length;
  if (!total) return { at: 0, total, title: "", kind: "none" };
  const cur = s.steps.findIndex((x) => x.state === "current");
  if (cur >= 0) return { at: cur + 1, total, title: s.steps[cur]!.title, kind: "current" };
  const next = s.steps.findIndex((x) => x.state === "next");
  if (next >= 0) return { at: next + 1, total, title: s.steps[next]!.title, kind: "next" };
  return { at: total, total, title: "", kind: "done" };
}

/** "Step 3 of 5: Title", "Next: step 3 of 5: Title", "All 5 steps done". */
export function stepHeadline(s: Pick<LeadStatus, "steps">): string {
  const p = position(s);
  if (p.kind === "current") return `Step ${p.at} of ${p.total}: ${p.title}`;
  if (p.kind === "next") return `Next: step ${p.at} of ${p.total}: ${p.title}`;
  if (p.kind === "done") return p.total === 1 ? "The step is done" : `All ${p.total} steps done`;
  return "";
}

const PR_NUMBER = /\/pull\/(\d+)/;
/** What the lead waits on, in two or three words ("PR 1301", the owner's name, "thread 22"), or null when it waits on nothing. */
export function waitTarget(w: { kind: ListWaitKind | WaitKind; ref: string | null; label: string | null; who?: string | null }, ownerName: string): string | null {
  switch (w.kind) {
    case "colleague":
      return w.who ?? w.label ?? "a colleague";
    case "lead":
      return w.who ? `the ${w.who} lead` : (w.label ?? "another lead");
    case "deploy":
      return w.label ?? "a deploy";
    case "quota":
      return w.label ?? "a quota";
    case "none":
      return null;
    case "owner":
      return ownerName;
    case "pr": {
      const n = w.ref ? PR_NUMBER.exec(w.ref)?.[1] : null;
      return n ? `PR ${n}` : (w.label ?? "a PR");
    }
    case "thread": {
      const m = w.ref ? /^thread:[^:]+:(\d+)$/.exec(w.ref) : null;
      return m ? `thread ${m[1]}` : (w.label ?? w.ref ?? "a thread");
    }
    case "ci":
      return "CI";
    case "external":
      return w.label ?? (w.ref ? hostOf(w.ref) : null) ?? "something outside";
  }
}
const hostOf = (ref: string) => {
  try {
    return new URL(ref).host || null;
  } catch {
    return ref;
  }
};

/** The Projects list's line: "step 3/5 · waiting on PR 1301". */
export function statusLine(s: Pick<LeadStatus, "steps" | "waitingOn" | "waits">, ownerName: string): string {
  const p = position(s);
  const step = p.kind === "current" ? `step ${p.at}/${p.total}` : p.kind === "next" ? `next ${p.at}/${p.total}` : p.kind === "done" ? `done ${p.total}/${p.total}` : null;
  const first = s.waits ? s.waits[0] : s.waitingOn;
  const on = first ? waitTarget(first, ownerName) : null;
  return [step, on ? `waiting on ${on}` : null].filter(Boolean).join(" · ");
}
