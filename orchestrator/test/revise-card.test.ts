// An asker revises its own unanswered card (2026-11-20). The owner said something that made a card's options stale, and
// the lead could neither change it (re-asking with its key returned the old card) nor withdraw it (only the CoS moots).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import type { Item } from "../core/model.ts";

function setup() {
  let clock = Date.parse("2026-11-20T15:00:00Z");
  const e = new Engine(new DatabaseSync(":memory:") as never, {
    now: () => clock,
    async deliver(_t, _text, _item): Promise<DeliverResult> {
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  }, { batchInbox: false });
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-la", "lead", "alpha");
  const other = e.register("T-lb", "lead", "beta");
  const worker = e.register("T-w1", "thread", "alpha", "T-la");
  const toCos = (id: string): Item[] => e.items(500).filter((i) => i.recipient === "cos" && i.ref === id);
  return { e, cos, lead, other, worker, toCos, advance: (ms: number) => (clock += ms) };
}

const stale = { title: "Which colour?", question: "Paint the button red or blue?", options: [{ label: "Red" }, { label: "Blue" }] };
const fresh = { title: "Which shade of green?", question: "The owner wants green: light or dark?", options: [{ label: "Light green" }, { label: "Dark green" }, { label: "Leave it" }] };

/** A lead's card the CoS put on the owner's Needs you. */
function onNeedsYou(s: ReturnType<typeof setup>) {
  const d = s.e.ask(s.lead, stale);
  s.e.triageAskPerson(s.cos, d.id, { question: "alpha: red or blue button?", options: stale.options, allowText: true });
  return s.e.decision(d.id)!;
}

test("revising a card on Needs you keeps its id, bumps its rev and shows the new options in place", () => {
  const s = setup();
  const before = onNeedsYou(s);
  const r = s.e.ask(s.lead, { ...fresh, revises: before.id, why: "the owner said green in a direct message" });
  assert.equal(r.id, before.id);
  assert.ok(r.rev > before.rev);
  assert.equal(r.state, "asked", "still on Needs you: no second triage");
  assert.equal(r.orchestrator.at_level, "person");
  const card = s.e.needsYou().cards.find((c) => c.id === before.id)!;
  assert.equal(card.ask!.title, fresh.title);
  assert.equal(card.ask!.question, fresh.question, "the asker's new wording replaces the CoS's");
  assert.deepEqual(card.ask!.options.map((o) => o.label), ["Light green", "Dark green", "Leave it"]);
  assert.equal(card.ask!.options[0]!.recommended, true);
  assert.equal(card.ask!.allow_text, true, "what the CoS allowed is kept");
  assert.deepEqual(r.orchestrator.revised, { count: 1, at: r.updated_at, why: "the owner said green in a direct message" });
  assert.equal(r.history.at(-1)!.event, "revise");
  assert.equal(s.e.needsYou().cards.length, 1, "one card, not two");
});

test("an answer sent against the old rev is refused; the new rev answers with the new options", () => {
  const s = setup();
  const before = onNeedsYou(s);
  const r = s.e.ask(s.lead, { ...fresh, revises: before.id, why: "green now" });
  assert.throws(() => s.e.personAnswer(before.id, before.rev, "1", null, "desktop"), /changed since you saw it/);
  assert.equal(s.e.decision(before.id)!.state, "asked", "nothing was answered");
  const a = s.e.personAnswer(r.id, r.rev, "2", null, "desktop");
  assert.equal(a.answer!.label, "Dark green");
});

test("only the card's asker revises it", () => {
  const s = setup();
  const d = onNeedsYou(s);
  assert.throws(() => s.e.ask(s.other, { ...fresh, revises: d.id, why: "x" }), /only lead:alpha, who asked/);
  assert.throws(() => s.e.ask(s.worker, { ...fresh, revises: d.id, why: "x" }), /only lead:alpha, who asked/);
  assert.throws(() => s.e.ask(s.cos, { ...fresh, revises: d.id, why: "x" }), /CoS asks/);
  // a forwarded question belongs to the lead now: its first-asking thread can't change what the owner sees
  const q = s.e.ask(s.worker, stale);
  s.e.forward(s.lead, q.id, null);
  assert.throws(() => s.e.ask(s.worker, { ...fresh, revises: q.id, why: "x" }), /only lead:alpha/);
  assert.equal(s.e.decision(d.id)!.request.title, stale.title);
});

test("an answered, moot or bounced card can't be revised", () => {
  const s = setup();
  const answered = onNeedsYou(s);
  s.e.personAnswer(answered.id, answered.rev, "1", null, "desktop");
  assert.throws(() => s.e.ask(s.lead, { ...fresh, revises: answered.id, why: "x" }), /is answered: only an unanswered card/);
  const moot = s.e.ask(s.lead, { ...stale, title: "Moot one?" });
  s.e.moot(s.cos, moot.id, "the PR merged");
  assert.throws(() => s.e.ask(s.lead, { ...fresh, revises: moot.id, why: "x" }), /is withdrawn \(moot: the PR merged\)/);
  const bounced = s.e.ask(s.lead, { ...stale, title: "Bounced one?" });
  s.e.triageBounce(s.cos, bounced.id, "say where it runs");
  assert.throws(() => s.e.ask(s.lead, { ...fresh, revises: bounced.id, why: "x" }), /is withdrawn/);
});

test("a revision gets a new card's checks: caps, option counts, a reason, its kind", () => {
  const s = setup();
  const d = onNeedsYou(s);
  assert.throws(() => s.e.ask(s.lead, { ...fresh, options: [{ label: "Only one" }], revises: d.id, why: "x" }), /give 2 to 4 options/);
  assert.throws(() => s.e.ask(s.lead, { ...fresh, question: "x".repeat(400), revises: d.id, why: "x" }), /question/);
  assert.throws(() => s.e.ask(s.lead, { ...fresh, revises: d.id }), /why .* is empty/);
  assert.throws(() => s.e.ask(s.lead, { ...fresh, kind: "plan", revises: d.id, why: "x" }), /keeps its kind/);
  assert.throws(() => s.e.ask(s.lead, { ...fresh, options: [{ label: "A" }, { label: "a" }], revises: d.id, why: "x" }), /same label/);
  assert.equal(s.e.decision(d.id)!.rev, d.rev, "a refused revision changes nothing");
});

test("a plan revision keeps exactly one go, may change its thread count, and spawn works off the new go", () => {
  const s = setup();
  const plan = s.e.ask(s.lead, { title: "Plan: button", question: "Start 1 thread to paint it red?", kind: "plan", threads: 1, options: [{ label: "Go" }, { label: "Not now" }] });
  s.e.triageAskPerson(s.cos, plan.id, { question: "alpha: start 1 thread?", options: [], allowText: false });
  const two = [{ label: "Hold off" }, { label: "Go with two", go: true }];
  assert.throws(() => s.e.ask(s.lead, { title: "Plan: green", question: "q?", kind: "plan", options: [{ label: "A", go: true }, { label: "B", go: true }], revises: plan.id, why: "x" }), /exactly one go/);
  const r = s.e.ask(s.lead, { title: "Plan: green", question: "Start 2 threads to paint it green?", kind: "plan", threads: 2, options: two, revises: plan.id, why: "the owner wants green" });
  assert.deepEqual(r.orchestrator.plan, { threads: 2, go: "2" });
  assert.equal(r.ask!.allow_text, false, "a plan is still answered only with an option");
  // the old go (option 1) is now "Hold off": answering it is no go
  const a = s.e.personAnswer(r.id, r.rev, "2", null, "desktop");
  assert.equal(a.answer!.label, "Go with two");
  s.e.reserveSpawn(s.lead, plan.id);
  s.e.reserveSpawn(s.lead, plan.id);
  assert.throws(() => s.e.reserveSpawn(s.lead, plan.id), /allows 2 thread\(s\); all started/, "the new thread count is the cap");
});

test("a plan answered with the option that used to be its go doesn't start threads", () => {
  const s = setup();
  const plan = s.e.ask(s.lead, { title: "Plan: button", question: "Start 1 thread?", kind: "plan", options: [{ label: "Go" }, { label: "Not now" }] });
  s.e.triageAskPerson(s.cos, plan.id, { question: "alpha: start 1 thread?", options: [], allowText: false });
  const r = s.e.ask(s.lead, { title: "Plan: button", question: "Start 1 thread, or not?", kind: "plan", options: [{ label: "Not now" }, { label: "Go", go: true }], revises: plan.id, why: "x" });
  s.e.personAnswer(r.id, r.rev, "1", null, "desktop");
  assert.throws(() => s.e.reserveSpawn(s.lead, plan.id), /not its go option/);
});

test("the CoS gets a read-only copy when a card on Needs you is revised, with why", () => {
  const s = setup();
  const d = onNeedsYou(s);
  s.e.ask(s.lead, { ...fresh, revises: d.id, why: "the owner said green" });
  const copy = s.toCos(d.id).find((i) => i.kind === "copy")!;
  assert.ok(copy, "a copy, not something to triage");
  assert.equal(copy.needsAck, false);
  assert.match(copy.body, /lead:alpha revised .* \(revision 1\), already on .*Needs you: "the owner said green"\. Read-only copy/);
  assert.match(copy.body, /"Light green"/);
  // a second revision is a second copy (its own key), not a duplicate dropped
  s.e.ask(s.lead, { ...fresh, title: "Green, final?", revises: d.id, why: "again" });
  assert.equal(s.toCos(d.id).filter((i) => i.kind === "copy").length, 2);
});

test("a card still waiting for triage just updates, and the CoS is told to triage the new version", () => {
  const s = setup();
  const d = s.e.ask(s.lead, stale);
  const r = s.e.ask(s.lead, { ...fresh, revises: d.id, why: "green now" });
  assert.equal(r.state, "open");
  assert.equal(r.orchestrator.at_level, "cos");
  assert.equal(r.ask, null);
  const notice = s.toCos(d.id).find((i) => i.kind === "notice")!;
  assert.match(notice.body, /revised .* before you triaged it: "green now"\. Triage this version/);
  assert.match(notice.body, /"Light green"/);
  s.e.triageAskPerson(s.cos, d.id, { question: fresh.question, options: fresh.options, allowText: true });
  assert.equal(s.e.needsYou().cards[0]!.ask!.title, fresh.title, "the triaged card is the new version");
});

test("a thread revises its own question while its lead holds it, and the lead is told", () => {
  const s = setup();
  const d = s.e.ask(s.worker, stale);
  const r = s.e.ask(s.worker, { ...fresh, revises: d.id, why: "found out" });
  assert.equal(r.request.title, fresh.title);
  const notice = s.e.items(500).find((i) => i.recipient === "lead:alpha" && i.kind === "notice" && i.ref === d.id)!;
  assert.match(notice.body, /thread:alpha:\d+ revised .* "found out"/);
});
