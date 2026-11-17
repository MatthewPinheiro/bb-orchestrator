// The Projects tab as a source of truth (2026-11-16, layout B; core/book.ts). The owner opens a project to see what
// they decided, what got done and what blocks it since when. Each must be true to the record: Decided is the owner's
// own answers on that project only (a rule's settle is not their decision, a merged card is not a second one); a
// merge is counted once, when it happened; a blocker's "since" is when the lead first said it, not its last
// restatement; the search finds older answers and treats the owner's % and _ as text. All of it is bounded and indexed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type PrResult } from "../core/engine.ts";
import type { Agent } from "../core/model.ts";
import { statusParams } from "../core/status.ts";
import { BOOK_ROWS, COUNT_CAP, DECIDED_SQL, DONE_DELIVERABLES_SQL, DONE_REPORTS_SQL, MERGED_SINCE_COUNT_SQL, MERGED_SINCE_SQL, MERGED_SQL, SEARCH_MIN, SEARCH_SQL, SEARCH_WINDOW, SINCE_STATUSES, STATUS_HISTORY_SQL, SUMMARY_ANSWERED_SQL } from "../core/book.ts";

const T0 = Date.parse("2026-11-16T10:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const PR = "https://github.com/o/r/pull/41";
const merged: PrResult = {
  outcome: "available",
  pullRequest: { url: PR, number: 41, state: "merged", checks: { state: "passing" }, review: { state: "approved" }, mergeability: { mergeable: "MERGEABLE", state: "clean" } } as never,
};

function setup() {
  const clock = { t: T0 };
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, { now: () => clock.t, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} }, { owner: "Robin" });
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-lead", "lead", "kite");
  const w1 = e.register("T-w1", "thread", "kite", "T-lead");
  const other = e.register("T-olead", "lead", "otter");
  const publish = (blockers: string[], by: Agent = lead) => e.publishStatus(by, statusParams.parse({ goal: "Ship kite", steps: [{ title: "Build", state: "current" }], blockers }));
  // the CoS may reword the card it puts to the owner (`ask`): what the owner read is what the page must say
  const toOwner = (by: Agent, title: string, reworded?: { title: string; question: string }) => {
    const d = e.ask(by, { title, question: `${title}?`, options: [{ label: "Go" }, { label: "Wait" }] });
    return e.triageAskPerson(cos, d.id, { title: reworded?.title, question: reworded?.question ?? `${title}?`, options: [{ label: "Go" }, { label: "Wait" }], allowText: true });
  };
  const answer = (by: Agent, title: string, reworded?: { title: string; question: string }) => {
    const d = toOwner(by, title, reworded);
    return e.personAnswer(d.id, d.rev, d.ask!.options[0]!.id, null, "desktop");
  };
  return { e, db, cos, lead, w1, other, publish, toOwner, answer, advance: (ms: number) => (clock.t += ms), now: () => clock.t };
}

test("Decided is the owner's own answers on this project, newest first: not another project's, not a settle for him", () => {
  const s = setup();
  const first = s.answer(s.lead, "Use the new bucket");
  s.advance(MIN);
  const second = s.answer(s.lead, "Drop the old API");
  s.advance(MIN);
  s.answer(s.other, "Otter's own question"); // another project's
  const byCos = s.answer(s.lead, "Settled for him");
  s.db.prepare(`UPDATE decisions SET json = json_set(json, '$.answer.by', 'cos') WHERE id = ?`).run(byCos.id);
  s.toOwner(s.lead, "Still open"); // no answer yet
  const book = s.e.projectBook("kite");
  assert.deepEqual(book.decided.map((d) => d.id), [second.id, first.id]);
  assert.equal(book.decided[0]!.title, "Drop the old API");
  assert.equal(book.decided[0]!.answer, "Go", "what he picked, in his words");
  assert.equal(book.decided[0]!.at, T0 + MIN);
  assert.throws(() => s.e.projectBook("nope"), /no project nope/);
});

test("a merged card carries its parent's answer but is one decision, shown once", () => {
  const s = setup();
  const parent = s.answer(s.lead, "Ship it");
  const child = s.toOwner(s.lead, "Ship it too");
  s.db.prepare(`UPDATE decisions SET state = 'merged', json = json_set(json, '$.answer', json(?)) WHERE id = ?`).run(JSON.stringify({ ...parent.answer, via: "merged" }), child.id);
  assert.deepEqual(s.e.projectBook("kite").decided.map((d) => d.id), [parent.id]);
});

