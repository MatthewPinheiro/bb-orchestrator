// The project page's geometry (2026-11-16): the Timeline's time scale and rows, and the Dependencies graph's places.
// No JSX, so node --test checks that everything lands inside the width it is given (no sideways scroll at 390px).
import type { ProjectHistory } from "../contract.ts";

type Row = ProjectHistory["rows"][number];
type Dep = ProjectHistory["deps"][number];

export const NARROW = 560; // below this the name sits above its bar, which then gets the full width
export const LABEL_W = 116;
export const MIN_BAR = 3; // a thread that lived 90 seconds on a three-day axis still shows

export type Range = "all" | "week" | "day";
export const RANGE_MS: Record<Range, number> = { all: Infinity, week: 7 * 86_400_000, day: 86_400_000 };

export interface Scale {
  t0: number;
  t1: number;
  x0: number; // where time starts on the canvas
  x1: number;
  x(t: number): number;
}

export function scale(start: number, now: number, range: Range, width: number, narrow: boolean): Scale {
  const t1 = now;
  const t0 = Math.max(start, now - RANGE_MS[range]);
  const x0 = narrow ? 0 : LABEL_W;
  const x1 = Math.max(x0 + 40, width - 6); // room for the last mark
  const span = Math.max(1, t1 - t0);
  return { t0, t1, x0, x1, x: (t) => x0 + ((Math.min(t1, Math.max(t0, t)) - t0) / span) * (x1 - x0) };
}

/** A bar from..to on the scale, at least MIN_BAR wide and never past the canvas. */
export function span(s: Scale, from: number, to: number): { x: number; w: number } {
  const a = s.x(from);
  const b = s.x(to);
  const w = Math.max(MIN_BAR, b - a);
  return { x: Math.min(a, s.x1 - w), w };
}

const H = 3_600_000;
const D = 86_400_000;
const STEPS = [15 * 60_000, H, 3 * H, 6 * H, 12 * H, D, 2 * D, 7 * D];

/** Axis ticks: the finest step that leaves at least `gap` px between labels, aligned to the local clock. */
export function ticks(s: Scale, gap = 64, tzOffsetMin = new Date(s.t0).getTimezoneOffset()): { t: number; x: number; day: boolean }[] {
  const room = s.x1 - s.x0;
  const span = s.t1 - s.t0;
  const step = STEPS.find((st) => (span / st) * gap <= room) ?? STEPS[STEPS.length - 1]!;
  const off = -tzOffsetMin * 60_000; // local midnight lines up with a day step
  const first = Math.ceil((s.t0 + off) / step) * step - off;
  const out: { t: number; x: number; day: boolean }[] = [];
  for (let t = first; t <= s.t1; t += step) out.push({ t, x: s.x(t), day: (t + off) % D === 0 });
  return out;
}

/** The rows with anything inside the range, lead first, then live threads, then finished ones newest first. */
export function rowsIn(rows: Row[], s: Scale, now: number): Row[] {
  const seen = rows.filter((r) => r.holders.some((h) => (h.to ?? now) >= s.t0));
  const lastEnd = (r: Row) => Math.max(...r.holders.map((h) => h.to ?? now));
  const num = (r: Row) => Number(r.address.split(":")[2] ?? 0);
  return seen.sort(
    (a, b) =>
      Number(b.role === "lead") - Number(a.role === "lead") || Number(b.live) - Number(a.live) || (a.live ? num(a) - num(b) : lastEnd(b) - lastEnd(a) || num(b) - num(a)),
  );
}

/** "lead", "thread 5": a row's short name. */
export const rowName = (address: string) => (address.startsWith("lead:") ? "lead" : address.startsWith("thread:") ? `thread ${address.split(":")[2] ?? ""}` : address);

// ---------------------------------------------------------------- Dependencies: what waits (left) on what (right)

export const DEP_ROW = 46;
export interface DepPlace {
  left: { dep: Dep; y: number }[];
  right: { on: string; y: number; n: number }[];
  height: number;
  leftW: number;
  rightX: number;
  rightW: number;
}

/** Each wait is a node on the left, in order (blockers first); each thing waited on one node on the right, beside its waiters. */
export function placeDeps(deps: Dep[], width: number): DepPlace {
  const rightW = Math.min(132, Math.max(84, Math.round(width * 0.28)));
  const gap = width < NARROW ? 28 : 72;
  const leftW = Math.max(120, width - rightW - gap);
  const left = deps.map((dep, i) => ({ dep, y: i * DEP_ROW }));
  const groups = new Map<string, number[]>();
  for (const l of left) groups.set(l.dep.on, [...(groups.get(l.dep.on) ?? []), l.y]);
  // in the order they first appear (so the first blocker is the top one), each at the middle of its waiters, then
  // pushed down where two would overlap
  const right: DepPlace["right"] = [];
  let floor = 0;
  for (const [on, ys] of groups) {
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const y = Math.max(mid, floor);
    right.push({ on, y, n: ys.length });
    floor = y + DEP_ROW;
  }
  const height = Math.max(left.length, 1) * DEP_ROW + Math.max(0, floor - left.length * DEP_ROW);
  return { left, right, height, leftW, rightX: width - rightW, rightW };
}
