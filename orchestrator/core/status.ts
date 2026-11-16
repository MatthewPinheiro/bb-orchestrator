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

/** A status older than this is stale: the page says so, and the lead is nudged once. */
export const STATUS_STALE_MS = 2 * 3_600_000;
/** Short caps ("way less text"). Enforced here, never in the tool schema: a running agent keeps the schema it started with. */
export const STATUS_CAPS = { goal: 100, steps: 8, step: 48, label: 60, ref: 300, blockers: 3, blocker: 100 } as const;

export interface LeadStatus {
  goal: string;
  steps: { title: string; state: StepState }[];
  waitingOn: { kind: WaitKind; ref: string | null; label: string | null };
  blockers: string[];
  updatedAt: number;
  by: string;
}

// Every parameter optional, nullable, and accepted as a JSON string too: agents on an older schema send what they can.
const stepIn = z.union([z.string(), z.object({ title: z.string().nullish(), state: z.string().nullish() })]);
export const statusParams = z.object({
  goal: z.string().max(4000).nullish().describe(`The project's goal in one line, at most ${STATUS_CAPS.goal} characters`),
  steps: z
    .preprocess(fromJson, z.array(stepIn).max(50))
    .nullish()
    .describe(`Your plan in order, at most ${STATUS_CAPS.steps}: {title (at most ${STATUS_CAPS.step}), state: done|current|next|skipped}; at most one current`),
  waiting_on: z
    .preprocess(fromJson, z.union([z.string(), z.object({ kind: z.string().nullish(), ref: z.string().nullish(), label: z.string().nullish() })]))
    .nullish()
    .describe(`What you wait on now: {kind: owner|pr|thread|ci|external|none, ref: a PR URL, thread address, card id or URL, label (at most ${STATUS_CAPS.label})}`),
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
function waitKind(raw: string, ownerName: string): WaitKind | null {
  const k = line(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if ((WAIT_KINDS as readonly string[]).includes(k)) return k as WaitKind;
  if (k === "person" || (ownerName.trim() && k === ownerName.trim().toLowerCase())) return "owner";
  return null;
}

/**
 * The status to store: the previous one with the fields given replaced (a missing field keeps its old value; null or
 * [] clears it), stamped `now`. A refusal names the field, its size and the cap, as the card caps do.
 */
export function normalizeStatus(p: StatusParams, prev: LeadStatus | null, ctx: { now: number; by: string; ownerName: string }): { status: LeadStatus } | { refusal: string } {
  const out: LeadStatus = prev
    ? { ...prev, steps: [...prev.steps], blockers: [...prev.blockers], waitingOn: { ...prev.waitingOn } }
    : { goal: "", steps: [], waitingOn: { kind: "none", ref: null, label: null }, blockers: [], updatedAt: ctx.now, by: ctx.by };
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
    const w = p.waiting_on;
    if (w === null) out.waitingOn = { kind: "none", ref: null, label: null };
    else {
      const o = typeof w === "string" ? { kind: w, ref: null, label: null } : w;
      const ref = line(o.ref ?? "") || null;
      const label = line(o.label ?? "") || null;
      // no kind: what the ref says (a PR link, a thread address), else something outside
      const kind = o.kind ? waitKind(o.kind, ctx.ownerName) : !ref && !label ? "none" : ref && /\/pull\/\d+/.test(ref) ? "pr" : ref?.startsWith("thread:") ? "thread" : "external";
      if (!kind) return { refusal: `waiting_on.kind "${o.kind}" is not one of ${WAIT_KINDS.join(", ")}` };
      if (ref && ref.length > STATUS_CAPS.ref) return { refusal: over("waiting_on.ref", ref.length, STATUS_CAPS.ref, "Give one id, address or URL") };
      if (label && label.length > STATUS_CAPS.label) return { refusal: over("waiting_on.label", label.length, STATUS_CAPS.label, "Say what you wait for in a few words") };
      out.waitingOn = kind === "none" ? { kind, ref: null, label: null } : { kind, ref, label };
    }
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
export function waitTarget(w: LeadStatus["waitingOn"], ownerName: string): string | null {
  switch (w.kind) {
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
export function statusLine(s: Pick<LeadStatus, "steps" | "waitingOn">, ownerName: string): string {
  const p = position(s);
  const step = p.kind === "current" ? `step ${p.at}/${p.total}` : p.kind === "next" ? `next ${p.at}/${p.total}` : p.kind === "done" ? `done ${p.total}/${p.total}` : null;
  const on = waitTarget(s.waitingOn, ownerName);
  return [step, on ? `waiting on ${on}` : null].filter(Boolean).join(" · ");
}
