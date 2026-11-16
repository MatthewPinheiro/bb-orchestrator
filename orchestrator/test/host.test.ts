import assert from "node:assert/strict";
import { test } from "node:test";
import { AlarmState, sample, type Snapshot, type Thresholds } from "../core/host.ts";

const t: Thresholds = { diskPct: 85, swapPct: 50, memPct: 90, cpuPct: 95, sustainMs: 300_000 };
const snap = (p: Partial<Snapshot>): Snapshot => ({ at: "", memPct: 40, swapPct: 10, diskPct: 50, diskPath: "/", cpuPct: 10, load1: 1, ...p });

test("an alarm needs the threshold crossed for the sustain time, then fires once per level change", () => {
  const a = new AlarmState();
  assert.equal(a.step(snap({ diskPct: 90 }), t, 0), null, "not sustained yet");
  assert.equal(a.step(snap({ diskPct: 90 }), t, 299_000), null);
  assert.equal(a.step(snap({ diskPct: 90 }), t, 300_000), "disk");
  assert.equal(a.step(snap({ diskPct: 91 }), t, 360_000), null, "same level: no second wake");
  assert.equal(a.step(snap({ diskPct: 91, swapPct: 99 }), t, 420_000), null);
  assert.equal(a.step(snap({ diskPct: 91, swapPct: 99 }), t, 720_000), "disk+swap", "a new metric is a new level");
  assert.equal(a.step(snap({}), t, 780_000), "ok", "back to normal is a change too");
});

test("a dip below the threshold restarts the sustain clock", () => {
  const a = new AlarmState();
  a.step(snap({ memPct: 95 }), t, 0);
  a.step(snap({ memPct: 80 }), t, 200_000);
  assert.equal(a.step(snap({ memPct: 95 }), t, 300_000), null);
  assert.equal(a.step(snap({ memPct: 95 }), t, 600_000), "memory");
});

test("a first sample that is ok wakes nobody", () => {
  assert.equal(new AlarmState().step(snap({}), t, 0), null);
});

test("sample reads this machine", () => {
  const s = sample("/", Date.now());
  assert.ok(s.diskPct > 0 && s.diskPct <= 100);
  assert.ok(s.memPct > 0 && s.memPct <= 100);
});

test("a restart takes up the last fired level: no second wake for the same alarm, but a real change still fires", () => {
  const a = new AlarmState();
  a.restore("swap", 1_000_000, t.sustainMs);
  assert.equal(a.step(snap({ swapPct: 100 }), t, 1_000_000), null, "still swap: the Steward already knows");
  assert.equal(a.step(snap({ swapPct: 100 }), t, 1_060_000), null);
  assert.equal(a.step(snap({ swapPct: 10 }), t, 1_120_000), "ok", "swap cleared: that is news");
});
