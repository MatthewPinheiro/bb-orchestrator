// The status's waits list (2026-11-16, the Projects command center). The row shows what a project waits on and for how
// long, so a lead can name up to three waits, with newer kinds (a colleague, another lead, a deploy, a quota) and who.
// Two things must not break: a page or a rollback that reads only the old one-wait field (it must keep the six old
// kinds), and a lead whose tool schema predates the list (it sends JSON strings). Each wait's age must survive a
// republish of the same wait, or "waiting 2d" would reset to "waiting 1m" every time the lead confirms its status.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Engine } from "../core/engine.ts";
import { statusParams, waitsOf, WAIT_KINDS, type LeadStatus } from "../core/status.ts";
import { leadStatusSchema } from "../contract.ts";

const T0 = Date.parse("2026-11-16T10:00:00Z");
const PR = "https://github.com/o/r/pull/77";

function setup() {
  const clock = { t: T0 };
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, { now: () => clock.t, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} }, { owner: "Robin" });
  const lead = e.register("T-lead", "lead", "kite");
  const publish = (raw: unknown) => e.publishStatus(lead, statusParams.parse(raw));
  return { e, db, lead, publish, advance: (ms: number) => (clock.t += ms), now: () => clock.t };
}

const STEPS = [{ title: "Build", state: "current" }];
// what a page or rollback from before the list validates: the old one-wait shape with its six kinds
const oldReader = z.object({ waitingOn: z.object({ kind: z.enum(WAIT_KINDS), ref: z.string().nullable(), label: z.string().nullable() }) });

test("a list of waits with the newer kinds is kept whole, and the old field keeps an old kind so an older page still reads it", () => {
  const s = setup();
  const st = s.publish({
    goal: "Ship kite",
    steps: STEPS,
    waiting_on: [
      { kind: "colleague", who: "Sam", label: "the design sign-off" },
      { kind: "pr", ref: PR, who: "a reviewer" },
      { kind: "quota", label: "GPU quota raise" },
    ],
  });
  assert.deepEqual(st.waits?.map((w) => [w.kind, w.who]), [["colleague", "Sam"], ["pr", "a reviewer"], ["quota", null]], "who is kept, not stripped by the schema");
  assert.deepEqual(st.waitingOn, { kind: "external", ref: null, label: "the design sign-off" }, "a newer kind is written as external in the old field");
  assert.ok(oldReader.safeParse(st).success, "an older reader's enum accepts what is stored");
  const stored = JSON.parse((s.db.prepare(`SELECT json FROM lead_status WHERE project = 'kite'`).get() as { json: string }).json);
  assert.ok(oldReader.safeParse(stored).success);
  assert.ok(leadStatusSchema.safeParse(stored).success, "the page's own schema reads it too");
  // a who-only colleague lands in the old field as its name, so the old line still says who
  assert.equal(s.publish({ waiting_on: { kind: "colleague", who: "Sam" } }).waitingOn.label, "Sam");
});

test("four waits are refused with the cap named; [] and null both clear the list and the old field", () => {
  const s = setup();
  s.publish({ goal: "g", steps: STEPS, waiting_on: [{ kind: "ci" }] });
  assert.throws(() => s.publish({ waiting_on: ["ci", "owner", "deploy", "quota"] }), /4 waits; the cap is 3/);
  assert.deepEqual(s.publish({ waiting_on: [] }).waits, []);
  s.publish({ waiting_on: "deploy" });
  const cleared = s.publish({ waiting_on: null });
  assert.deepEqual(cleared.waits, []);
  assert.deepEqual(cleared.waitingOn, { kind: "none", ref: null, label: null });
  assert.throws(() => s.publish({ waiting_on: { kind: "colleague", who: "x".repeat(41) } }), /who is 41 characters; the cap is 40/);
});

test("a wait's age survives republishing it, resets when its kind or ref change, and a partial publish keeps the list", () => {
  const s = setup();
  s.publish({ goal: "g", steps: STEPS, waiting_on: [{ kind: "pr", ref: PR }, { kind: "deploy", label: "staging" }] });
  s.advance(3 * 3_600_000);
  const again = s.publish({ waiting_on: [{ kind: "pr", ref: PR, label: "now with a label" }, { kind: "deploy", label: "staging" }] });
  assert.deepEqual(again.waits?.map((w) => w.since), [T0, T0], "the same kind and ref keep their start, whatever the label says");
  s.advance(60_000);
  const goalOnly = s.publish({ goal: "a new goal" });
  assert.deepEqual(goalOnly.waits?.map((w) => w.since), [T0, T0], "a publish without waiting_on keeps every wait as it was");
  const moved = s.publish({ waiting_on: [{ kind: "pr", ref: "https://github.com/o/r/pull/78" }] });
  assert.equal(moved.waits?.[0]?.since, s.now(), "another PR is a new wait");
});

test("a lead on the old tool schema sends the list as a JSON string, and it reads as the list", () => {
  const s = setup();
  const st = s.publish({ goal: "g", steps: JSON.stringify(STEPS), waiting_on: JSON.stringify([{ kind: "lead", who: "otter", label: "their API" }, "ci"]) });
  assert.deepEqual(st.waits?.map((w) => w.kind), ["lead", "ci"]);
  assert.equal(st.waitingOn.kind, "external");
});

test("a status stored before the list still reads, and its one wait keeps its age from the publish log when the lead next publishes", () => {
  const s = setup();
  // what a status from before the list looks like in the table and in the log: one wait, no `waits`, no `since`
  const legacy = (at: number): LeadStatus => ({ goal: "g", steps: [{ title: "Build", state: "current" }], waitingOn: { kind: "pr", ref: PR, label: null }, blockers: [], updatedAt: at, by: "lead:kite" });
  for (const at of [T0, T0 + 3_600_000]) s.db.prepare(`INSERT INTO events (at, kind, project, address, thread_id, value) VALUES (?, 'lead-status', 'kite', 'lead:kite', 'T-lead', ?)`).run(at, JSON.stringify(legacy(at)));
  s.db.prepare(`INSERT INTO lead_status (project, address, thread_id, json, updated_at) VALUES ('kite', 'lead:kite', 'T-lead', ?, ?)`).run(JSON.stringify(legacy(T0 + 3_600_000)), T0 + 3_600_000);
  const read = s.e.leadStatus("kite")!;
  assert.ok(leadStatusSchema.safeParse(read).success, "the page reads an old stored status");
  assert.deepEqual(waitsOf(read).map((w) => [w.kind, w.since]), [["pr", T0 + 3_600_000]], "read without the list: one wait, dated from the status");
  assert.equal(s.e.legacyWaitSince("kite", read), T0, "the log says the same PR was waited on since the first publish");
  s.advance(5 * 3_600_000);
  const next = s.publish({ blockers: [] });
  assert.deepEqual(next.waits?.map((w) => [w.kind, w.since]), [["pr", T0]], "the first publish after the change carries that age into the list");
});
