// A thread archived in bb doesn't keep a live role (2026-11-15): agent-v2's threads 4, 6 and 7 were archived by hand,
// with the owner's go, and still showed as open threads of their lead, holding their addresses and their mail.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine } from "../core/engine.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, { now: () => Date.parse("2026-11-15T01:00:00Z"), deliver: async () => ({ delivery: "held", why: "test" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const lead = e.register("T-la", "lead", "alpha");
  const w = e.register("T-w1", "thread", "alpha", "T-la");
  return { e, db, lead, w };
}

test("a worker thread archived in bb is retired: it leaves its lead's threads, and its waiting mail is closed", () => {
  const s = setup();
  const it = s.e.send(s.lead, s.w.address, "Still there?", null);
  s.e.setStatus("T-w1", "archived");
  assert.equal(s.e.agentByAddress(s.w.address), null, "the address is free");
  assert.equal(s.e.agents().some((a) => a.threadId === "T-w1"), false);
  assert.equal(s.e.deadLetters().some((d) => d.id === it.id), true, "mail for it can never be delivered: a dead letter, not a wait");
  // an "archived" row, not "resolved": the Board offers Archive on resolved rows whose thread has no archived row
  assert.ok(s.e.board().some((b) => b.kind === "archived" && b.ref === "T-w1"), "the Board says why it went");
  assert.equal(s.e.board().some((b) => b.kind === "resolved" && b.ref === "T-w1"), false, "no Archive button for a thread bb archived already");
  assert.equal(s.e.items().filter((i) => i.kind !== "message").length, 0, "retiring sends nobody mail: the dead letter is on the Board only");
  // the lead's orch_resolve on it then has nothing left to do, rather than an error
  assert.match(s.e.resolve(s.lead, s.w.address, { prMerged: false, lastReadAt: null }), /already resolved/);
});

test("an archived lead keeps its role: a project's lead comes back with its project", () => {
  const s = setup();
  s.e.setStatus("T-la", "archived");
  assert.equal(s.e.agentByThread("T-la")?.status, "archived");
});

test("a closed PR is no substitute for the thread's report: with none, resolve is refused", () => {
  const s = setup();
  assert.throws(() => s.e.resolve(s.lead, s.w.address, { prMerged: false, prClosed: true, lastReadAt: null, worktree: { clean: true, inBase: false, why: "its branch is pushed (origin/feat)" } }), /closed and it has no report/);
  s.e.report(s.w, "Dropped", "Closed 9: the fix landed in 8.", null);
  assert.match(s.e.resolve(s.lead, s.w.address, { prMerged: false, prClosed: true, lastReadAt: null, worktree: { clean: true, inBase: false, why: "its branch is pushed (origin/feat)" } }), /closed without merging/);
});
