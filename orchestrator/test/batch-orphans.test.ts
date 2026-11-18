// Mail no live agent can take (2026-11-17). Just after the batched inbox was switched on, nine wakes sat pending for
// good: their recipients were retired, or addresses no agent ever held, and flush only wakes a live idle agent. Such
// mail must become a dead letter for the CoS, leave the unread and take its wake with it. A retired holder's mail dies
// at once; an address nobody holds yet may be a lead or CoS about to register, so its mail waits a day for one first.
// A stopped agent still holds its address, so its mail and wake wait for it; a live agent's wake is unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, UNHELD_GRACE_MS, type DeliverResult } from "../core/engine.ts";
import type { Item } from "../core/model.ts";

function world(batchInbox: boolean) {
  const db = new DatabaseSync(":memory:");
  const clock = { t: Date.parse("2026-11-17T12:00:00Z") };
  const sent: { threadId: string; item: Item }[] = [];
  const ports = {
    now: () => clock.t,
    deliver: async (threadId: string, _text: string, item: Item): Promise<DeliverResult> => {
      sent.push({ threadId, item });
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  };
  const e = new Engine(db as never, ports, { batchInbox, inboxDebounceMs: 2000, resendMs: 600_000 });
  const cos = e.register("T-cos", "cos", null);
  const alpha = e.register("T-a", "lead", "alpha");
  e.register("T-b", "lead", "beta");
  for (const t of ["T-cos", "T-a", "T-b"]) e.setStatus(t, "idle");
  /** Mail left from before this sweep, `age` old: written straight to the table, as the live install has it. */
  const legacy = (id: string, recipient: string, state: "pending" | "delivered", age = 0) =>
    db
      .prepare(`INSERT INTO items (id, recipient, sender, kind, body, needs_ack, state, attempts, created_at, delivered_at) VALUES (?, ?, 'lead:alpha', 'message', 'old', 1, ?, ?, ?, ?)`)
      .run(id, recipient, state, state === "delivered" ? 1 : 0, clock.t - age, state === "delivered" ? clock.t - age : null);
  /** A retirement from before this sweep: the role is retired, its delivered mail left as it was. */
  const retiredBefore = (threadId: string) => db.prepare(`UPDATE agents SET retired_at = ? WHERE thread_id = ?`).run(clock.t, threadId);
  const state = (id: string) => e.items(500).find((i) => i.id === id)!.state;
  const entry = (id: string) => (db.prepare(`SELECT acked_at FROM inbox_entries WHERE item_id = ?`).get(id) as { acked_at: number | null } | undefined)?.acked_at;
  const wake = (recipient: string) => (db.prepare(`SELECT state FROM inbox_wakes WHERE recipient = ?`).get(recipient) as { state: string } | undefined)?.state ?? null;
  const woke = (threadId: string) => sent.filter((x) => x.threadId === threadId && x.item.id.startsWith("wake:")).length;
  /** The server's pass: tick, then flush. */
  const pass = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.t += 3000;
      e.tick();
      await e.flush();
    }
  };
  return { db, e, cos, alpha, clock, sent, legacy, retiredBefore, state, entry, wake, woke, pass };
}

test("batched: mail to a never-held address past the grace, and fresh mail to a retired one, is a dead letter for the CoS, its entry closes, no wake stays", async () => {
  const w = world(true);
  w.legacy("i-nobody", "thread:gamma:1", "pending", 2 * UNHELD_GRACE_MS);
  w.legacy("i-retired", "lead:beta", "delivered"); // just sent: a retired holder's mail doesn't wait
  w.retiredBefore("T-b");
  await w.e.flush(); // the backfill indexes them and each gets a wake, as on the live install
  assert.equal(w.wake("thread:gamma:1"), "pending", "precondition: a wake nobody can take");
  assert.equal(w.wake("lead:beta"), "pending");
  const live = w.e.send(w.cos, w.alpha.address, "status?", null);
  await w.pass(3);
  for (const id of ["i-nobody", "i-retired"]) {
    assert.equal(w.state(id), "dead", `${id} is a dead letter, not a wait`);
    assert.ok(w.e.items(500).find((i) => i.id === id)!.deadAt, "through the dead-letter path: it has its death time");
    assert.equal(w.entry(id), -1, `${id} left the unread as dropped, never as read`);
  }
  assert.deepEqual(w.e.deadLetters().map((d) => d.id).sort(), ["i-nobody", "i-retired"]);
  assert.match(w.e.items(500).find((i) => i.recipient === "cos" && /new dead letters/.test(i.body))!.body, /^2 new dead letters/, "the CoS's hourly notice lists them");
  assert.equal(w.wake("thread:gamma:1"), null, "no wake waits for an address nobody holds");
  assert.equal(w.wake("lead:beta"), null);
  assert.equal(w.woke("T-a"), 1, "a live idle agent still gets its one wake");
  assert.notEqual(w.state(live.id), "dead");
});

