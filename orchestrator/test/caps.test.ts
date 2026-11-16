// Hard size caps (2026-11-16). The 1.1.0 "less text" format shrank card questions but left whole cards at ~920
// characters and deliverables growing, so the server now refuses what is too long. What matters to the owner: an
// oversized card never reaches them, the asker is told which field, its cap and its length, and where the detail goes;
// a typical good card (long how-to in blocks) still passes; and a card already stored is never stuck by the new caps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { CARD_CAPS, DELIVER_BUDGET, cardRefusal, deliverBudgetRefusal, visibleText } from "../core/caps.ts";
import type { Block, Point } from "../blocks.ts";

function setup() {
  let clock = Date.parse("2026-11-16T10:00:00Z");
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, { now: () => clock, deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-la", "lead", "alpha");
  return { e, db, cos, lead, advance: (ms: number) => (clock += ms) };
}
const x = (n: number) => "x".repeat(n);
const two = [{ label: "Go" }, { label: "Wait" }];

test("a typical good card passes: a short question, short details, and the how-to in blocks (which don't count)", () => {
  const s = setup();
  const steps: Block = { kind: "steps", items: Array.from({ length: 8 }, (_, i) => ({ text: `step ${i}: ${x(250)}` })) };
  const command: Block = { kind: "command", text: x(2000), where: "runner" };
  const d = s.e.ask(s.lead, { title: "Run it?", question: x(CARD_CAPS.question), context: x(CARD_CAPS.context), options: [{ label: "Go", detail: x(CARD_CAPS.detail) }, { label: "Wait" }], blocks: [steps, command] });
  assert.equal(d.state, "open");
  assert.equal(s.e.needsYou().triaging.length, 1, "it went on to the CoS");
});

test("an oversized card is refused with its field, cap and length, and nothing is filed", () => {
  const s = setup();
  const cases: [Parameters<Engine["ask"]>[1], RegExp][] = [
    [{ title: "Q", question: x(243), options: two }, /^question is 243 characters; the cap is 160\. .*blocks \(steps, command, list, facts\) or a doc/],
    [{ title: "Q", question: "Go?", options: [{ label: "Go", detail: x(121) }, { label: "Wait" }] }, /^option 1's detail is 121 characters; the cap is 120\./],
    [{ title: "Q", question: "Go?", context: x(601), options: two }, /^context is 601 characters; the cap is 600\./],
    [{ title: "Q", question: "Go?", context: x(1601), options: two, kind: "plan" }, /^context is 1601 characters; the cap is 1600 for a plan\./],
  ];
  for (const [input, why] of cases) assert.throws(() => s.e.ask(s.lead, input), (e: Error) => why.test(e.message), JSON.stringify(input).slice(0, 80));
  assert.equal((s.db.prepare(`SELECT COUNT(*) AS n FROM decisions`).get() as { n: number }).n, 0, "no card exists");
  assert.equal(s.e.needsYou().triaging.length + s.e.needsYou().cards.length, 0, "neither the CoS nor the owner sees anything");
});

test("a plan's thread list gets the larger cap: a 1,400-character list passes where a question's context wouldn't", () => {
  const s = setup();
  const d = s.e.ask(s.lead, { title: "Plan", question: "Start 3 threads?", context: x(1400), options: two, kind: "plan", threads: 3 });
  assert.equal(d.kind, "plan");
  assert.throws(() => s.e.ask(s.lead, { title: "Q", question: "Go?", context: x(1400), options: two }), /context is 1400 characters; the cap is 600/);
});

test("the CoS's wording is what the owner reads, so ask_person has the same caps; the refused card stays with the CoS", () => {
  const s = setup();
  const d = s.e.ask(s.lead, { title: "Go?", question: "alpha: go?", context: x(500), options: two });
  assert.throws(() => s.e.triageAskPerson(s.cos, d.id, { question: x(298), options: two, allowText: true }), /question is 298 characters; the cap is 160/);
  assert.throws(() => s.e.triageAskPerson(s.cos, d.id, { question: "Go?", options: [{ label: "Go", detail: x(130) }, { label: "Wait" }], allowText: true }), /option 1's detail is 130/);
  assert.equal(s.e.needsYou().cards.length, 0, "nothing reached the owner");
  assert.equal(s.e.decision(d.id)!.state, "open", "still with the CoS to reword");
  // leaving the context out keeps the asker's, which passed at filing
  s.e.triageAskPerson(s.cos, d.id, { question: "alpha: go now?", options: two, allowText: true });
  assert.equal(s.e.needsYou().cards.length, 1);
});

test("a card stored before the caps still escalates: the caps hold at entry, never on the clock", () => {
  const s = setup();
  const d = s.e.ask(s.lead, { title: "Go?", question: "Go?", options: two });
  // as if filed by 1.4.0: a 500-character question already in the store
  const j = s.e.decision(d.id)!;
  j.request.question = x(500);
  s.db.prepare(`UPDATE decisions SET json = ? WHERE id = ?`).run(JSON.stringify(j), d.id);
  s.advance(6 * 60_000);
  s.e.tick();
  assert.equal(s.e.decision(d.id)!.state, "asked", "the untriaged card still reaches the owner");
});

const point = (h: number, w: number): Point => ({ kind: "finding", headline: x(h), why: x(w) });

test("a deliverable's visible text has a budget; the refusal names each part's size and what to cut", () => {
  // a typical one (summary 150, 4 points, two small blocks) is about 1.2K and passes
  const facts: Block = { kind: "facts", items: [{ label: "CI", value: "green" }, { label: "QA", value: "4 of 7" }] };
  assert.equal(deliverBudgetRefusal({ summary: x(150), points: [point(60, 100), point(60, 100), point(60, 100), point(60, 100)], blocks: [facts] }), null);
  // the 7-PR review that set off "way less text" ran to about 2.1K
  const verdicts: Block = { kind: "verdicts", items: Array.from({ length: 7 }, (_, i) => ({ url: `https://github.com/acme/app/pull/${i + 1}`, name: x(30), verdict: x(20) })) };
  const decisions: Block = { kind: "decisions", items: Array.from({ length: 5 }, () => ({ text: x(70), why: x(110), status: "made" as const })) };
  const r = deliverBudgetRefusal({ summary: x(112), points: Array.from({ length: 6 }, () => point(70, 110)), blocks: [verdicts, decisions] })!;
  assert.match(r, new RegExp(`visible text is \\d+ characters \\(summary 112, points 1080, blocks \\d+\\); the budget is ${DELIVER_BUDGET}\\. Cut \\d+, starting with the (points|blocks)`));
});

test("an old-schema lead (no points) doesn't slip past the budget with a long summary", () => {
  assert.match(deliverBudgetRefusal({ summary: x(900), blocks: [{ kind: "steps", items: [{ text: x(300) }, { text: x(300) }, { text: x(100) }] }] })!, /budget is 1500.*starting with the summary/);
});

test("only drawn text counts: links, ids and enums are free, so a PR tile isn't charged for its URL", () => {
  assert.equal(visibleText([{ kind: "pr", url: `https://github.com/acme/app/pull/1${x(200)}`, note: "ready" }]), 5);
  assert.equal(cardRefusal({ question: " ".repeat(10) + x(160) + " ", options: [] }), null, "whitespace around the question isn't counted");
});
