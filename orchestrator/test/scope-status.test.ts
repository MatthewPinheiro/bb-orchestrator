// The Scope entry while nothing waits (2026-11-17). The owner asked for a better empty state while scoping: with no card
// to answer, the entry left most of a wide pane blank (an empty cards column beside the chat). Why each rule matters:
// - an entry with nothing waiting shows one status card in place of the cards column, and with the list beside it the
//   card takes a slim column and the chat the rest, so no column stands blank; an entry with anything waiting (a card or
//   a scoping deliverable to review) keeps its cards column exactly as before, or the owner would lose what to answer;
// - "on now" is the planner's own line: a thread's task never shows the lead's status, which covers the whole project
//   and would read as the thread's; the lead's update or step, whichever it published last;
// - "done so far" lists only this entry's scoping deliverables the owner already reviewed: one still in review waits in
//   the cards column, and another entry's would put the wrong work under this one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Projects } from "../contract.ts";
import { scopeDone, scopeQuiet, scopeStatus, type ScopeEntry } from "../app/kit.ts";

const source = readFileSync(join(import.meta.dirname, "..", "app", "scope.tsx"), "utf8");

test("nothing waiting: the entry shows its status card, not an empty cards column; anything waiting: its cards as before", () => {
  assert.equal(scopeQuiet({ cards: 0, delivered: 0 }), true, "no card and nothing to review: the status card");
  assert.equal(scopeQuiet({ cards: 1, delivered: 0 }), false, "an open card: the cards column");
  assert.equal(scopeQuiet({ cards: 0, delivered: 1 }), false, "a scoping deliverable to review: the cards column");

  // the tab draws one or the other from that rule, never the cards column while nothing waits
  assert.match(source, /const quiet = scopeQuiet\(\{ cards: cards\.length, delivered: delivered\.length \}\);/);
  assert.match(source, /\{quiet \? \(\s*<StatusCard[\s\S]*?\/>\s*\) : \(\s*cardsCol\s*\)\}\s*\{chatCol\}/, "the status card stands where the cards would; the chat follows either way");
  // 2026-11-17: shadcn's Card (app/ui) since the shadcn pass, in place of affectUI's
  assert.match(source, /<UiCard role="region" className="orch-scope__status[^"]*" data-scope-status=\{entry\.key\}/, "the status card is shadcn's card");
  // wide, the card is about the list's width beside the chat; with cards waiting the chat goes beside them only from 1440
  assert.match(source, /const side = quiet \? wide : width >= CHAT_BESIDE_MIN;/);
  assert.match(source, /\.orch-scope__body\[data-quiet="true"\]\[data-side="true"\] \{ grid-template-columns: minmax\(280px, 340px\) minmax\(0, 1fr\); \}/);
  assert.match(source, /\.orch-scope\[data-layout="list-detail"\] \.orch-scope__grid \{ grid-template-columns: minmax\(280px, 340px\) minmax\(0, 1fr\);/, "the slim column matches the list's width");
  assert.match(source, /\.orch-scope__body\[data-side="true"\] \{ grid-template-columns: minmax\(0, 1fr\) minmax\(360px, 1fr\); \}/, "with cards waiting, the cards and the chat share the width as before");
  assert.match(source, /data-quiet=\{quiet \? "true" : "false"\}/);
});

type ProjectRow = Pick<Projects[number], "slug" | "lead" | "status" | "summary">;
const lead = (status: string) => ({ address: "lead:otter", threadId: "T-lead", status, mon: null });
const leadStatus = (o: { updatedAt: number; update?: { first: string; at: number } }): NonNullable<Projects[number]["status"]> => ({
  goal: "Rebuild the search index",
  steps: [
    { title: "Mapping", state: "done" },
    { title: "Backfill", state: "current" },
    { title: "Preview", state: "next" },
  ],
  waitingOn: { kind: "none", ref: null, label: null },
  blockers: [],
  update: o.update ? { workingOn: [o.update.first, "Second bullet"], at: "Backfill", needs: "", updateAt: o.update.at } : null,
  updatedAt: o.updatedAt,
  by: "lead:otter",
});
const project = (o: Partial<ProjectRow>): ProjectRow => ({ slug: "otter", lead: lead("idle"), status: null, summary: null, ...o });
const whole: ScopeEntry = { key: "otter", slug: "otter", task: null };
const task: ScopeEntry = { key: "otter/st-1", slug: "otter", task: { id: "st-1", name: "Ranking signals" }, planner: null };
const scouted: ScopeEntry = { ...task, planner: { address: "thread:otter:1", threadId: "T-s", title: "Scout", status: "active", idleAt: null, report: null } };

test("on now is the planner's own line: a thread's last report, never the lead's status under the thread's task", () => {
  const busyLead = project({ lead: lead("active"), status: leadStatus({ updatedAt: 9_000, update: { first: "Drafting PR review corrections", at: 9_000 } }) });
  const s = scopeStatus(scouted, busyLead);
  assert.equal(s.who.kind, "thread");
  assert.equal(s.who.name, "Scout");
  assert.equal(s.who.working, true);
  assert.equal(s.now, null, "no report yet: the card says so, not the lead's newer line about other work");
  const reported = scopeStatus({ ...scouted, planner: { ...scouted.planner!, status: "idle", idleAt: 5_000, report: { text: "Two signals usable", at: 4_000 } } }, busyLead);
  assert.deepEqual(reported.now, { text: "Two signals usable", from: "report", at: 4_000 });
  assert.deepEqual([reported.who.state, reported.who.idleSince], ["idle", 5_000], "idle, and since when: its last activity");
});

test("the lead's on now is its update or its current step, whichever it published last", () => {
  const both = (updatedAt: number, updateAt: number) => scopeStatus(whole, project({ status: leadStatus({ updatedAt, update: { first: "Goal and limits written", at: updateAt } }) })).now;
  assert.deepEqual(both(1_000, 1_000), { text: "Goal and limits written", from: "update", at: 1_000 }, "one orch_status with both: the update, written for the owner");
  assert.deepEqual(both(2_000, 1_000), { text: "Step 2 of 3: Backfill", from: "step", at: 2_000 }, "a later status without an update: its step is newer");
  assert.deepEqual(scopeStatus(task, project({ status: leadStatus({ updatedAt: 3_000 }) })).now, { text: "Step 2 of 3: Backfill", from: "step", at: 3_000 }, "the lead plans the task itself: its step");
  assert.equal(scopeStatus(whole, project({})).now, null, "no status yet");
  const idle = scopeStatus(whole, project({ summary: { leadIdleSince: 7_000 } as NonNullable<ProjectRow["summary"]> }));
  assert.deepEqual([idle.who.kind, idle.who.name, idle.who.state, idle.who.idleSince], ["lead", "The lead", "idle", 7_000]);
  assert.deepEqual([scopeStatus(whole, project({ lead: null })).who.state, scopeStatus(whole, undefined).who.address], ["not running", null]);
});

test("done so far: this entry's scoping deliverables the owner already reviewed, newest first", () => {
  const p = { slug: "otter", cards: [], whole: true, tasks: [{ id: "st-1", name: "Ranking signals", openedAt: 0 }] };
  const d = (id: string, state: string, updatedAt: number, more: { project?: string; scope?: boolean; scopeTask?: string } = {}) => ({ id, project: "otter", state, scope: true, updatedAt, ...more });
  const all = [
    d("a", "approved", 1),
    d("b", "changes", 3),
    d("c", "review", 4),
    d("e", "withdrawn", 5),
    d("f", "approved", 6, { scopeTask: "st-1" }),
    d("g", "approved", 7, { scope: false }),
    d("h", "approved", 8, { project: "kite" }),
  ];
  assert.deepEqual(scopeDone(all, p, null).map((x) => x.id), ["b", "a"], "whole project: reviewed ones only, never one in review, withdrawn, another task's, a non-scoping one or another project's");
  assert.deepEqual(scopeDone(all, p, "st-1").map((x) => x.id), ["f"], "the task: its own only");
});
