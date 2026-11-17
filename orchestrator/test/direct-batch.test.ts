// The owner's direct line (direct.test.ts) with the batched inbox on. Batching changes how mail reaches a lead (one
// wake, then a digest), not what a direct message is: the digest still states its rules, a digest's cursor ack is
// "read", never the lead's answer, and a message the last lead read but never answered passes to the next lead as
// unread mail, not as something already read.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import type { Item } from "../core/model.ts";

function setup() {
  const clock = { t: Date.parse("2026-11-16T10:00:00Z") };
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
  const e = new Engine(new DatabaseSync(":memory:") as never, ports as never, { owner: "Robin", batchInbox: true, inboxDebounceMs: 2000 });
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-lead", "lead", "kite");
  for (const a of [cos, lead]) e.setStatus(a.threadId, "idle");
  const step = async (n = 2) => {
    for (let i = 0; i < n; i++) {
      clock.t += 3000;
      await e.flush();
    }
  };
  return { e, cos, lead, sent, step };
}

test("a direct message wakes its lead once, and the digest states its rules", async () => {
  const s = setup();
  const it = s.e.ownerMessage("kite", "Wait for the legal review.");
  await s.step();
  assert.equal(s.sent.filter((x) => x.threadId === "T-lead" && x.item.id.startsWith("wake:")).length, 1);
  assert.equal(s.sent.filter((x) => x.item.kind === "owner.message").length, 0, "batched: no per-message send");
  const { text } = s.e.batch.read(s.lead);
  assert.match(text, new RegExp(`direct message ${it.id} from Robin`));
  assert.match(text, /this is not an approval/i, "the gates are in the digest too");
});

test("a digest's cursor ack reads a direct message but doesn't answer it; the lead's ack with a note does", async () => {
  const s = setup();
  const it = s.e.ownerMessage("kite", "Can you drop the beta flag?");
  await s.step();
  s.e.batch.ack(s.lead, s.e.batch.read(s.lead).cursor!);
  const line = () => s.e.directLines().get("kite")!.messages[0]!;
  assert.equal(line().state, "delivered", "read, still open: the lead must still answer it");
  assert.equal(line().note, null);
  s.e.ack(s.lead, it.id, "done", "Dropped in the next deploy.");
  assert.deepEqual([line().state, line().note], ["closed", "Dropped in the next deploy."]);
  assert.ok(s.e.items(500).some((x) => x.recipient === "cos" && x.kind === "copy" && x.ref === it.id && /Dropped in the next deploy/.test(x.body)), "the CoS gets the note's copy");
});

test("a direct message the last lead read in a digest but never answered is unread for the next lead", async () => {
  const s = setup();
  const it = s.e.ownerMessage("kite", "Start on the export feature.");
  await s.step();
  s.e.batch.ack(s.lead, s.e.batch.read(s.lead).cursor!); // read, never answered
  s.e.retire("T-lead");
  assert.notEqual(s.e.items(500).find((x) => x.id === it.id)!.state, "dead", "it is for kite's lead, whoever that is");
  const next = s.e.register("T-lead2", "lead", "kite");
  s.e.setStatus(next.threadId, "idle");
  await s.step();
  assert.ok(s.sent.some((x) => x.threadId === "T-lead2" && x.item.id.startsWith("wake:")), "the new lead is woken for it");
  const digest = s.e.batch.read(next);
  assert.match(digest.text, new RegExp(`direct message ${it.id} from Robin`));
  s.e.ack(next, it.id, "done", "Picked up from the last lead.");
  assert.equal(s.e.directLines().get("kite")!.messages[0]!.note, "Picked up from the last lead.");
});
