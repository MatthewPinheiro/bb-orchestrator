// The project page's geometry (app/timeline.ts): on a phone (390px, a 358px canvas) nothing may run past the right
// edge, as that scrolls the whole page sideways; a thread that lived 90 seconds on a three-day axis must still show;
// axis labels must not collide; the first blocker sits at the top of the Dependencies graph.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_BAR, placeDeps, rowsIn, scale, span, ticks } from "../app/timeline.ts";

const H = 3_600_000;
const NOW = Date.parse("2026-11-16T14:00:00Z");
const START = NOW - 72 * H;

test("on a phone canvas every bar, even a 90-second one at the very end, stays inside the width and is visible", () => {
  for (const width of [358, 1180]) {
    const s = scale(START, NOW, "all", width, width < 560);
    for (const [from, to] of [
      [START, START + 90_000],
      [NOW - 90_000, NOW],
      [START, NOW],
      [NOW - 10 * H, NOW + H], // a clock a little ahead
    ] as const) {
      const { x, w } = span(s, from, to);
      assert.ok(w >= MIN_BAR, `visible at ${width}`);
      assert.ok(x >= s.x0 && x + w <= width, `inside ${width}: ${x}+${w}`);
    }
  }
});

test("on a desktop canvas the names keep their column; on a phone the bar gets the full width", () => {
  assert.equal(scale(START, NOW, "all", 1180, false).x0, 116);
  assert.equal(scale(START, NOW, "all", 358, true).x0, 0);
});

test("axis ticks leave room for their labels and fall on local hours or days", () => {
  for (const width of [358, 1180]) {
    for (const range of ["all", "week", "day"] as const) {
      const s = scale(START, NOW, range, width, width < 560);
      const ts = ticks(s, 64, 0);
      assert.ok(ts.length >= 2, `${width} ${range}: some ticks`);
      for (let i = 1; i < ts.length; i++) assert.ok(ts[i]!.x - ts[i - 1]!.x >= 63.9, `${width} ${range}: labels apart`);
      for (const t of ts) assert.equal(t.t % (15 * 60_000), 0, "on a quarter hour or coarser");
    }
  }
});

test("a range keeps only the rows that were alive in it, the lead and the live threads first", () => {
  const row = (address: string, from: number, to: number | null, role = "thread") => ({ address, role, live: to === null, parent: null, holders: [{ threadId: address, from, to, provider: null, segments: [] }], marks: [], asks: [], prs: [] });
  const rows = [row("thread:p:1", START, START + H), row("thread:p:2", NOW - 2 * H, NOW - H), row("thread:p:3", NOW - H, null), row("lead:p", START, null, "lead")];
  const day = scale(START, NOW, "day", 1180, false);
  assert.deepEqual(
    rowsIn(rows, day, NOW).map((r) => r.address),
    ["lead:p", "thread:p:3", "thread:p:2"],
    "thread 1 ended two days ago: not in the last 24 h",
  );
});

test("dependencies: each blocker sits beside its waiters, the first one on top, and nothing past the width", () => {
  const dep = (from: string, on: string, block: boolean) => ({ from, on, kind: "card" as const, label: "x", since: null, ref: null, block });
  const p = placeDeps([dep("thread:p:1", "owner", true), dep("thread:p:2", "owner", true), dep("lead:p", "thread:p:3", false)], 358);
  assert.deepEqual(
    p.right.map((r) => [r.on, r.n]),
    [
      ["owner", 2],
      ["thread:p:3", 1],
    ],
  );
  assert.ok(p.right[0]!.y < p.right[1]!.y);
  assert.ok(p.leftW < p.rightX && p.rightX + p.rightW <= 358);
});
