// Answers that wait on a PR (2026-11-16). "Merge when approved" was acked and then sat for two days: the lead's own
// watchers died, and nothing reminded anyone. Binding the ack to the PR hands the follow-through to the PR notices the
// plugin already reads. These tests check that the answer comes back exactly when the PR gets there, that it is
// chased while it doesn't, and that nothing else fires.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult, type PrResult, WAIT_NUDGE_MS } from "../core/engine.ts";
import type { Item } from "../core/model.ts";

const URL = "https://github.com/o/r/pull/1234";
const reading = (p: Partial<{ state: string; checks: string; review: string; mergeable: string; mstate: string }>): PrResult => ({
  outcome: "available",
  pullRequest: {
    url: URL,
    number: 1234,
    state: p.state ?? "open",
    checks: { state: p.checks ?? "passing" },
    review: { state: p.review ?? "review_requested" },
    mergeability: { mergeable: p.mergeable ?? "MERGEABLE", state: p.mstate ?? "blocked" },
  },
});

function setup() {
  let clock = Date.parse("2026-11-14T02:34:00Z");
  const sent: Item[] = [];
  const e = new Engine(new DatabaseSync(":memory:") as never, {
    now: () => clock,
    async deliver(_t, _text, item): Promise<DeliverResult> {
      sent.push(item);
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-lc", "lead", "cd");
  const worker = e.register("T-w1", "thread", "cd", "T-lc");
  e.setEnvironment("T-w1", "env-1");
  // the lead's merge card, answered by the owner: "Merge when approved"
  const d = e.ask(lead, { title: "Merge 1234 once approved?", question: "Merge 1234 when the review approves it?", options: [{ label: "Merge when approved" }, { label: "Hold" }], action: "merge" });
  e.triageAskPerson(cos, d.id, { question: "Merge 1234 when approved?", options: [{ label: "Merge when approved" }, { label: "Hold" }], allowText: true });
  e.personAnswer(d.id, e.decision(d.id)!.rev, "1", null, "phone");
  const wakes = () => e.items(500).filter((i) => i.recipient === lead.address && i.sender === "orchestrator" && i.kind === "message");
  const nudges = () => e.items(500).filter((i) => i.recipient === lead.address && i.sender === "orchestrator" && i.kind === "notice" && i.body.startsWith("Still waiting"));
  return { e, lead, worker, d, wakes, nudges, see: (r: PrResult) => e.prSeen(e.agentByThread("T-w1")!, "env-1", r), advance: (ms: number) => (clock += ms) };
}

test("the bound answer comes back to the lead once, when the PR is approved, carrying the owner's choice", () => {
  const s = setup();
  s.see(reading({}));
  const out = s.e.ack(s.lead, s.d.id, "done", "waiting on the review", { pr: URL, when: "approved" });
  assert.match(out, /acked: done; bound to .*1234/);
  assert.equal(s.wakes().length, 0, "not approved yet: nothing to do");
  s.see(reading({ checks: "pending" }));
  assert.equal(s.wakes().length, 0, "another change that isn't the condition wakes nobody");
  s.see(reading({ review: "approved" }));
  const w = s.wakes();
  assert.equal(w.length, 1);
  assert.equal(w[0]!.needsAck, true, "it is the work itself now: unacked, it is resent and dead-lettered like any message");
  assert.match(w[0]!.body, /PR #1234 is approved/);
  assert.match(w[0]!.body, /option 1 "Merge when approved"/, "the lead gets what was decided, not only that something changed");
  s.see(reading({ review: "approved", mstate: "clean" }));
  assert.equal(s.wakes().length, 1, "once: the wait is over");
});

test("a PR already there when the answer is bound wakes the lead at once (no later change would)", () => {
  const s = setup();
  s.see(reading({ review: "approved" }));
  assert.match(s.e.ack(s.lead, s.d.id, "done", null, { pr: "#1234", when: "approved" }), /already/);
  assert.equal(s.wakes().length, 1);
});

test("merged meets every condition; closed unmerged ends the wait and says it never will", () => {
  const s = setup();
  s.see(reading({}));
  s.e.ack(s.lead, s.d.id, "done", null, { pr: URL, when: "ready" });
  s.see(reading({ state: "merged" }));
  assert.match(s.wakes()[0]!.body, /is ready to merge \(merged/);
  const t = setup();
  t.see(reading({}));
  t.e.ack(t.lead, t.d.id, "done", null, { pr: URL, when: "approved" });
  t.see(reading({ state: "closed" }));
  assert.match(t.wakes()[0]!.body, /closed without merging, so it will never be approved.*Decide what happens instead/);
});

test("an unmet wait reminds the lead a day after binding, then each day, never sooner", () => {
  const s = setup();
  s.see(reading({}));
  s.e.ack(s.lead, s.d.id, "done", null, { pr: URL, when: "approved" });
  s.advance(WAIT_NUDGE_MS - 60_000);
  s.e.tick();
  assert.equal(s.nudges().length, 0);
  s.advance(60_000);
  s.e.tick();
  s.e.tick();
  assert.equal(s.nudges().length, 1, "one reminder per day, not one per tick");
  assert.match(s.nudges()[0]!.body, /isn't approved yet \(unchanged for 1d: open.*review review requested/);
  s.advance(WAIT_NUDGE_MS);
  s.e.tick();
  assert.equal(s.nudges().length, 2);
  s.see(reading({ review: "approved" }));
  s.advance(WAIT_NUDGE_MS);
  s.e.tick();
  assert.equal(s.nudges().length, 2, "met: no more reminders");
});

test("two answers coming back to one lead are both kept: the second doesn't supersede the first", async () => {
  const s = setup();
  s.see(reading({}));
  s.e.ack(s.lead, s.d.id, "done", null, { pr: URL, when: "approved" });
  const d2 = s.e.ask(s.lead, { title: "Tag after merge?", question: "Tag the release once 1234 merges?", options: [{ label: "Yes" }, { label: "No" }] });
  s.e.triageAskPerson(s.e.agentByAddress("cos")!, d2.id, { question: "Tag once merged?", options: [{ label: "Yes" }, { label: "No" }], allowText: true });
  s.e.personAnswer(d2.id, s.e.decision(d2.id)!.rev, "1", null, "desktop");
  s.e.ack(s.lead, d2.id, "done", null, { pr: URL, when: "merged" });
  s.see(reading({ review: "approved" }));
  s.see(reading({ state: "merged" }));
  await s.e.flush();
  s.e.setStatus("T-lc", "idle");
  s.advance(11 * 60_000);
  s.e.tick();
  assert.deepEqual(s.wakes().map((w) => w.state), ["pending", "pending"], "both resent, neither closed as an old word");
});

test("a PR no thread shows still gets its daily reminder, which says the plugin can't see it", () => {
  const s = setup();
  const out = s.e.ack(s.lead, s.d.id, "done", null, { pr: "https://github.com/o/r/pull/9999", when: "merged" });
  assert.match(out, /No thread's environment shows this PR yet/);
  s.advance(WAIT_NUDGE_MS);
  s.e.tick();
  assert.match(s.nudges()[0]!.body, /can't see it change/);
});

test("a bad PR or condition is refused before anything is acked, and an acked card can still be bound later", () => {
  const s = setup();
  assert.throws(() => s.e.ack(s.lead, s.d.id, "done", null, { pr: "1234 please", when: "approved" }), /pull request URL/);
  assert.throws(() => s.e.ack(s.lead, s.d.id, "done", null, { pr: URL, when: "soon" }), /when is one of/);
  assert.equal(s.e.decision(s.d.id)!.state, "answered", "the refused call changed nothing");
  s.e.ack(s.lead, s.d.id, "done", "merging later");
  assert.match(s.e.ack(s.lead, s.d.id, "done", null, { pr: URL, when: "approved" }), /already acked; bound/, "a lead that acked first binds afterwards");
  assert.match(s.e.inbox(s.lead).text, /Waiting on PRs \(1\):\n- d-\S+: until .*1234 is approved/);
});
