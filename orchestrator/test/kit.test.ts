// The Projects tab's components as data (app/kit.ts): what the approved grading (2026-11-17) promises the owner, checked
// where the JSX can't be. Each test names the promise it keeps.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Projects, SummaryWait } from "../contract.ts";
import type { Lane } from "../app/lanes.ts";
import type { RowState } from "../app/command-center.ts";
import { DETAIL_LAYOUT, STATE_CHIP, ageSpec, detailOrder, laneChip, listRow, pinWhen, prChips, prRows, projectState, threadCards, ticketOf, titleOf, type ChipSpec } from "../app/kit.ts";

const NOW = Date.parse("2026-11-17T15:00:00");
const H = 3_600_000;
type P = Projects[number];
type Pr = NonNullable<P["prs"]>[number];
const wait = (w: Partial<SummaryWait>): SummaryWait => ({ source: "live", kind: "pr", ref: null, who: null, label: null, since: null, unchanged: false, note: null, ...w });
const pr = (number: number, x: Partial<Pr> = {}): Pr => ({ number, url: `https://github.com/o/r/pull/${number}`, state: "open", checks: "passing", review: null, attention: null, ...x });
const project = (slug: string, x: Partial<P> & { waits?: SummaryWait[]; blockers?: string[]; cards?: number; motion?: string } = {}): P =>
  ({
    slug,
    priority: "normal",
    heldAt: null,
    archivedAt: null,
    lead: { address: `lead:${slug}`, threadId: `T-${slug}`, status: "idle", mon: null },
    threads: 0,
    monType: null,
    status: { goal: `Ship ${slug}`, steps: [{ title: "Build", state: "current" }], waitingOn: { kind: "none", ref: null, label: null }, blockers: x.blockers ?? [], updatedAt: NOW - H, by: `lead:${slug}` },
    summary: {
      motion: x.motion ?? "waiting",
      threads: { working: 0, total: 0 },
      leadWorking: false,
      needsYou: { count: x.cards ?? 0, id: null, title: null, question: null, since: null },
      waits: x.waits ?? [],
      blockers: x.blockers ?? [],
      statusOutOfDate: false,
      done: null,
      last: null,
      leadIdleSince: null,
    },
    ...x,
  }) as P;
const lane = (address: string, x: Partial<Lane> & { role?: string; pr?: Pr } = {}): Lane =>
  ({ agent: { address, threadId: `T-${address}`, role: x.role ?? "thread", pr: x.pr ?? null } as unknown as Lane["agent"], state: "idle", since: null, activity: null, model: null, wait: null, ...x }) as Lane;

const words = (cs: ChipSpec[]) => cs.map((c) => c.word);

test("every project state has a chip with an icon and a word: colour is never the only signal (Pokémon off, colour-blind)", () => {
  const states: Exclude<RowState, "you">[] = ["blocked", "moving", "waiting", "quiet", "held", "nolead"];
  assert.deepEqual(Object.keys(STATE_CHIP).sort(), [...states].sort(), "a RowState without a chip would draw nothing");
  for (const s of states) {
    const c = STATE_CHIP[s];
    assert.ok(c.icon && c.word.trim(), `${s} needs an icon and a word`);
  }
  // two states that share a tone must still differ in icon and word
  const seen = new Set(states.map((s) => `${STATE_CHIP[s].icon}|${STATE_CHIP[s].word}`));
  assert.equal(seen.size, states.length);
});

test("needing the owner is a number beside the state, not a state: a blocked project that also needs the owner still reads Blocked", () => {
  const p = project("otter", { cards: 1, blockers: ["4121 needs 2 human approvals"] });
  assert.equal(projectState(p, []), "blocked");
  const r = listRow(p, [], NOW, false);
  assert.equal(r.chip.word, "Blocked");
  assert.deepEqual(r.number, { tone: "need", icon: "you", word: "1 for you" });
  // with nothing blocking, the state says whether it moves, not that it needs the owner
  assert.equal(projectState(project("kestrel", { cards: 1 }), [lane("thread:kestrel:2", { state: "working" })]), "moving");
  assert.equal(projectState(project("kestrel", { cards: 1 }), []), "waiting");
});

