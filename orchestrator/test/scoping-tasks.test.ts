// Scoping tasks (1.12.0): part of an active project scoped with the owner while the rest goes the normal way. Why each
// rule matters:
// - a card filed into a task reaches the owner only in the Scope pane: if it also reached the CoS's triage or Needs you,
//   the owner would get the same question twice, and a standing rule written for build work would answer a scoping
//   question they never saw;
// - a card without the task, from the same project, must route exactly as before, or opening a task would quietly pull
//   the whole project out of the CoS's hands;
// - a scoping thread's questions belong to its task, so a forward lands under it without the lead naming it each time;
// - closing one task must not touch the project's mode or its other tasks, and must release what still waits under it,
//   so a card is never stranded in neither place;
// - a task that is closed or unknown is refused loudly: filing into it silently would hide a card from the owner.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, SCOPING_TASK_DONE_OPTIONS, type AskInput, type DeliverResult } from "../core/engine.ts";
import { MIGRATIONS, migrate } from "../core/db.ts";
import type { Decision, Item } from "../core/model.ts";

function setup() {
  let clock = Date.parse("2026-11-17T10:00:00Z");
  const sent: Item[] = [];
  const up: string[] = [];
  const pushed: string[] = [];
  const db = new DatabaseSync(":memory:");
  const e = new Engine(
    db as never,
    {
      now: () => clock,
      async deliver(_t, _x, item): Promise<DeliverResult> {
        sent.push(item);
        return { delivery: "sent" };
      },
      mirror: () => {},
      changed: () => {},
      cardUp: (d) => up.push(d.id),
      delivered: (d) => pushed.push(d.id),
      log: () => {},
    },
    { escalateMs: 5 * 60_000 },
  );
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-lo", "lead", "otter"); // an active project
  e.createProject("kite", "normal", "cos", "cos created project kite", "", "scoping");
  const kite = e.register("T-lk", "lead", "kite"); // a project scoping as a whole
  return { e, db, cos, lead, kite, sent, up, pushed, advance: (ms: number) => (clock += ms) };
}
type S = ReturnType<typeof setup>;

const q: AskInput = { title: "Which export format?", question: "Export the nightly report as CSV or as JSON?", options: [{ label: "CSV" }, { label: "JSON" }] };
const items = (s: S, recipient: string, kind?: string) =>
  s.db.prepare(`SELECT * FROM items WHERE recipient = ? ${kind ? "AND kind = ?" : ""} ORDER BY created_at`).all(...(kind ? [recipient, kind] : [recipient])) as { kind: string; ref: string | null; body: string; needs_ack: number }[];
const answer = (s: S, d: Decision, option: string | null, text: string | null = null) => s.e.personAnswer(d.id, s.e.decision(d.id)!.rev, option, text, "desktop");
const done = (task: string) => ({ summary: "CSV for finance, JSON for the API; no prod writes.", doc: "/projects/otter/scoping/export.md", task });
const pane = (s: S, slug: string) => s.e.scopeView().find((p) => p.slug === slug);

test("in an active project, a card filed into its open task waits in the Scope pane only; a card without the task goes the normal way", () => {
  const s = setup();
  const t = s.e.openTask(s.lead, "Export format");
  assert.match(t.id, /^st-/);
  assert.equal(s.e.project("otter")!.mode, "active", "opening a task leaves the project active");
  // a standing rule that would settle this question for active work
  const match = { from: ["lead:*"], words: ["export", "format"], without: [], key_prefix: null, option: ["csv"] };
  s.e.addRule({ text: "exports are CSV", project: null, kinds: ["question"], expiresAt: null, source: "test", match });

  const d = s.e.ask(s.lead, { ...q, scopeTask: t.id });
  assert.equal(d.state, "asked", "no rule settled it: it waits for the owner");
  assert.equal(d.answer, null);
  assert.equal(d.orchestrator.scope, true);
  assert.equal(d.orchestrator.scope_task, t.id);
  assert.equal(items(s, "cos", "decision.new").length, 0, "nothing for the CoS to triage");
  const copies = items(s, "cos", "copy").filter((c) => c.ref === d.id);
  assert.equal(copies.length, 1, "the CoS gets exactly one copy");
  assert.equal(copies[0]!.needs_ack, 0, "read-only");
  assert.match(copies[0]!.body, /scoping task "Export format".*Read-only/);
  assert.deepEqual(s.e.needsYou().cards.map((c) => c.id), [], "not on Needs you");
  s.advance(60 * 60_000);
  s.e.tick();
  assert.deepEqual(s.e.needsYou().cards.map((c) => c.id), [], "the triage clock never takes it there either");
  assert.deepEqual(s.up, []);
  const p = pane(s, "otter")!;
  assert.equal(p.whole, false, "listed for its task, not as a scoping project");
  assert.deepEqual(p.tasks.map((x) => x.name), ["Export format"]);
  assert.deepEqual(p.cards.map((c) => c.id), [d.id]);
  // the task's name works as well as its id
  assert.equal(s.e.ask(s.lead, { ...q, title: "Which columns?", scopeTask: "export FORMAT" }).orchestrator.scope_task, t.id);

  // the same project, without the task: the rule settles it, as for any active project
  const plain = s.e.ask(s.lead, { ...q, title: "Which export format, again?" });
  assert.equal(plain.state, "answered", "a rule settles the plain card as before");
  assert.ok(!plain.orchestrator.scope);
  const other = s.e.ask(s.lead, { title: "Which region first?", question: "Roll out to the EU or the US first?", options: [{ label: "EU" }, { label: "US" }] });
  assert.equal(other.state, "open");
  assert.equal(other.orchestrator.at_level, "cos", "to the CoS's triage");
  assert.ok(items(s, "cos", "decision.new").some((i) => i.ref === other.id));
});

