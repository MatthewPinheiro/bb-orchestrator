// The project page's history (2026-11-16): the owner reads a project's past from it (who ran when, in what state,
// when its PRs opened and merged, how long their cards waited, what waits on what now), so the log must hold each
// change once, at the right time, and older history must come back as start and end only, never as made-up colour.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type PrResult } from "../core/engine.ts";
import { migrate } from "../core/db.ts";

const T0 = Date.parse("2026-11-16T10:00:00Z");
const MIN = 60_000;

function engineOn(db: DatabaseSync, clock: { t: number }) {
  return new Engine(db as never, { now: () => clock.t, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
}

function setup() {
  const clock = { t: T0 };
  const db = new DatabaseSync(":memory:");
  const e = engineOn(db, clock);
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-lead", "lead", "demo");
  return { e, db, cos, lead, clock, at: (m: number) => (clock.t = T0 + m * MIN) };
}

const pr = (state: string, checks = "passing", n = 7): PrResult => ({ outcome: "available", pullRequest: { url: `https://github.com/o/r/pull/${n}`, number: n, state, checks: { state: checks } } });
const kinds = (db: DatabaseSync, address: string) => (db.prepare(`SELECT kind, value FROM events WHERE address = ? ORDER BY seq`).all(address) as { kind: string; value: string | null }[]).map((r) => `${r.kind}${r.value ? `:${r.value}` : ""}`);

test("a thread's bar is coloured by its real status changes; a repeated status (the startup reconcile) adds nothing", () => {
  const s = setup();
  s.at(1);
  s.e.register("T-1", "thread", "demo", "T-lead");
  s.at(2);
  s.e.setStatus("T-1", "active");
  s.at(10);
  s.e.setStatus("T-1", "idle");
  s.at(11);
  s.e.setStatus("T-1", "idle"); // the reconcile re-reports it
  s.at(20);
  s.e.setStatus("T-1", "error");
  s.at(30);
  assert.deepEqual(kinds(s.db, "thread:demo:1"), ["spawn:thread", "status:active", "status:idle", "status:error"]);
  const row = s.e.projectHistory("demo").rows.find((r) => r.address === "thread:demo:1")!;
  assert.equal(row.parent, "lead:demo", "the flow draws it under the lead that started it");
  assert.deepEqual(
    row.holders[0]!.segments.map((x) => [x.state, (x.from - T0) / MIN, (x.to - T0) / MIN]),
    [
      ["unknown", 1, 2],
      ["working", 2, 10],
      ["idle", 10, 20],
      ["blocked", 20, 30],
    ],
    "working 8 minutes, idle 10, then blocked until now: one segment per change, the repeat merged in",
  );
});

test("a stopped thread stays stopped on the bar: the statuses setStatus ignores are not logged either", () => {
  const s = setup();
  s.e.register("T-1", "thread", "demo", "T-lead");
  s.at(1);
  s.e.setStatus("T-1", "stopped");
  s.at(2);
  s.e.setStatus("T-1", "idle"); // ignored: stopped sticks until it runs again
  assert.deepEqual(kinds(s.db, "thread:demo:1"), ["spawn:thread", "status:stopped"]);
});

test("PR marks: opened, merged; a checks change is not a state change", () => {
  const s = setup();
  const t = s.e.register("T-1", "thread", "demo", "T-lead");
  s.e.setEnvironment("T-1", "E1");
  s.at(5);
  s.e.prSeen(s.e.agentByThread("T-1")!, "E1", pr("open", "pending"));
  s.at(6);
  s.e.prSeen(s.e.agentByThread("T-1")!, "E1", pr("open", "passing"));
  s.at(9);
  s.e.prSeen(s.e.agentByThread("T-1")!, "E1", pr("merged"));
  const row = s.e.projectHistory("demo").rows.find((r) => r.address === t.address)!;
  assert.deepEqual(
    row.marks.map((m) => [m.kind, (m.at - T0) / MIN, m.label]),
    [
      ["pr-open", 5, "#7 open"],
      ["pr-merged", 9, "#7 merged"],
    ],
  );
  assert.deepEqual(row.prs, [{ url: "https://github.com/o/r/pull/7", number: 7, state: "merged" }]);
});

test("a handoff keeps one row per address: both holders end to end, with the providers either side and a mark", () => {
  const s = setup();
  s.e.register("T-1", "thread", "demo", "T-lead");
  s.at(10);
  s.e.takeOver("T-1", "T-2", "codex; handoff.md", { from: "claude-code", to: "codex" });
  s.at(20);
  const rows = s.e.projectHistory("demo").rows;
  const row = rows.find((r) => r.address === "thread:demo:1")!;
  assert.equal(rows.filter((r) => r.address === "thread:demo:1").length, 1);
  assert.deepEqual(
    row.holders.map((h) => [h.threadId, h.provider, (h.from - T0) / MIN, h.to === null ? null : (h.to - T0) / MIN]),
    [
      ["T-1", "claude-code", 0, 10],
      ["T-2", "codex", 10, null],
    ],
  );
  assert.deepEqual(
    row.marks.map((m) => [m.kind, m.label]),
    [["handoff", "→ Codex"]],
  );
  assert.ok(row.live);
  // bb's own word for a thread wins over the handoff's record
  assert.equal(s.e.projectHistory("demo", new Map([["T-1", "pi"]])).rows.find((r) => r.address === "thread:demo:1")!.holders[0]!.provider, "pi");
});

test("resolve and archive end a bar with a mark, and the bar stays on the page", () => {
  const s = setup();
  s.e.register("T-1", "thread", "demo", "T-lead");
  s.e.report(s.e.agentByThread("T-1")!, "Done", "merged locally", null);
  s.at(15);
  s.e.resolve(s.lead, "thread:demo:1", { prMerged: false, lastReadAt: null, worktree: { clean: true, inBase: true, why: "in main" } as never });
  const row = s.e.projectHistory("demo").rows.find((r) => r.address === "thread:demo:1")!;
  assert.equal(row.live, false);
  assert.equal((row.holders[0]!.to! - T0) / MIN, 15);
  assert.deepEqual(row.marks.map((m) => m.kind), ["resolve"]);
  s.at(16);
  s.e.archiveProject("demo");
  assert.deepEqual(kinds(s.db, "lead:demo").slice(-1), ["retire"], "archiving a project retires its lead in the log too");
});

test("a Needs-you card shows on its asker's row from asked to answered", () => {
  const s = setup();
  const t = s.e.register("T-1", "thread", "demo", "T-lead");
  s.at(3);
  const d = s.e.ask(s.lead, { title: "Merge it?", question: "ok?", options: [{ label: "Yes" }, { label: "No" }] });
  s.e.triageAskPerson(s.cos, d.id, { question: "Merge it?", options: [{ label: "Yes" }, { label: "No" }], allowText: false });
  let lead = s.e.projectHistory("demo").rows.find((r) => r.address === "lead:demo")!;
  assert.equal(lead.asks.length, 1);
  assert.equal(lead.asks[0]!.to, null, "still open: the band runs to now");
  const dep = s.e.projectHistory("demo").deps[0]!;
  assert.deepEqual([dep.from, dep.on, dep.kind, dep.block], ["lead:demo", "owner", "card", true], "an open card is the first blocker");
  s.at(8);
  const card = s.e.needsYou().cards[0]!;
  s.e.personAnswer(d.id, card.rev, card.request.options[0]!.id, null, "desktop");
  lead = s.e.projectHistory("demo").rows.find((r) => r.address === "lead:demo")!;
  assert.deepEqual([(lead.asks[0]!.from - T0) / MIN, (lead.asks[0]!.to! - T0) / MIN], [3, 8]);
  void t;
});

test("dependencies: a held project first, then cards, then a reply owed, then a PR condition", () => {
  const s = setup();
  const t = s.e.register("T-1", "thread", "demo", "T-lead");
  s.e.setEnvironment("T-1", "E1");
  s.e.prSeen(t, "E1", pr("open"));
  s.at(1);
  const msg = s.e.send(s.lead, "thread:demo:1", "status?", null);
  s.at(2);
  s.e.ask(t, { title: "Which lib?", question: "a or b?", options: [{ label: "a" }, { label: "b" }] });
  s.at(3);
  const m2 = s.e.send(t, "lead:demo", "done, review please", null);
  s.e.ack(s.lead, m2.id, "done", null, { pr: "https://github.com/o/r/pull/7", when: "merged" });
  s.at(4);
  s.e.setHold("demo", true);
  const deps = s.e.projectHistory("demo").deps.map((d) => `${d.from} → ${d.on} (${d.kind})`);
  assert.deepEqual(deps, ["demo → owner (hold)", "thread:demo:1 → lead:demo (card)", "lead:demo → thread:demo:1 (reply)", "lead:demo → pr (pr)"]);
  void msg;
});

test("older history: bars from before the log show only start and end, PR and handoff marks come back from the Board, once", () => {
  const clock = { t: T0 };
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const H = 3_600_000;
  // as an earlier version left them: two holders of thread:old:1 (a handoff), a lead, Board rows for the PR and handoff
  const ins = db.prepare(`INSERT INTO agents (thread_id, address, role, project, parent_thread_id, status, created_at, retired_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run("L", "lead:old", "lead", "old", null, "idle", T0 - 10 * H, null);
  ins.run("A", "thread:old:1", "thread", "old", "L", "idle", T0 - 9 * H, T0 - 5 * H);
  ins.run("B", "thread:old:1", "thread", "old", "L", "idle", T0 - 5 * H, T0 - 2 * H);
  db.prepare(`INSERT INTO projects (slug, created_at) VALUES ('old', ?)`).run(T0 - 10 * H);
  const board = db.prepare(`INSERT INTO board (id, kind, from_address, project, title, body, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  board.run("b1", "prstate", "thread:old:1", "old", "thread:old:1: PR #42 open, checks pending", "u", "https://github.com/o/r/pull/42", T0 - 8 * H);
  board.run("b2", "prstate", "thread:old:1", "old", "thread:old:1: PR #42 open (mergeable), checks passing", "u", "https://github.com/o/r/pull/42", T0 - 7 * H);
  board.run("b3", "notice", "orchestrator", "old", "thread:old:1 handed over", "A → B. codex gpt-6; /w/handoff.md", "B", T0 - 5 * H);
  board.run("b4", "prstate", "thread:old:1", "old", "thread:old:1: PR #42 merged", "u", "https://github.com/o/r/pull/42", T0 - 3 * H);
  board.run("b5", "resolved", "lead:old", "old", "thread:old:1 resolved: its PR is merged", "", "B", T0 - 2 * H);
  const e = engineOn(db, clock);
  clock.t = T0 + H;
  const h = e.projectHistory("old");
  assert.equal(h.logSince, T0);
  const row = h.rows.find((r) => r.address === "thread:old:1")!;
  assert.deepEqual(
    row.holders.map((x) => [x.threadId, x.provider, x.segments.map((g) => g.state)]),
    [
      ["A", null, ["nolog"]],
      ["B", "codex", ["nolog"]],
    ],
    "no colour is made up for before the log",
  );
  assert.deepEqual(
    row.marks.map((m) => m.label),
    ["#42 open", "→ Codex", "#42 merged", "resolved"],
    "the checks change at -7h is not a mark",
  );
  const lead = h.rows.find((r) => r.address === "lead:old")!;
  assert.deepEqual(lead.holders[0]!.segments.map((g) => g.state), ["nolog", "idle"], "a live agent gets its colour from the log's start");
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number }).n;
  engineOn(db, clock); // the next start
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number }).n, n, "the backfill runs once");
});

test("a backfill that fails leaves the plugin running with an empty log", () => {
  const clock = { t: T0 };
  const db = new DatabaseSync(":memory:");
  migrate(db);
  db.exec(`DROP TABLE board; CREATE TABLE board (id TEXT)`); // a shape the backfill can't read
  const logs: string[] = [];
  const e = new Engine(db as never, { now: () => clock.t, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: (m: string) => logs.push(m) });
  assert.ok(logs.some((l) => l.startsWith("events: backfill failed")));
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number }).n, 0, "all or nothing");
  e.register("T-lead", "lead", "demo");
  assert.equal(e.projectHistory("demo").rows.length, 1, "and the page still reads");
});
