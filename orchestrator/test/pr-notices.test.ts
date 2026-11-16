// PR notices say only real changes (a storage lead, 2026-11-13). PR 1100 sat at one head, conflicting,
// and still sent 45 notices that flipped between "open (conflicts)" and "open (review requested)": GitHub reads
// mergeable UNKNOWN while it recomputes after any push to the base, and bb's attention then falls through to the next
// label. Every flip was a message to the lead about nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type PrResult } from "../core/engine.ts";
import type { Item } from "../core/model.ts";

function setup() {
  const sent: Item[] = [];
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, {
    now: () => Date.parse("2026-11-13T18:00:00Z"),
    async deliver(_t, _x, item) {
      sent.push(item);
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  e.register("T-cos", "cos", null);
  e.register("T-la", "lead", "alpha");
  const w = e.register("T-w1", "thread", "alpha", "T-la");
  const notices = (to = "lead:alpha") => (db.prepare(`SELECT body FROM items WHERE kind = 'notice' AND recipient = ? ORDER BY created_at, rowid`).all(to) as { body: string }[]).map((r) => r.body);
  return { e, db, w, notices };
}

const URL7 = "https://github.com/o/r/pull/7";
/** A reading as bb--github-pr-status gives it; `attention` is what bb derived from the rest. */
const reading = (p: { mergeable: string | null; merge: string; review: string; checks?: string; attention: string; state?: string; queued?: boolean }): PrResult => ({
  outcome: "available",
  pullRequest: { url: URL7, number: 7, state: p.state ?? "open", attention: p.attention, checks: { state: p.checks ?? "passing" }, review: { state: p.review }, mergeability: { state: p.merge, mergeable: p.mergeable, mergeStateStatus: null }, inMergeQueue: p.queued ?? false },
});
const conflicting = reading({ mergeable: "CONFLICTING", merge: "conflicts", review: "review_requested", attention: "conflicts" });
const recomputing = reading({ mergeable: "UNKNOWN", merge: "unknown", review: "review_requested", attention: "review_requested" });
// mergeStateStatus can read BLOCKED while mergeable is still UNKNOWN: bb then says "blocked", which isn't news either
const recomputingBlocked = reading({ mergeable: "UNKNOWN", merge: "blocked", review: "review_requested", attention: "blocked" });

test("a conflicting PR whose mergeable GitHub is recomputing sends one notice, not one per flip", () => {
  const s = setup();
  for (let i = 0; i < 6; i++) {
    s.e.prSeen(s.w, "env1", conflicting);
    s.e.prSeen(s.w, "env1", i % 2 ? recomputing : recomputingBlocked);
  }
  assert.deepEqual(s.notices(), [`thread:alpha:1: PR #7 open (conflicts, review requested), checks passing ${URL7}`]);
});

test("real changes still reach the lead: review decision, checks, and a known mergeability that changed", () => {
  const s = setup();
  s.e.prSeen(s.w, "env1", conflicting);
  assert.equal(s.e.prSeen(s.w, "env1", reading({ mergeable: "UNKNOWN", merge: "unknown", review: "changes_requested", attention: "changes_requested" })), true, "a review is news, even mid-recompute");
  assert.equal(s.e.prSeen(s.w, "env1", reading({ mergeable: "UNKNOWN", merge: "unknown", review: "changes_requested", checks: "pending", attention: "changes_requested" })), true, "a push restarts the checks");
  assert.equal(s.e.prSeen(s.w, "env1", reading({ mergeable: "MERGEABLE", merge: "blocked", review: "changes_requested", attention: "changes_requested", checks: "pending" })), true, "the conflict is gone: news");
  assert.equal(s.e.prSeen(s.w, "env1", reading({ mergeable: "MERGEABLE", merge: "mergeable", review: "approved", attention: "ready_to_merge" })), true);
  assert.equal(s.e.prSeen(s.w, "env1", reading({ mergeable: "MERGEABLE", merge: "mergeable", review: "approved", attention: "merged", state: "merged" })), true);
  assert.equal(s.notices().length, 6);
});

test("no two notices in a row read the same: the text says exactly what changed", () => {
  const s = setup();
  s.e.prSeen(s.w, "env1", conflicting);
  s.e.prSeen(s.w, "env1", reading({ mergeable: "UNKNOWN", merge: "unknown", review: "changes_requested", attention: "changes_requested" }));
  s.e.prSeen(s.w, "env1", reading({ mergeable: "CONFLICTING", merge: "conflicts", review: "approved", attention: "conflicts" }));
  const n = s.notices();
  assert.equal(n.length, 3);
  for (let i = 1; i < n.length; i++) assert.notEqual(n[i], n[i - 1], `notice ${i} repeats the one before`);
  assert.match(n[1]!, /\(conflicts, changes requested\)/, "a review that lands mid-recompute still says the PR conflicts");
});

test("the first reading after the upgrade is silent: a new signature format is no news", () => {
  const s = setup();
  // a 1.2.x row: url|state|attention|checks
  s.db
    .prepare(`INSERT INTO prs (environment_id, thread_id, url, number, state, attention, checks, sig, seen_at) VALUES ('env1', 'T-w1', ?, 7, 'open', 'conflicts', 'passing', ?, 0)`)
    .run(URL7, `${URL7}|open|conflicts|passing`);
  assert.equal(s.e.prSeen(s.w, "env1", recomputing), false, "same PR, state and checks: adopted quietly");
  assert.equal(s.e.prSeen(s.w, "env1", conflicting), false, "the old row's conflict carried over");
  assert.equal(s.notices().length, 0);
  assert.equal(s.e.prSeen(s.w, "env1", reading({ mergeable: "CONFLICTING", merge: "conflicts", review: "review_requested", checks: "failing", attention: "conflicts" })), true);
});

test("ready to merge reaches the CoS even when it lands on a reading where GitHub is still recomputing", () => {
  const s = setup();
  s.e.prSeen(s.w, "env1", reading({ mergeable: "MERGEABLE", merge: "mergeable", review: "approved", checks: "pending", attention: "checks_pending" }));
  assert.equal(s.notices("cos").length, 0);
  // checks turn green while mergeable reads UNKNOWN: bb says "none", but the PR is ready, and the next known reading
  // has the same signature, so this is the only chance to tell the CoS
  s.e.prSeen(s.w, "env1", reading({ mergeable: "UNKNOWN", merge: "unknown", review: "approved", attention: "none" }));
  assert.equal(s.notices("cos").length, 1);
  assert.equal(s.e.prFor("env1")!.attention, "ready_to_merge", "the lanes show what the notice said");
  assert.equal(s.e.prSeen(s.w, "env1", reading({ mergeable: "MERGEABLE", merge: "mergeable", review: "approved", attention: "ready_to_merge" })), false);
});

test("joining the merge queue is news", () => {
  const s = setup();
  s.e.prSeen(s.w, "env1", reading({ mergeable: "MERGEABLE", merge: "mergeable", review: "approved", attention: "ready_to_merge" }));
  assert.equal(s.e.prSeen(s.w, "env1", reading({ mergeable: "MERGEABLE", merge: "mergeable", review: "approved", attention: "queued", queued: true })), true);
  assert.match(s.notices().at(-1)!, /\(mergeable, approved, queued\)/);
});