test("Decided and Done stay short: the newest few only", () => {
  const s = setup();
  for (let i = 0; i < BOOK_ROWS + 3; i++) {
    s.answer(s.lead, `Question ${i}`);
    s.e.report(s.w1, `Report ${i}`, "done", null);
    s.advance(MIN);
  }
  const book = s.e.projectBook("kite");
  assert.equal(book.decided.length, BOOK_ROWS);
  assert.equal(book.decided[0]!.title, `Question ${BOOK_ROWS + 2}`);
  assert.equal(book.done.length, BOOK_ROWS);
  assert.equal(book.done[0]!.text, `Report ${BOOK_ROWS + 2}`);
});

test("Done mixes approved and in-review deliverables, merged PRs and the threads' reports, newest first", () => {
  const s = setup();
  const row = s.db.prepare(`INSERT INTO deliverables (id, project, lead, title, summary, state, rev, created_at, updated_at, json) VALUES (?, ?, 'lead:kite', ?, '', ?, 1, ?, ?, '{}')`);
  row.run("v-000000000001", "kite", "The new checkout", "approved", T0, T0);
  row.run("v-000000000002", "kite", "Draft docs", "review", T0, T0 + 2 * MIN);
  row.run("v-000000000003", "kite", "Rejected try", "changes", T0, T0 + 3 * MIN);
  row.run("v-000000000004", "otter", "Not kite's", "approved", T0, T0 + 4 * MIN);
  s.advance(MIN);
  s.e.prSeen(s.w1, "env-1", merged);
  s.advance(4 * MIN);
  s.e.report(s.w1, "Fixed the flaky test", "done", null);
  s.e.report(s.lead, "A lead's own note", "not a thread's report", null);
  const done = s.e.projectBook("kite").done;
  assert.deepEqual(
    done.map((d) => [d.kind, d.text, d.state]),
    [
      ["report", "Fixed the flaky test", null],
      ["deliverable", "Draft docs", "review"],
      ["merged", "PR #41 merged", null],
      ["deliverable", "The new checkout", "approved"],
    ],
  );
  assert.equal(done.find((d) => d.kind === "merged")!.ref, PR, "a merge opens its PR");
  assert.deepEqual(s.e.projectBook("kite").merged, [{ number: 41, url: PR, at: T0 + MIN }]);
});

test("a PR seen merged from two environments is one merge, at its first sighting, in Done and merged today", () => {
  const s = setup();
  s.e.prSeen(s.w1, "env-1", merged);
  s.advance(MIN);
  const after = s.now(); // a day that starts after the merge
  s.advance(HOUR);
  s.e.prSeen(s.w1, "env-2", merged); // another environment holding the same PR sees it merged later
  const book = s.e.projectBook("kite");
  assert.deepEqual(book.done.filter((d) => d.kind === "merged").map((d) => d.at), [T0], "once, when it merged");
  assert.deepEqual(book.merged.map((m) => m.at), [T0]);
  assert.equal(book.mergedTotal, 1);
  assert.deepEqual(s.e.projectBook("kite", after).merged, [], "merged before the day started: the later sighting doesn't make it today's");
  assert.equal(s.e.projectBook("kite", after).mergedTotal, 0);
  s.e.prSeen(s.w1, "env-3", merged); // a third environment in the very same millisecond as the second: still one
  s.db.prepare(`UPDATE events SET at = ? WHERE kind = 'pr' AND value = 'merged'`).run(s.now()); // every sighting at once
  assert.equal(s.e.projectBook("kite").done.filter((d) => d.kind === "merged").length, 1, "a same-ms tie is broken by the log's order");
});

test("a merge known only from the log's rebuild (backfill) is still done: Done is the record, not the news", () => {
  const s = setup();
  s.db.prepare(`INSERT INTO events (at, kind, project, address, thread_id, value, ref, note, backfill) VALUES (?, 'pr', 'kite', 'thread:kite:1', 'T-w1', 'merged', 'https://github.com/o/r/pull/77', '77', 1)`).run(s.now());
  assert.deepEqual(s.e.projectBook("kite").done.filter((d) => d.kind === "merged").map((d) => d.text), ["PR #77 merged"]);
});