test("a scoping thread's question that its lead forwards lands under the thread's task, also after a handoff", () => {
  const s = setup();
  const t = s.e.openTask(s.lead, "Export format");
  // the plan for the scoping thread is itself filed into the task, and the owner gives its go there
  const plan = s.e.ask(s.lead, { title: "Plan: one research thread", question: "Start one read-only thread on the export format?", options: [{ label: "Go" }, { label: "Not now" }], kind: "plan", threads: 2, scopeTask: t.id });
  assert.equal(plan.orchestrator.scope_task, t.id);
  answer(s, plan, "1");
  const token = s.e.reserveSpawn(s.lead, plan.id, "Export format");
  s.e.confirmSpawn(token, "T-t1");
  const th = s.e.register("T-t1", "thread", "otter", "T-lo");
  assert.equal((s.db.prepare(`SELECT scope_task FROM spawns WHERE thread_id = 'T-t1'`).get() as { scope_task: string }).scope_task, t.id, "recorded on the thread");

  const d = s.e.ask(th, q);
  assert.equal(d.orchestrator.at_level, "lead", "the thread asks its lead, as always");
  assert.ok(!d.orchestrator.scope);
  assert.match(items(s, "lead:otter", "decision.new").find((i) => i.ref === d.id)!.body, /scoping thread for task "Export format"/);
  const f = s.e.forward(s.lead, d.id, "the owner should pick");
  assert.equal(f.state, "asked");
  assert.equal(f.orchestrator.scope, true);
  assert.equal(f.orchestrator.scope_task, t.id, "inherited from the thread");
  assert.equal(items(s, "cos", "decision.new").length, 0, "not triaged");

  // a card the old thread asked, forwarded after a handoff moved the thread's spawn row to its successor
  const before = s.e.ask(th, { ...q, title: "Which delimiter?" });
  s.e.takeOver("T-t1", "T-t2", "to another provider");
  assert.equal(s.e.forward(s.lead, before.id, null).orchestrator.scope_task, t.id);

  // a thread started without a task: its forwarded question goes the normal way
  s.e.confirmSpawn(s.e.reserveSpawn(s.lead, plan.id), "T-t3");
  const plain = s.e.register("T-t3", "thread", "otter", "T-lo");
  const g = s.e.forward(s.lead, s.e.ask(plain, { ...q, title: "Which retry policy?" }).id, null);
  assert.equal(g.orchestrator.at_level, "cos");
  assert.ok(!g.orchestrator.scope);
  // a thread can't file into the task itself: it asks its lead
  assert.throws(() => s.e.ask(s.e.agentByThread("T-t2")!, { ...q, scopeTask: t.id }), /only a lead files into a scoping task.*ask your lead/);
});

