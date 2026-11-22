// Projects' scoping children (app/kit.ts, 2026-11-22): a project's scope entries sit under its row instead of in a
// Scoping group on top, so the project shows once, with one count that agrees with its children.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Projects } from "../contract.ts";
import { childHits, childWaiting, childrenOpen, listRow, matchesWithScope, plannerStuck, quietWithScope, scopeExtra, type ScopeChild, type ScopeEntry } from "../app/kit.ts";
import { attentionOrder } from "../app/command-center.ts";

const whole = (waiting: number, deliverables = 0): ScopeChild => ({ entry: { key: "kite", slug: "kite", task: null }, waiting, deliverables });
const task = (id: string, name: string, waiting: number, deliverables = 0): ScopeChild => ({ entry: { key: `kite/${id}`, slug: "kite", task: { id, name } }, waiting, deliverables });
const closed = { toggled: undefined, stored: null, holdsOpen: false, searchHit: false };

const project = (slug: string, cards: number) =>
  ({
    slug, priority: "normal", heldAt: null, archivedAt: null, mode: "scoping", lead: { address: `lead:${slug}`, threadId: "T", status: "idle", mon: null }, threads: 0, monType: null, status: null,
    summary: { motion: "quiet", threads: { working: 0, total: 0 }, leadWorking: false, needsYou: { count: cards, id: null, title: null, question: null, since: null }, waits: [], statusOutOfDate: false },
  }) as unknown as Projects[number];

test("the parent's 'N for you' counts each waiting item once: its cards (scope cards included) plus scope deliverables", () => {
  // scoping-demo, 2026-11-22 (the live database): one card under its task, one for the whole project, no deliverables.
  // needsYou.count already holds both scope cards (core/history.ts counts every person-level card), so the row says 2, not 4
  const kids = [whole(1), task("st-1", "Demo task", 1)];
  assert.equal(childWaiting(kids), 2, "the children's rows still say what waits in each");
  assert.equal(scopeExtra(kids), 0);
  assert.equal(listRow(project("scoping-demo", 2), [], 0, false, scopeExtra(kids)).number?.word, "2 for you");
  // a scope deliverable in review is not in needsYou: it adds
  const withDl = [whole(2, 1), task("st-1", "Demo task", 1)];
  assert.equal(listRow(project("kite", 2), [], 0, false, scopeExtra(withDl)).number?.word, "3 for you");
  assert.equal(listRow(project("kite", 0), [], 0, false, scopeExtra([whole(1, 1)])).number?.word, "1 for you", "only a scope deliverable waits: still for you");
});

test("a project whose only waiting item is in its children sorts with those that need the owner", () => {
  const quiet = project("aaa-quiet", 0);
  const scoped = project("zzz-scoped", 0);
  const extra = (p: Projects[number]) => (p.slug === "zzz-scoped" ? 1 : 0);
  assert.deepEqual([quiet, scoped].sort(attentionOrder(new Map(), 0, extra)).map((p) => p.slug), ["zzz-scoped", "aaa-quiet"]);
  assert.deepEqual([quiet, scoped].sort(attentionOrder(new Map(), 0)).map((p) => p.slug), ["aaa-quiet", "zzz-scoped"], "without it, by name as before");
});

test("a project whose children wait is never Quiet; one whose children don't keeps its own rule", () => {
  assert.equal(quietWithScope(true, [whole(0), task("a", "A", 1)]), false);
  assert.equal(quietWithScope(true, [whole(0)]), true);
  assert.equal(quietWithScope(true, []), true);
  assert.equal(quietWithScope(false, []), false);
});

test("'Needs me' matches a project while a child waits; the other filters keep their own rule", () => {
  assert.equal(matchesWithScope("you", false, [task("a", "A", 1)]), true);
  assert.equal(matchesWithScope("you", false, [task("a", "A", 0)]), false);
  assert.equal(matchesWithScope("blocked", false, [task("a", "A", 3)]), false, "a waiting child doesn't make it blocked");
  assert.equal(matchesWithScope("blocked", true, []), true);
});

test("children start open while one waits; else the viewer's last choice; else closed", () => {
  assert.equal(childrenOpen({ kids: [whole(0), task("a", "A", 1)], ...closed }), true, "something waits");
  assert.equal(childrenOpen({ kids: [whole(0)], ...closed }), false, "default collapsed");
  assert.equal(childrenOpen({ kids: [whole(0)], ...closed, stored: true }), true, "remembered open");
  assert.equal(childrenOpen({ kids: [whole(0)], ...closed, stored: false }), false, "remembered closed");
  assert.equal(childrenOpen({ kids: [whole(2)], ...closed, toggled: false }), false, "the chevron closes it even while something waits");
  assert.equal(childrenOpen({ kids: [whole(0)], ...closed, toggled: true }), true);
  assert.equal(childrenOpen({ kids: [whole(0)], ...closed, holdsOpen: true }), true, "the open scope entry is in sight");
  assert.equal(childrenOpen({ kids: [whole(0)], ...closed, searchHit: true }), true, "a searched task is in sight");
});

test("a search matching a task's name finds that child, by every word, any case", () => {
  const kids = [whole(0), task("a", "Region totals export", 0), task("b", "Digest emails", 0)];
  assert.deepEqual(childHits(kids, "totals REGION").map((k) => k.entry.key), ["kite/a"]);
  assert.deepEqual(childHits(kids, "whole"), [], "the whole-project child has no task name");
  assert.deepEqual(childHits(kids, "  "), []);
});

test("a child row names its planner only when a task's scoping thread is stuck", () => {
  const planner = (status: string) => ({ address: "thread:kite:2", threadId: "T2", title: "Scope the export", status, idleAt: null, report: null });
  const e = (status: string | null): ScopeEntry => ({ key: "kite/a", slug: "kite", task: { id: "a", name: "A" }, planner: status ? (planner(status) as ScopeEntry["planner"]) : null });
  assert.equal(plannerStuck(e("error")), "stuck on an error");
  assert.equal(plannerStuck(e("active")), null, "working: nothing");
  assert.equal(plannerStuck(e("idle")), null);
  assert.equal(plannerStuck(e(null)), null, "the lead plans: nothing");
  assert.equal(plannerStuck({ key: "kite", slug: "kite", task: null }), null, "the whole project: nothing");
});