test("batched: a stopped agent keeps its mail and its wake until it runs again", async () => {
  const w = world(true);
  w.e.register("T-w", "thread", "alpha", "T-a");
  const it = w.e.send(w.alpha, "thread:alpha:1", "keep going", null);
  w.e.setStatus("T-w", "stopped");
  await w.pass(5);
  assert.equal(w.state(it.id), "pending", "stopped is not retired: the address is still held");
  assert.equal(w.entry(it.id), null, "still unread");
  assert.equal(w.wake("thread:alpha:1"), "pending", "its wake waits for it");
  assert.equal(w.woke("T-w"), 0);
  w.e.setStatus("T-w", "active");
  w.e.setStatus("T-w", "idle");
  await w.pass(2);
  assert.equal(w.woke("T-w"), 1, "once it runs again the wake goes");
});

test("per-message: mail to an address no agent ever held is a dead letter too, past the grace", async () => {
  const w = world(false);
  w.legacy("i-nobody", "thread:gamma:1", "pending", 2 * UNHELD_GRACE_MS);
  await w.pass(2);
  assert.equal(w.state("i-nobody"), "dead");
  assert.equal(w.sent.some((x) => x.item.id === "i-nobody"), false);
  assert.throws(() => w.e.resend("i-nobody"), /no live agent/, "a resend to nobody would only die again");
});

/** A thread in a project whose lead isn't registered yet asks a question: the engine mails it to lead:gamma. */
function askUnledLead(w: ReturnType<typeof world>) {
  const t = w.e.register("T-g", "thread", "gamma");
  w.e.setStatus(t.threadId, "idle");
  const d = w.e.ask(t, { title: "Which?", question: "Which way?", options: [{ label: "Left" }, { label: "Right" }] });
  return w.e.items(500).find((i) => i.recipient === "lead:gamma" && i.ref === d.id)!;
}

test("batched: mail to a lead that isn't registered yet waits, wake and all, and reaches the lead when it registers", async () => {
  const w = world(true);
  const it = askUnledLead(w);
  await w.pass(1);
  w.clock.t += UNHELD_GRACE_MS - 60_000; // most of a day: the lead may still be on its way
  await w.pass(2);
  assert.equal(w.state(it.id), "pending", "not a dead letter inside the grace");
  assert.equal(w.entry(it.id), null, "still unread");
  assert.equal(w.wake("lead:gamma"), "pending", "its wake waits, as for a stopped agent");
  w.e.register("T-lg", "lead", "gamma");
  w.e.setStatus("T-lg", "idle");
  await w.pass(2);
  assert.equal(w.woke("T-lg"), 1, "the new lead is woken for it");
  assert.match(w.e.batch.read(w.e.agentByAddress("lead:gamma")!).text, new RegExp(it.id), "and it is in the lead's digest");
});

test("batched: mail to an address still unheld after the grace is a dead letter, and its wake goes", async () => {
  const w = world(true);
  const it = askUnledLead(w);
  await w.pass(1);
  assert.equal(w.wake("lead:gamma"), "pending");
  w.clock.t += UNHELD_GRACE_MS;
  await w.pass(1);
  assert.equal(w.state(it.id), "dead", "nobody came for it: the CoS's to handle");
  assert.match(w.e.items(500).find((i) => i.id === it.id)!.note ?? "", /no agent took that address/);
  assert.equal(w.entry(it.id), -1);
  assert.equal(w.wake("lead:gamma"), null);
});

test("the engine's own address is no dead letter: a dream card's answer waits for the card's ack, and no wake waits on it", async () => {
  const w = world(true);
  const card = w.e.orchestratorAsk({ title: "Publish?", question: "Publish the pages?", options: [{ label: "Yes" }, { label: "No" }], key: "dream:1", allowText: false });
  w.e.personAnswer(card.id, w.e.decision(card.id)!.rev, "1", null, "desktop");
  const answer = w.e.items(500).find((i) => i.recipient === "orchestrator" && i.ref === card.id)!;
  await w.pass(3);
  w.clock.t += 2 * UNHELD_GRACE_MS; // an answer no service acks (a proof card's) is still not undeliverable mail
  await w.pass(1);
  assert.equal(w.state(answer.id), "pending", "not the CoS's to handle, however long it waits");
  assert.equal(w.e.deadLetters().length, 0);
  assert.equal(w.entry(answer.id), -1, "nothing reads that inbox: its entry is dropped");
  assert.equal(w.wake("orchestrator"), null);
  w.e.orchestratorAck(card.id, "done", "published");
  assert.equal(w.state(answer.id), "closed", "the card's ack still closes it");
});