test("the owner's yes on a task's \"Scoping done?\" closes only that task: the project stays active, another task stays open, and its leftovers move to Needs you", () => {
  const s = setup();
  const a = s.e.openTask(s.lead, "Export format");
  const b = s.e.openTask(s.lead, "Retention");
  const left = s.e.ask(s.lead, { ...q, scopeTask: a.id });
  const left2 = s.e.ask(s.lead, { ...q, title: "Which columns?", scopeTask: a.id });
  const keep = s.e.ask(s.lead, { ...q, title: "How long to keep?", scopeTask: b.id });
  const v = s.e.deliver(s.lead, { title: "Export spike", summary: "What each format costs.", proof: [{ kind: "link", caption: "notes", url: "https://example.com/n" }], scopeTask: a.id }, { roots: [] });
  assert.equal(v.scope, true);
  assert.equal(v.scope_task, a.id);
  assert.deepEqual(s.pushed, [], "no Deliverables push while in the task");

  const card = s.e.ask(s.lead, { ...q, title: "Scoping done?", question: "Is the export format scoped?", scopingDone: done(a.id) });
  assert.deepEqual(card.request.options.map((o) => o.label), SCOPING_TASK_DONE_OPTIONS.map((o) => o.label));
  assert.equal(card.orchestrator.scope_task, a.id, "grouped under its task");
  assert.deepEqual(card.orchestrator.scoping_done, { summary: done(a.id).summary, doc: done(a.id).doc, task: a.id });
  assert.throws(() => s.e.ask(s.lead, { ...q, title: "Done now?", scopingDone: done(a.id) }), /already asks.*st-/, "one per task at a time");
  assert.equal(s.e.ask(s.lead, { ...q, title: "Retention scoped?", scopingDone: done(b.id) }).orchestrator.scope_task, b.id, "another task's may wait beside it");

  answer(s, card, "1");
  const closed = s.e.task(a.id)!;
  assert.equal(closed.state, "done");
  assert.equal(closed.summary, done(a.id).summary);
  assert.equal(closed.doc, done(a.id).doc);
  assert.equal(s.e.project("otter")!.mode, "active", "the project's mode is unchanged");
  assert.equal(s.e.task(b.id)!.state, "scoping", "the other task stays open");
  const ev = s.db.prepare(`SELECT value, ref, note FROM events WHERE kind = 'scope-task' AND project = 'otter' ORDER BY seq DESC LIMIT 1`).get() as { value: string; ref: string; note: string };
  assert.deepEqual({ ...ev }, { value: "done", ref: card.id, note: "Export format" }, "a timeline event names the card");
  assert.ok(items(s, "lead:otter", "notice").some((n) => n.ref === card.id && /closed scoping task/.test(n.body)), "the lead is told");
  assert.ok(items(s, "cos", "copy").some((c) => c.ref === card.id && /closed scoping task/.test(c.body)), "the CoS is told");

  // what still waited under it moves to the normal places; the other task's card stays in the pane
  const ny = s.e.needsYou();
  assert.deepEqual([...ny.cards, ...ny.held].map((c) => c.id).sort(), [left.id, left2.id].sort(), "the leftovers are on Needs you (one may wait behind the other)");
  assert.ok([left.id, left2.id].some((id) => s.up.includes(id)), "pushed to Needs you");
  assert.equal(s.e.deliverable(v.id)!.scope, undefined);
  assert.equal(s.e.deliverable(v.id)!.scope_task, undefined);
  assert.deepEqual(s.pushed, [v.id]);
  const p = pane(s, "otter")!;
  assert.deepEqual(p.tasks.map((x) => x.id), [b.id]);
  assert.ok(p.cards.some((c) => c.id === keep.id));
  assert.ok(p.cards.every((c) => c.orchestrator.scope_task === b.id));
  // and the closed task takes no more cards
  assert.throws(() => s.e.ask(s.lead, { ...q, scopeTask: a.id }), /is done since .*not open/);
});

test("a no on a task's \"Scoping done?\" keeps the task open, and the owner's note goes to the lead", () => {
  const s = setup();
  const t = s.e.openTask(s.lead, "Export format");
  const card = s.e.ask(s.lead, { ...q, title: "Scoping done?", scopingDone: done(t.id) });
  answer(s, card, "2", "Not yet: say who reads the JSON");
  assert.equal(s.e.task(t.id)!.state, "scoping");
  assert.match(items(s, "lead:otter", "decision.answer")[0]!.body, /Not yet.*who reads the JSON/);
  assert.equal(s.e.ask(s.lead, { ...q, scopeTask: t.id }).orchestrator.scope, true, "it still takes cards");
});

