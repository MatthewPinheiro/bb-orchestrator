// A stopped agent whose bb thread is gone (2026-11-19). The Steward found a thread listed as `stopped` for days although
// bb answered 404 for it, live and archived. bb sends no archive event for a thread it no longer has, and the startup
// reconcile skipped stopped agents and read any failed lookup as "no answer", so nothing ever retired it, and its waiting
// mail waited forever. Why the rules matter: retiring is one-way (the mail becomes a dead letter), so only bb's clear
// not-found counts, and only when seen twice, apart. A network error, a timeout or a bb that is restarting must never
// retire anyone, nor must a bb that comes up answering "not found" for every thread.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult, GONE_CONFIRM_MS } from "../core/engine.ts";
import { isThreadGone, lookThreads } from "../core/gone.ts";

/** bb's answer for a thread it doesn't have, as its SDK throws it. */
const NOT_FOUND = Object.assign(new Error("Thread not found"), { code: "thread_not_found", status: 404 });

function setup() {
  let clock = Date.parse("2026-11-19T01:00:00Z");
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, {
    now: () => clock,
    deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }),
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  e.register("T-cos", "cos", null);
  const lead = e.register("T-lead", "lead", "alpha");
  const t = e.register("T-gone", "thread", "alpha", "T-lead");
  e.setStatus(t.threadId, "stopped");
  const mail = e.send(lead, t.address, "Carry on with step 3 when you are started again.", null);
  /** bb as the plugin sees it: `answer` decides what the stopped thread's lookup does; every other thread is there. */
  let answer: () => unknown = () => {
    throw NOT_FOUND;
  };
  const get = async (threadId: string) => (threadId === t.threadId ? answer() : { id: threadId, status: "idle" });
  const pass = () => lookThreads(e, e.agents(), get);
  return { e, db, t, mail, pass, advance: (ms: number) => (clock += ms), bb: (f: () => unknown) => (answer = f) };
}

test("a stopped agent bb answers 404 for, twice and apart, is retired as an archived one is, and its waiting mail is a dead letter", async () => {
  const s = setup();
  await s.pass();
  assert.ok(s.e.agentByThread(s.t.threadId), "one not-found is only noted");
  s.advance(GONE_CONFIRM_MS);
  await s.pass();
  assert.equal(s.e.agentByThread(s.t.threadId), null, "seen again, apart: retired");
  assert.equal(s.e.agentByAddress(s.t.address), null);
  const row = s.db.prepare(`SELECT kind, title FROM board WHERE ref = ? AND kind = 'archived'`).get(s.t.threadId) as { kind: string; title: string } | undefined;
  assert.match(row?.title ?? "", /thread:alpha:1 retired: bb no longer has its thread/, "the Board says why, with no Archive button (the thread is gone)");
  assert.equal(s.e.items(50).find((i) => i.id === s.mail.id)?.state, "dead", "the mail it never got goes to the CoS as a dead letter");
});

test("two not-founds too close together retire nobody: the second must come at least GONE_CONFIRM_MS after the first", async () => {
  const s = setup();
  await s.pass();
  s.advance(GONE_CONFIRM_MS - 1);
  await s.pass();
  assert.ok(s.e.agentByThread(s.t.threadId));
});

test("a network error, a timeout, a 5xx or a restarting bb never retires anyone, however long it lasts", async () => {
  const s = setup();
  const failures: (() => unknown)[] = [
    () => {
      throw new TypeError("fetch failed");
    },
    () => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:38886"), { code: "ECONNREFUSED" });
    },
    () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    },
    () => {
      throw Object.assign(new Error("Service Unavailable"), { status: 503 });
    },
    () => {
      throw Object.assign(new Error("Internal Server Error"), { status: 500, code: "internal_error" });
    },
    () => {
      throw "socket hang up";
    },
  ];
  for (let hour = 0; hour < 24; hour++) {
    s.bb(failures[hour % failures.length]!);
    await s.pass();
    s.advance(60 * 60_000);
  }
  assert.ok(s.e.agentByThread(s.t.threadId), "still live after a day of failed lookups");
  assert.equal(s.e.agentByThread(s.t.threadId)!.status, "stopped");
  assert.notEqual(s.e.items(50).find((i) => i.id === s.mail.id)?.state, "dead", "its mail still waits for it");
});

test("a failed lookup between two not-founds doesn't count, and a found thread starts the count over", async () => {
  const s = setup();
  await s.pass(); // not found (1)
  s.advance(GONE_CONFIRM_MS);
  s.bb(() => ({ id: s.t.threadId, status: "idle" }));
  await s.pass(); // there after all: the note goes
  s.bb(() => {
    throw NOT_FOUND;
  });
  s.advance(GONE_CONFIRM_MS);
  await s.pass(); // not found (1 again)
  assert.ok(s.e.agentByThread(s.t.threadId), "the earlier not-found no longer counts");
  s.advance(GONE_CONFIRM_MS);
  await s.pass();
  assert.equal(s.e.agentByThread(s.t.threadId), null);
});

test("a bb that answers not-found for every thread (it came up empty) retires nobody", async () => {
  const s = setup();
  const get = async () => {
    throw NOT_FOUND;
  };
  await lookThreads(s.e, s.e.agents(), get);
  s.advance(GONE_CONFIRM_MS);
  await lookThreads(s.e, s.e.agents(), get);
  assert.equal(s.e.agents().length, 3, "the CoS, the lead and the stopped thread all stay");
});

test("only bb's own not-found is a not-found", () => {
  assert.equal(isThreadGone(NOT_FOUND), true);
  assert.equal(isThreadGone({ code: "thread_not_found" }), true);
  assert.equal(isThreadGone({ status: 404 }), true);
  for (const e of [new TypeError("fetch failed"), { status: 503 }, { status: 500 }, { code: "ECONNREFUSED" }, "Thread not found", null, undefined])
    assert.equal(isThreadGone(e), false, String(e));
});

test("lookThreads hands back the threads bb gave, for the reconcile's status updates", async () => {
  const s = setup();
  const found = await s.pass();
  assert.deepEqual([...found.keys()].sort(), ["T-cos", "T-lead"]);
});
