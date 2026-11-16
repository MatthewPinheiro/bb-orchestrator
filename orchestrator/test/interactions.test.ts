// Answering an agent's own question (AskUserQuestion) from Needs you. What matters: the owner's pick reaches the agent as
// exactly what it offered. A stale card, a forged request or a slip must never hand the agent an option it never
// listed, two picks for a one-pick question, or a skipped required question, because the agent acts on it as his word.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAnswers, toQuestions } from "../interactions.ts";

const payload = {
  kind: "user_question",
  questions: [
    { id: "q1", prompt: "Merge PR 1056 now?", shortLabel: "Merge 1056", allowFreeText: true, multiSelect: false, options: [{ label: "Merge (Recommended)", value: "merge" }, { label: "Wait", value: "wait" }] },
    { id: "q2", prompt: "Which checks to rerun?", allowFreeText: false, multiSelect: true, required: false, options: [{ label: "e2e", value: "e2e" }, { label: "lint", value: "lint" }] },
  ],
};
const qs = toQuestions(payload);

test("bb's payload reads with its defaults: required unless it says otherwise", () => {
  assert.equal(qs.length, 2);
  assert.equal(qs[0]!.required, true); // bb's schema defaults required to true
  assert.equal(qs[1]!.required, false);
  assert.equal(qs[1]!.shortLabel, null);
  assert.deepEqual(toQuestions({ kind: "user_question" }), []);
});

test("a pick and an untouched optional question go back as the agent offered them", () => {
  assert.deepEqual(checkAnswers(qs, { q1: { selected: ["merge"] } }), { q1: { selected: ["merge"] } });
  assert.deepEqual(checkAnswers(qs, { q1: { selected: [], freeText: "  after lunch " }, q2: { selected: ["e2e", "lint"] } }), {
    q1: { selected: [], freeText: "after lunch" },
    q2: { selected: ["e2e", "lint"] },
  });
});

test("anything the agent didn't offer is refused, so it never acts on an answer it can't have asked for", () => {
  assert.throws(() => checkAnswers(qs, { q1: { selected: ["deploy"] } }), /isn't one of the options/);
  assert.throws(() => checkAnswers(qs, { q1: { selected: ["merge", "wait"] } }), /Pick one/);
  assert.throws(() => checkAnswers(qs, { q1: { selected: ["merge"] }, q2: { selected: [], freeText: "all" } }), /own answer isn't allowed/);
  assert.throws(() => checkAnswers(qs, { q1: { selected: ["merge"] }, q9: { selected: [] } }), /No question "q9"/);
  assert.throws(() => checkAnswers(qs, { q2: { selected: ["e2e"] } }), /Answer: Merge 1056/); // required q1 skipped
  assert.throws(() => checkAnswers(qs, { q1: { selected: [], freeText: "   " } }), /Answer: Merge 1056/); // blank text is no answer
});