test("dropping a task moves its open cards to the normal flow", () => {
  const s = setup();
  const t = s.e.openTask(s.lead, "Export format");
  const d = s.e.ask(s.lead, { ...q, scopeTask: t.id });
  const ask = s.e.ask(s.lead, { ...q, title: "Scoping done?", scopingDone: done(t.id) });
  const r = s.e.dropTask(s.lead, "Export format");
  assert.equal(r.task.state, "dropped");
  assert.equal(r.moved, 1);
  assert.equal(s.e.decision(ask.id)!.state, "withdrawn", "its \"Scoping done?\" has nothing left to decide");
  const moved = s.e.decision(d.id)!;
  assert.equal(moved.orchestrator.scope, false);
  assert.equal(moved.orchestrator.scope_task, undefined);
  assert.deepEqual(s.e.needsYou().cards.map((c) => c.id), [d.id]);
  assert.equal(pane(s, "otter"), undefined, "nothing of otter scopes now");
  assert.ok(items(s, "cos", "copy").some((c) => /dropped scoping task/.test(c.body)), "the CoS is told");
  assert.equal(items(s, "lead:otter", "notice").filter((n) => /dropped scoping task/.test(n.body)).length, 0, "the lead did it: no notice to itself");
  // the name is free again
  assert.notEqual(s.e.openTask(s.lead, "Export format").id, t.id);
});

test("in a project scoping as a whole, a closed task's cards stay in its pane; ending the project's scoping leaves open tasks' cards there", () => {
  const s = setup();
  const t = s.e.openTask(s.kite, "Data sources");
  const u = s.e.openTask(s.kite, "Auth");
  const d = s.e.ask(s.kite, { ...q, scopeTask: t.id });
  const w = s.e.ask(s.kite, { ...q, title: "Which login?", scopeTask: u.id });
  const p = pane(s, "kite")!;
  assert.equal(p.whole, true);
  assert.deepEqual(p.tasks.map((x) => x.name), ["Data sources", "Auth"]);
  s.e.dropTask(s.kite, t.id);
  const back = s.e.decision(d.id)!;
  assert.equal(back.orchestrator.scope, true, "still the owner's, in the whole-project pane");
  assert.equal(back.orchestrator.scope_task, undefined);
  assert.deepEqual(s.e.needsYou().cards, []);
  // the project-wide yes makes kite active; the open task's card stays in the pane, the rest moves
  const end = s.e.ask(s.kite, { ...q, title: "Scoping done?", scopingDone: { summary: "Goal and plan.", projectMd: "/projects/kite/PROJECT.md" } });
  assert.equal(end.orchestrator.scope_task, undefined);
  answer(s, end, "1");
  assert.equal(s.e.project("kite")!.mode, "active");
  assert.equal(s.e.task(u.id)!.state, "scoping", "the project's end doesn't close its tasks");
  assert.equal(s.e.decision(w.id)!.orchestrator.scope, true);
  assert.deepEqual(s.e.needsYou().cards.map((c) => c.id), [d.id]);
  const after = pane(s, "kite")!;
  assert.equal(after.whole, false);
  assert.deepEqual(after.cards.map((c) => c.id), [w.id]);
});

test("a scope_task naming a closed or unknown task is refused with a clear message, and nothing is filed", () => {
  const s = setup();
  const t = s.e.openTask(s.lead, "Export format");
  s.e.dropTask(s.lead, t.id);
  const before = (s.db.prepare(`SELECT COUNT(*) AS n FROM decisions`).get() as { n: number }).n;
  assert.throws(() => s.e.ask(s.lead, { ...q, scopeTask: t.id }), new RegExp(`scoping task ${t.id} "Export format" is dropped since .*: leave scope_task out, or open a new task`));
  assert.throws(() => s.e.ask(s.lead, { ...q, scopeTask: "Export format" }), /is dropped/, "by its name too");
  assert.throws(() => s.e.ask(s.lead, { ...q, scopeTask: "st-nope" }), /otter has no scoping task "st-nope": open one with orch_scope_task\(action="open", name\)/);
  assert.throws(() => s.e.ask(s.lead, { ...q, scopingDone: done(t.id) }), /is dropped/, "nor can a closed task be proposed done");
  assert.throws(() => s.e.ask(s.lead, { ...q, scopingDone: { summary: "x", task: "st-nope" } }), /no scoping task/);
  assert.throws(() => s.e.deliver(s.lead, { title: "Spike", summary: "s", proof: [{ kind: "link", caption: "n", url: "https://example.com/n" }], scopeTask: t.id }, { roots: [] }), /is dropped/);
  const k = s.e.openTask(s.kite, "Data sources");
  assert.throws(() => s.e.ask(s.lead, { ...q, scopeTask: k.id }), /is kite's scoping task, not otter's/);
  const th = s.e.register("T-t9", "thread", "otter", "T-lo");
  const d = s.e.ask(th, q);
  assert.throws(() => s.e.forward(s.lead, d.id, null, "st-nope"), /no scoping task/);
  assert.equal(s.e.decision(d.id)!.orchestrator.at_level, "lead", "the refused forward left the card with the lead");
  assert.equal((s.db.prepare(`SELECT COUNT(*) AS n FROM decisions`).get() as { n: number }).n, before + 1, "only the thread's own question was filed");
  // opening: a name already open is refused, and so is an empty one
  assert.throws(() => s.e.openTask(s.lead, "Retention") && s.e.openTask(s.lead, "retention"), /already has an open scoping task "retention"/);
  assert.throws(() => s.e.openTask(s.lead, " "), /name is empty/);
  assert.throws(() => s.e.openTask(s.cos, "Anything"), /only a lead/);
});

