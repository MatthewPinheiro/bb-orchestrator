// Speed (2026-11-18): the owner found the plugin "bogged down". The page re-reads its RPCs on every change notice, and
// the delivery path runs on every tool call, so a read that scans a whole table, or scans it once per agent, costs
// that scan many times a minute on the bb server's one thread. These tests pin the query plans of those hot reads: a
// lookup goes through an index, never a full scan of a table that grows with history.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine } from "../core/engine.ts";
import type { Db } from "../core/db.ts";

const ports = { now: () => 1_000_000, deliver: async () => ({ delivery: "sent" as const }), mirror: () => {}, changed: () => {}, log: () => {} };

/** An engine whose database records every statement it prepares, with its query plan. */
function traced(settings: Record<string, unknown> = {}) {
  const raw = new DatabaseSync(":memory:");
  const plans = new Map<string, string>();
  const plan = (sql: string) => {
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(sql) && !plans.has(sql)) {
      try {
        plans.set(sql, (raw.prepare(`EXPLAIN QUERY PLAN ${sql.trim().replace(/;$/, "")}`).all() as { detail: string }[]).map((r) => r.detail).join(" | "));
      } catch {
        // a statement on a table a later migration makes: planned when it runs
      }
    }
  };
  const db: Db = {
    exec: (sql) => {
      plan(sql);
      return raw.exec(sql);
    },
    prepare: (sql) => {
      plan(sql);
      return raw.prepare(sql) as never;
    },
  };
  const e = new Engine(db, ports, settings);
  return { e, raw, plans, reset: () => plans.clear() };
}

/** The plans of the statements `fn` prepared that touch `table` and scan it whole. */
function scans(t: ReturnType<typeof traced>, table: string, fn: () => unknown): string[] {
  t.reset();
  fn();
  return [...t.plans].filter(([, plan]) => new RegExp(`\\bSCAN ${table}\\b(?! USING)`).test(plan)).map(([sql, plan]) => `${sql.replace(/\s+/g, " ").slice(0, 120)} => ${plan}`);
}

test("an agent's last report is an index lookup, not a board scan per agent", () => {
  const t = traced();
  const lead = t.e.register("t-lead", "lead", "alpha");
  // the agents and scope reads ask this once per live agent, on every change notice
  assert.deepEqual(scans(t, "board", () => [t.e.lastReport(lead.address), t.e.lastReportAt(lead.address)]), []);
});

test("a project's direct line reads the owner's messages newest first from an index, with no sort", () => {
  const t = traced();
  t.e.register("t-lead", "lead", "alpha");
  // the board and projects reads run this per project, on every change notice
  t.reset();
  t.e.directLines();
  const plan = [...t.plans].find(([sql]) => sql.includes("kind = 'owner.message'"))?.[1];
  assert.ok(plan, "directLines reads the owner's messages");
  assert.doesNotMatch(plan!, /SCAN items|TEMP B-TREE/);
});

test("a flush that changed nothing gives no change notice; one after any write does", async () => {
  // every open page re-reads its RPCs on each notice, and the clock flushes every few seconds: on a copy of the live
  // database an idle page made 103 RPC calls a minute with nothing happening
  for (const batchInbox of [true, false]) {
    let notices = 0;
    const e = new Engine(new DatabaseSync(":memory:") as unknown as Db, { ...ports, changed: () => notices++ }, { batchInbox });
    const lead = e.register("t-lead", "lead", "alpha");
    e.register("t-cos", "cos", null);
    await e.flush();
    notices = 0;
    for (let i = 0; i < 5; i++) await e.flush();
    assert.equal(notices, 0, `quiet flushes say nothing (batchInbox ${batchInbox})`);
    // a turn ending writes the status, and the page shows it: the flush that follows tells the page
    e.setStatus("t-lead", "idle");
    await e.flush();
    assert.ok(notices >= 1, `a status change is announced (batchInbox ${batchInbox})`);
    notices = 0;
    e.send(lead, "cos", "hello", null, null);
    await e.flush();
    assert.ok(notices >= 1, `new mail is announced (batchInbox ${batchInbox})`);
  }
});

test("a recipient whose mail was read while the flush delivered to another is skipped, and the flush goes on", async () => {
  // live on 2026-11-18, with bb slow: "clock: Cannot read properties of undefined (reading 'state')" three times in an
  // hour. Each one dropped the rest of that flush's wakes and the rest of the clock's pass.
  let ackDuring: (() => void) | null = null;
  const woke: string[] = [];
  const e = new Engine(new DatabaseSync(":memory:") as unknown as Db, {
    ...ports,
    now: () => Date.now(),
    deliver: async (threadId: string) => {
      woke.push(threadId);
      ackDuring?.();
      ackDuring = null;
      return { delivery: "sent" as const };
    },
  }, { batchInbox: true, inboxDebounceMs: 0 });
  const cos = e.register("t-cos", "cos", null);
  const a = e.register("t-a", "lead", "alpha");
  const b = e.register("t-b", "lead", "beta");
  const c = e.register("t-c", "lead", "gamma");
  for (const x of [cos, a, b, c]) e.setStatus(x.threadId, "idle");
  e.send(cos, a.address, "first", null, null, { severity: "ACTION" });
  e.send(cos, b.address, "second", null, null, { severity: "ACTION" });
  e.send(cos, c.address, "third", null, null, { severity: "ACTION" });
  // while a's wake is on its way, b reads and acks its digest (its own turn, another tool call)
  ackDuring = () => {
    const r = e.batch.read(b);
    e.batch.ack(b, r.cursor!);
  };
  await e.flush();
  assert.deepEqual(woke, ["t-a", "t-c"], "a is woken, b has nothing left, and c is still woken in the same flush");
});

test("the batched inbox's backfill finds open items by state, without scanning every item", () => {
  // BatchInbox.sync runs on every flush and every inbox read; live, 12k of 12.2k items were closed
  const t = traced({ batchInbox: true });
  t.reset();
  t.e.batch.sync();
  const plan = [...t.plans].find(([sql]) => sql.includes("INSERT OR IGNORE INTO inbox_entries") && sql.includes("FROM items i"))?.[1];
  assert.ok(plan, "sync's statement was planned");
  assert.doesNotMatch(plan!, /SCAN i\b(?! USING)/);
});