test("a long merge history is counted up to the cap and never grouped whole", () => {
  const s = setup();
  s.db.exec(`WITH RECURSIVE k(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM k WHERE n < ${COUNT_CAP + 1})
    INSERT INTO events (at, kind, project, address, thread_id, value, ref, note, backfill)
    SELECT ${T0} - k.n * 1000, 'pr', 'kite', 'thread:kite:1', 'T-w1', 'merged', 'https://github.com/o/r/pull/' || k.n, CAST(k.n AS TEXT), 0 FROM k`);
  const book = s.e.projectBook("kite", T0 - 24 * HOUR);
  assert.equal(book.merged.length, 100);
  assert.equal(book.mergedTotal, COUNT_CAP, "counted up to the cap");
  assert.deepEqual(book.done.map((d) => d.text).slice(0, 2), ["PR #1 merged", "PR #2 merged"], "Done: the newest");
});

test("merged today lists every merge of the page's day, not Done's few; the day start is clamped", () => {
  const s = setup();
  const day = T0 - 2 * HOUR;
  const n = BOOK_ROWS + 2;
  // a merge three days back: never "today", however far back the page's day start claims to be
  s.db.prepare(`INSERT INTO events (at, kind, project, address, thread_id, value, ref, note, backfill) VALUES (?, 'pr', 'kite', 'thread:kite:1', 'T-w1', 'merged', 'https://github.com/o/r/pull/7', '7', 0)`).run(T0 - 72 * HOUR);
  for (let i = 0; i < n; i++) {
    s.e.prSeen(s.w1, `env-${i}`, { ...merged, pullRequest: { ...merged.pullRequest, url: `https://github.com/o/r/pull/${100 + i}`, number: 100 + i } } as PrResult);
    s.advance(MIN);
  }
  const book = s.e.projectBook("kite", day);
  assert.equal(book.merged.length, n);
  assert.equal(book.mergedTotal, n);
  assert.equal(book.done.length, BOOK_ROWS, "Done stays short");
  assert.equal(s.e.projectBook("kite", s.now() - 30 * 24 * HOUR).merged.length, n, "a day start far back reads two days at most");
  assert.equal(s.e.projectBook("kite", s.now() + HOUR).merged.length, 0, "a day start ahead of now: nothing yet");
});

test("Decided and the search say the card as the owner read it, after the CoS reworded it", () => {
  const s = setup();
  const d = s.answer(s.lead, "Choose cache", { title: "Launch window", question: "Launch on Tuesday or Thursday?" });
  assert.equal(s.e.projectBook("kite").decided[0]!.title, "Launch window");
  assert.deepEqual(s.e.searchAnswered("Thursday").map((h) => h.id), [d.id], "the question he read");
  assert.deepEqual(s.e.searchAnswered("Choose cache").map((h) => h.id), [d.id], "the asker's words still find it");
});

test("a blocker's since is when the lead first said it in an unbroken run, not the latest restatement", () => {
  const s = setup();
  s.publish(["staging keys"]); // T0
  s.advance(HOUR);
  s.publish(["staging keys", "a design review"]); // +1h
  s.advance(HOUR);
  s.publish(["a design review"]); // +2h: the keys came, then went missing again
  s.advance(HOUR);
  s.publish(["a design review", "staging keys"]); // +3h
  s.advance(HOUR);
  s.publish(["a design review", "staging keys"]); // +4h: restated
  const since = new Map(s.e.projectBook("kite").since.map((b) => [b.text, b.since]));
  assert.equal(since.get("a design review"), T0 + HOUR);
  assert.equal(since.get("staging keys"), T0 + 3 * HOUR, "the run that ended at +2h doesn't count");
  s.advance(HOUR);
  s.publish([]);
  assert.deepEqual(s.e.projectBook("kite").since, [], "no blockers, no since");
});

test("a blocker's since is only claimed from history: none without it, a lower bound past the history read", () => {
  const s = setup();
  s.publish(["staging keys"]);
  s.db.prepare(`DELETE FROM events WHERE kind = 'lead-status'`).run(); // a status from before the log
  assert.deepEqual(s.e.projectBook("kite").since, [], "no history names it: the page says when the lead said it, not a start");
  for (let i = 0; i <= SINCE_STATUSES; i++) {
    s.advance(MIN);
    s.publish(["staging keys", `step ${i}`]);
  }
  const [b] = s.e.projectBook("kite").since.filter((x) => x.text === "staging keys");
  assert.equal(b!.bound, true, "named by every status read: at least that old");
  assert.equal(b!.since, s.now() - (SINCE_STATUSES - 1) * MIN);
  const [fresh] = s.e.projectBook("kite").since.filter((x) => x.text.startsWith("step"));
  assert.deepEqual([fresh!.since, fresh!.bound], [s.now(), false], "said first in the newest status: a known start");
});