test("a revision of a task's deliverable comes back under that task while it is open", () => {
  const s = setup();
  const t = s.e.openTask(s.lead, "Export format");
  const proof = [{ kind: "link" as const, caption: "notes", url: "https://example.com/n" }];
  const v = s.e.deliver(s.lead, { title: "Export spike", summary: "rev 1", proof, scopeTask: t.id }, { roots: [] });
  assert.equal(items(s, "cos", "copy").filter((c) => c.ref === v.id).length, 1, "the CoS gets a copy");
  s.e.personRequestChanges(v.id, v.rev, "Add the JSON sample");
  const r = s.e.deliver(s.lead, { title: "Export spike", summary: "rev 2", proof, revises: v.id }, { roots: [] });
  assert.equal(r.scope, true, "back in the Scope pane, not on Deliverables");
  assert.equal(r.scope_task, t.id);
  assert.deepEqual(s.pushed, []);
});

test("the CoS's inbox and Needs you view list each open task with its project, name and open cards, beside the scoping projects", () => {
  const s = setup();
  const t = s.e.openTask(s.lead, "Export format");
  s.e.ask(s.lead, { ...q, scopeTask: t.id });
  s.e.ask(s.kite, q);
  const text = s.e.inbox(s.cos).text;
  assert.match(text, /Scoping with the owner directly \(2\)/);
  assert.match(text, /- kite: 1 open card\n/);
  assert.match(text, new RegExp(`- otter: task "Export format" \\(${t.id}\\), 1 open card`));
  assert.match(s.e.needsYouView({ project: "otter" }).text, /- otter: task "Export format"/);
  assert.doesNotMatch(s.e.needsYouView({ project: "otter" }).text, /- kite:/);
  assert.match(s.e.inbox(s.lead).text, new RegExp(`Open scoping tasks \\(1\\): ${t.id} "Export format"`), "the lead sees its open tasks and their ids");
  assert.ok(items(s, "cos", "copy").some((c) => c.ref === t.id && /opened scoping task/.test(c.body)), "the CoS heard the task open");
});

test("the scoping tasks migration is appended after 1.11.0's project mode, and an older database gains it", () => {
  // 1.13.0's scoped_at follows it (scoping-switches.test.ts), so it is found by what it creates, not as the last entry
  const last = MIGRATIONS.findIndex((m) => /^CREATE TABLE scoping_tasks \(/.test(m));
  assert.ok(last > 0);
  assert.match(MIGRATIONS[last]!, /^CREATE TABLE scoping_tasks \(/);
  assert.match(MIGRATIONS[last]!, /ALTER TABLE spawns ADD COLUMN scope_task TEXT$/);
  assert.match(MIGRATIONS[last - 1]!, /^ALTER TABLE projects ADD COLUMN mode /, "appended after 1.11.0's, never before it");
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE _migrations (id INTEGER PRIMARY KEY)`);
  MIGRATIONS.slice(0, last).forEach((sql, i) => {
    db.exec(sql);
    db.prepare(`INSERT INTO _migrations (id) VALUES (?)`).run(i);
  });
  db.prepare(`INSERT INTO spawns (thread_id, plan_id, via, lead, created_at) VALUES ('T-old', NULL, 'person', NULL, 1)`).run();
  migrate(db);
  assert.equal((db.prepare(`SELECT scope_task FROM spawns WHERE thread_id = 'T-old'`).get() as { scope_task: string | null }).scope_task, null, "an older thread scopes nothing");
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM scoping_tasks`).get() as { n: number }).n, 0);
});