test("a list row shows one number, the one that matters most: for you, then blocked (unless the chip says it), waits, PRs", () => {
  const waits = [wait({ ref: "x" }), wait({ ref: "y" })];
  assert.equal(listRow(project("a", { cards: 2, waits, prs: [pr(1)] }), [], NOW, false).number?.word, "2 for you");
  // blocked already says "Blocked": repeating "1 blocked" beside it would waste the one number
  assert.equal(listRow(project("b", { blockers: ["x"], waits }), [], NOW, false).number?.word, "2 waits");
  assert.equal(listRow(project("c", { waits: [waits[0]!] }), [], NOW, false).number?.word, "1 wait");
  assert.equal(listRow(project("d", { prs: [pr(1), pr(2), pr(3, { state: "merged" })] }), [], NOW, false).number?.word, "2 PRs");
  assert.equal(listRow(project("e"), [], NOW, false).number, null);
});

test("a list row's age is the lead's status age, flagged when old, and says so when there is none", () => {
  assert.deepEqual(
    (({ text, old }) => ({ text, old }))(listRow(project("a", { status: { ...project("a").status!, updatedAt: NOW - 25 * 60_000 } }), [], NOW, false).age),
    { text: "25m", old: false },
  );
  assert.equal(listRow(project("b", { status: { ...project("b").status!, updatedAt: NOW - 5 * H } }), [], NOW, false).age.old, true);
  assert.equal(listRow(project("c", { status: null }), [], NOW, false).age.text, "no status");
  assert.equal(listRow(project("d", { status: null, lead: null }), [], NOW, false).age.text, "no lead");
});

test("CI shows only when it isn't green: a passing check is the normal case and stays unsaid", () => {
  assert.deepEqual(words(prChips(pr(1))), ["open"]);
  assert.deepEqual(words(prChips(pr(2, { checks: "failing" }))), ["open", "CI failing"]);
  assert.deepEqual(words(prChips(pr(3, { checks: "pending", review: "review_required" }))), ["in review", "CI running"]);
  // a merged PR's old CI no longer matters
  assert.deepEqual(words(prChips(pr(4, { state: "merged", checks: "failing" }))), ["merged"]);
  for (const c of [...prChips(pr(5, { attention: "ready_to_merge" })), ...prChips(pr(6, { state: "draft", checks: "failing" }))]) assert.ok(c.icon && c.word);
});

test("each PR appears once: a wait that names a PR folds into its row, and no other wait is dropped", () => {
  const p = project("otter", {
    prs: [pr(4087, { attention: "ready_to_merge" }), pr(4121, { review: "review_required" }), pr(4130, { state: "draft" }), pr(4000, { state: "merged" })],
    waits: [
      wait({ ref: "https://github.com/o/r/pull/4121", label: "4121 needs 2 approvals" }),
      wait({ kind: "person", ref: null, who: "Sam", label: "a test user" }),
      wait({ kind: "pr", ref: "https://github.com/o/r/pull/9999", label: "a PR not in this project" }),
      wait({ source: "lead", kind: "owner", label: "your go" }),
    ],
  });
  const { rows, loose } = prRows(p, [lane("thread:otter:2", { pr: pr(4087), activity: "t-1002 · Backfill worker" })]);
  assert.deepEqual(rows.map((r) => r.pr.number), [4087, 4121, 4130], "ready to merge first, drafts last, merged gone");
  assert.deepEqual(rows.find((r) => r.pr.number === 4121)!.waits.map((w) => w.label), ["4121 needs 2 approvals"]);
  assert.equal(rows[0]!.title, "Backfill worker", "the row's title is its thread's work, without the ticket");
  // the folded wait isn't also a "Waiting on" line; the others (a person, an unknown PR) stay; the owner's goes to Needs
  assert.deepEqual(loose.map((w) => w.label), ["a test user", "a PR not in this project"]);
  const shown = rows.reduce((n, r) => n + r.waits.length, 0) + loose.length;
  assert.equal(shown, 3, "every wait outside the owner is shown exactly once");
});