test("search finds older answered cards by title or answer, needs a few letters, and reads % and _ as text", () => {
  const s = setup();
  const a = s.answer(s.lead, "Rename the bucket");
  s.advance(MIN);
  const b = s.answer(s.other, "Raise the limit to 50%");
  s.toOwner(s.lead, "Rename the queue"); // open: not an older answer
  assert.deepEqual(s.e.searchAnswered("rename").map((h) => h.id), [a.id]);
  assert.deepEqual(s.e.searchAnswered("50%").map((h) => h.id), [b.id]);
  assert.deepEqual(s.e.searchAnswered("%"), [], "shorter than SEARCH_MIN");
  assert.deepEqual(s.e.searchAnswered("a".repeat(SEARCH_MIN - 1)), []);
  assert.deepEqual(s.e.searchAnswered("t_e"), [], "_ is a letter, not any letter");
  assert.deepEqual(s.e.searchAnswered(a.id).map((h) => h.id), [a.id], "by its id too");
  assert.equal(s.e.searchAnswered("bucket")[0]!.project, "kite");
});

test("search reads the newest answers only, so a long history never stalls the plugin", () => {
  const s = setup();
  s.answer(s.lead, "An ancient pick");
  s.advance(MIN);
  const recent = s.answer(s.lead, "A recent pick");
  // SEARCH_WINDOW newer answers, copied from the recent one
  s.db.exec(`WITH RECURSIVE k(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM k WHERE n < ${SEARCH_WINDOW})
    INSERT INTO decisions (id, state, at_level, asker, origin, project, json, updated_at)
    SELECT 'pad-' || k.n, state, at_level, asker, origin, project, json_set(json, '$.answer.at', strftime('%Y-%m-%dT%H:%M:%fZ', julianday(json_extract(json, '$.answer.at')) + k.n / 86400.0)), updated_at
    FROM decisions, k WHERE id = '${recent.id}'`);
  assert.deepEqual(s.e.searchAnswered("ancient"), [], "past the window");
  assert.equal(s.e.searchAnswered("recent").length, 20, "the newest matches, capped");
});

test("the card reads use the book's indexes, not a scan of every card (the very statements the plugin runs)", () => {
  const s = setup();
  const plan = (sql: string, ...p: unknown[]) => (s.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(p as never[])) as { detail: string }[]).map((r) => r.detail).join(" | ");
  const day = "2026-11-16T00:00:00.000Z";
  assert.match(plan(DECIDED_SQL, "kite", 6), /USING INDEX decisions_project_answer/, "Decided");
  const covered = plan(SUMMARY_ANSWERED_SQL, day);
  assert.match(covered, /USING INDEX decisions_answer_at/, "blockers covered");
  assert.doesNotMatch(covered, /SCAN decisions/, "blockers covered");
  assert.match(plan(SEARCH_SQL, SEARCH_WINDOW, "%x%", "%x%", "%x%", "%x%", "%x%", "x", 20), /decisions_answer_at/, "the search's window by answer time");
  assert.match(plan(`SELECT id FROM decisions WHERE state IN ('open','asked')`), /USING INDEX decisions_state/, "the summaries' open cards");
  // the book's other reads (events_project_kind, deliverables_project, board_project): each by its project and kind, never the whole table
  for (const [what, sql, p, idx] of [
    ["a blocker's since", STATUS_HISTORY_SQL, ["kite", SINCE_STATUSES], /events_project_kind/],
    ["Done's merges", MERGED_SQL, ["kite", 6], /events_project_kind/],
    ["merged today", MERGED_SINCE_SQL, ["kite", 0, 100], /events_project_kind/],
    ["merged today counted", MERGED_SINCE_COUNT_SQL, ["kite", 0, COUNT_CAP], /events_project_kind/],
    ["Done's deliverables", DONE_DELIVERABLES_SQL, ["kite", 6], /deliverables_project/],
    ["Done's reports", DONE_REPORTS_SQL, ["kite", 6], /board_project/],
  ] as const) {
    const x = plan(sql, ...p);
    assert.match(x, idx, what);
    assert.doesNotMatch(x, /SCAN (events|board|deliverables)\b(?! USING)/, what);
    assert.doesNotMatch(x, /FOR GROUP BY/, `${what}: nothing grouped whole`);
    if (/merge/.test(what)) assert.match(x, /events_merged_ref/, `${what}: an earlier sighting looked up by the PR's URL`);
  }
});
