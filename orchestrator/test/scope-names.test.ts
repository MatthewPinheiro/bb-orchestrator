// The Scope tab's one title format (2026-11-17, the owner: "update the naming convention … it's kind of confusing"). The
// list showed "Task: act2vate-move: move … into …" beside "Task: six-ai-trends-numbers": the word "Task", a slug and the
// words, in a different shape per entry. Every entry now reads as its task's plain title; a slug moves to a muted line,
// and the planner is one short name beside its avatar, never the task's title said twice.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entryTitle, plannerName, taskTitle } from "../app/scope-names.ts";
import type { ScopeEntry } from "../app/kit.ts";

test("a task's title is its words: a slug in front moves to its own line, a bare slug reads as words", () => {
  assert.deepEqual(taskTitle("trends-export: move the report export into the new pipeline"), { title: "Move the report export into the new pipeline", slug: "trends-export" });
  assert.deepEqual(taskTitle("region-totals"), { title: "Region Totals", slug: null }, "a slug alone, as words (as the sidebar names projects)");
  assert.deepEqual(taskTitle("six-ai-trends-numbers"), { title: "Six AI Trends Numbers", slug: null });
});

test("a name that is already words is left alone, colon and all", () => {
  // "Trend numbers" is not a slug: its colon is part of the title
  assert.deepEqual(taskTitle("Trend numbers: Oct + Nov MTD"), { title: "Trend numbers: Oct + Nov MTD", slug: null });
  assert.deepEqual(taskTitle("Ranking signals"), { title: "Ranking signals", slug: null });
  assert.deepEqual(taskTitle("v2: the new API"), { title: "v2: the new API", slug: null }, "one word is not a slug");
});

const entry = (task: string | null, planner: ScopeEntry["planner"] = null): ScopeEntry => ({ key: task ? `lark/st-1` : "lark", slug: "lark", task: task ? { id: "st-1", name: task } : null, planner });

test("no entry says 'Task:'; the whole project says so", () => {
  assert.equal(entryTitle(entry(null)).title, "Whole project");
  assert.doesNotMatch(entryTitle(entry("trends-export: move it")).title, /^Task:/);
});

test("the planner is one short name for its avatar, never the task's title again", () => {
  assert.deepEqual(plannerName(entry("Pricing page copy")), { name: "Lead", address: "lead:lark", state: null });
  const thread = (title: string) => ({ threadId: "T-1", address: "thread:lark:2", title, status: "active" }) as ScopeEntry["planner"];
  assert.deepEqual(plannerName(entry("Survey wording", thread("Scout"))), { name: "Scout", address: "thread:lark:2", state: "working" });
  // a scoping thread named after its task (the usual case) would repeat the title right under it
  assert.equal(plannerName(entry("trends-export: move it", thread("trends-export: move it"))).name, "Scoping thread");
});