test("Needs and Blocked come first, side by side, before what is happening: the answer the owner owes is in the first row", () => {
  assert.deepEqual(DETAIL_LAYOUT.attention, ["needs", "blocked"]);
  const order = detailOrder();
  assert.ok(order.indexOf("needs") < order.indexOf("now") && order.indexOf("blocked") < order.indexOf("now"));
  assert.ok(order.indexOf("now") < order.indexOf("prs"), "one column keeps Now before the PRs");
  assert.equal(new Set(order).size, order.length, "no section drawn twice");
});

test("thread cards: what waits on the owner first, then blocked and working, the lead, then a PR to merge; idle ones recede", () => {
  const lanes = [
    lane("thread:o:6", { state: "idle", since: NOW - 9 * H }),
    lane("thread:o:2", { state: "idle", since: NOW - 6 * H, pr: pr(4087, { attention: "ready_to_merge" }) }),
    lane("lead:o", { role: "lead", state: "idle", since: NOW - H }),
    lane("thread:o:4", { state: "working", since: NOW - H }),
    lane("thread:o:5", { state: "waiting", since: NOW - 6 * H, wait: { on: "owner", cardId: "c", threadId: "T" } as Lane["wait"] }),
    lane("thread:o:7", { state: "released" }),
    lane("thread:o:3", { state: "idle", since: NOW - 2 * H }),
  ];
  const cards = threadCards(lanes, NOW, "Robin");
  assert.deepEqual(cards.map((c) => c.lane.agent.address), ["thread:o:5", "thread:o:4", "lead:o", "thread:o:2", "thread:o:3", "thread:o:6"]);
  assert.deepEqual(cards.filter((c) => c.rest).map((c) => c.lane.agent.address), ["thread:o:3", "thread:o:6"], "only idle threads with nothing to merge recede");
  assert.deepEqual(cards[0]!.chip, { tone: "need", icon: "you", word: "Robin · 6h" });
});

test("a thread idle over a day turns amber: it may be forgotten, not just resting", () => {
  assert.equal(laneChip(lane("t", { state: "idle", since: NOW - 6 * H }), NOW, "R").tone, "quiet");
  assert.equal(laneChip(lane("t", { state: "idle", since: NOW - 30 * H }), NOW, "R").tone, "warn");
});

test("a thread card's title is its work; the ticket moves to the second line", () => {
  assert.equal(titleOf("t-1004 · Backend · Query rewrite"), "Backend · Query rewrite");
  assert.equal(ticketOf("t-1004 · Backend · Query rewrite"), "t-1004");
  assert.equal(ticketOf("no ticket here"), null);
});

test("an age carries its source and turns old past four hours", () => {
  assert.deepEqual(ageSpec(NOW - 6 * H, NOW, "live"), { text: "6h", source: "live", old: true, title: "unchanged 6h · live" });
  assert.equal(ageSpec(NOW - H, NOW, "lead")!.old, false);
  assert.equal(ageSpec(null, NOW, null), null);
});

test("a pin says how fresh it is in its kind's own terms, and that a file is gone rather than a stale date", () => {
  assert.equal(pinWhen({ kind: "file", updatedAt: NOW - 3 * 24 * H, rev: null, missing: false }, NOW), "updated 3d ago");
  assert.equal(pinWhen({ kind: "deliverable", updatedAt: NOW - 6 * H, rev: 2, missing: false }, NOW), "rev 2 · 6h ago");
  assert.equal(pinWhen({ kind: "link", updatedAt: NOW - 2 * H, rev: null, missing: false }, NOW), "pinned 2h ago");
  assert.equal(pinWhen({ kind: "file", updatedAt: null, rev: null, missing: true }, NOW), "file not found");
});

test("two waits on one PR both fold into its one row, oldest first: the PR is still drawn once and neither wait is lost", () => {
  const url = "https://github.com/o/r/pull/7";
  const p = project("o", { prs: [pr(7)], waits: [wait({ ref: url, label: "CI", since: NOW - H }), wait({ ref: url, label: "two approvals", since: NOW - 5 * H })] });
  const { rows, loose } = prRows(p, []);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.waits.map((w) => w.label), ["two approvals", "CI"]);
  assert.deepEqual(loose, []);
});

test("a blocked PR never reads green, even when approved and passing", () => {
  assert.deepEqual(prChips(pr(8, { attention: "blocked", review: "approved" }))[0], { tone: "blocked", icon: "blocked", word: "blocked" });
});
