// The CodeRabbit review queue's policy (2026-11-18, ported with a contributor's public PR's tests): eligibility, the
// priority order, CodeRabbit's replies, the durable lease, and the gh argument lists. The queue's one GitHub write
// is "@coderabbitai review"; these tests pin that every other gh call is a read and that the write sits in one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../core/db.ts";
import { assess, cooldownUntil, HOLD, initialState, MIN_GAP, parsePrUrl, pick, queueArgs, replyOutcome, THREADS_QUERY, TRIGGER, type Entry, type Facts } from "../core/review-queue.ts";
import { QueueStore } from "../review-queue/store.ts";

const now = 1_800_000_000_000;
const facts = (p: Partial<Facts> = {}): Facts => ({
  url: "https://github.com/acme/app/pull/1",
  title: "A fix",
  head: "abc",
  author: "owner",
  state: "open",
  draft: false,
  conflict: false,
  ci: "pass",
  approvals: 0,
  threads: 2,
  reviewedHead: false,
  lastReview: null,
  inProgressAt: null,
  recentRequestAt: null,
  ...p,
});
const entry = (p: Partial<Entry> = {}): Entry => ({ url: facts().url, auto: false, pinned: false, addedAt: now, facts: facts(), error: null, fetchedAt: now, ...p });
const store = () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return { db, store: new QueueStore(db) };
};

test("the defaults are Schedule off and Auto off at 65 minutes: a fresh queue never runs by itself", () => {
  const s = initialState();
  assert.deepEqual(s.config, { enabled: false, auto: false, intervalMinutes: 65, hostId: "", pickerProvider: "", pickerModel: "", pickerProjectId: "" }, "the model picker is off: no provider");
  assert.equal(s.nextAt, null, "no run is due");
  const t = store();
  assert.deepEqual(t.store.get().config, s.config, "a new database starts from the same defaults");
  t.db.close();
});

test("a queue saved before the model picker existed still loads, with the picker off", () => {
  const t = store();
  const old = initialState() as Record<string, unknown>;
  delete old.lastPicker;
  old.config = { enabled: true, auto: false, intervalMinutes: 90, hostId: "m1" }; // the row as the first port wrote it
  t.db.prepare("UPDATE review_queue_state SET json = ? WHERE id = 1").run(JSON.stringify(old));
  const s = t.store.get();
  assert.deepEqual(s.config, { enabled: true, auto: false, intervalMinutes: 90, hostId: "m1", pickerProvider: "", pickerModel: "", pickerProjectId: "" });
  assert.equal(s.lastPicker, "Deterministic");
  t.db.close();
});

test("only canonical GitHub PR URLs enter the queue", () => {
  assert.equal(parsePrUrl("https://github.com/acme/app/pull/12/files").url, "https://github.com/acme/app/pull/12");
  for (const url of ["https://evil.test/acme/app/pull/1", "https://github.com/acme/app/issues/1", "https://github.com/a/b/pull/0", "https://github.com/a/b/pull/1;echo"]) assert.throws(() => parsePrUrl(url));
});

test("eligibility skips completed heads, drafts, closed and incomplete reads", () => {
  for (const f of [{ state: "merged" }, { state: "closed" }, { draft: true }, { reviewedHead: true }] as Partial<Facts>[]) assert.equal(assess(entry({ facts: facts(f) }), null, "owner", now).eligible, false);
  assert.equal(assess(entry({ error: "read incomplete" }), null, "owner", now).eligible, false);
  assert.equal(assess(entry({ facts: null }), null, "owner", now).eligible, false, "never read: never eligible");
  assert.equal(assess(entry(), null, "owner", now).eligible, true);
});

test("Auto only accepts the signed-in user's green, conflict-free PRs; manual entries may be anyone's", () => {
  for (const f of [{ author: "someone" }, { ci: "pending" }, { ci: "fail" }, { ci: "unknown" }, { conflict: true }] as Partial<Facts>[])
    assert.equal(assess(entry({ auto: true, facts: facts(f) }), null, "owner", now).eligible, false);
  assert.equal(assess(entry({ facts: facts({ ci: "fail", author: "someone" }) }), null, "owner", now).eligible, true);
});

test("in-progress markers, recent requests and attempts hold safely", () => {
  for (const f of [{ inProgressAt: now }, { inProgressAt: 0 }, { recentRequestAt: now }] as Partial<Facts>[]) assert.equal(assess(entry({ facts: facts(f) }), null, "owner", now).eligible, false);
  const attempt = { url: facts().url, head: "abc", at: now, outcome: "unknown" as const, attempts: 1, commentUrl: null };
  assert.equal(assess(entry(), attempt, "owner", now + HOLD - 1).eligible, false, "an uncertain request holds for 3 hours");
  assert.equal(assess(entry(), { ...attempt, attempts: 3, at: now - HOLD }, "owner", now).eligible, false, "3 attempts on a head is the limit");
  assert.equal(assess(entry(), { ...attempt, head: "old", attempts: 3, at: now - HOLD }, "owner", now).eligible, true, "new commits reset it");
  assert.equal(assess(entry(), { ...attempt, outcome: "dry_run" }, "owner", now).eligible, true, "a dry run holds nothing");
});

test("pins precede approval tiers, then stable queue order", () => {
  const a = entry({ url: "a" }),
    b = entry({ url: "b", facts: facts({ approvals: 1 }) }),
    c = entry({ url: "c", pinned: true });
  assert.equal(pick([a, b, c], {}, "owner", now)?.url, "c");
  assert.equal(pick([a, b], {}, "owner", now)?.url, "b");
  assert.equal(pick([a, entry({ url: "d" })], {}, "owner", now)?.url, "a");
});

test("reply parsing accepts only the bot's replies after this request; the cooldown is bounded", () => {
  const reply = { author: "coderabbitai[bot]", body: "<!-- auto-generated reply by CodeRabbit --> Action performed", at: now };
  assert.equal(replyOutcome([reply], now - 1), "accepted");
  assert.equal(replyOutcome([{ ...reply, author: "owner" }], now - 1), null);
  assert.equal(replyOutcome([reply], now + 1), null);
  assert.equal(replyOutcome([{ ...reply, body: "auto-generated reply by CodeRabbit: Action not completed" }], now - 1), "not_completed");
  assert.equal(replyOutcome([{ ...reply, body: "auto-generated reply by CodeRabbit: Rate limit" }], now - 1), "rate_limited");
  assert.equal(cooldownUntil("Next included review available in 2 hours 5 minutes.", now, now), now + 125 * 60_000);
  assert.equal(cooldownUntil("Next included review available in 999999 hours.", now, now), now + 6 * MIN_GAP);
  assert.equal(cooldownUntil("unknown", now, now), now + MIN_GAP);
});

test("durable leases prevent concurrent runs and survive restart; removing doesn't erase attempts", () => {
  const { db, store: a } = store();
  const b = new QueueStore(db);
  a.mutate((s) => {
    s.entries.push(entry());
  });
  assert.equal(a.claim("a", now), true);
  assert.equal(b.claim("b", now + 1), false);
  a.mutate((s) => {
    s.history[facts().url] = { url: facts().url, head: "abc", at: now, outcome: "posting", attempts: 1, commentUrl: null };
    s.entries = [];
  });
  assert.equal(new QueueStore(db).get().history[facts().url]?.outcome, "posting");
  a.release("a");
  assert.equal(b.claim("b", now + 2), true);
  db.close();
});

test("every gh call but the trigger is a fixed read; the trigger writes only TRIGGER", () => {
  const reads = [
    queueArgs.user(),
    queueArgs.pull("acme/app", 1),
    queueArgs.reviews("acme/app", 1, 1),
    queueArgs.comments("acme/app", 1, 20),
    queueArgs.checks("acme/app", 1),
    queueArgs.threads("acme/app", 1, null),
    queueArgs.threads("acme/app", 1, "Y3Vyc29yOjE="),
    queueArgs.discover("owner"),
  ];
  for (const a of reads) {
    if (a[0] === "api" && a[1] === "graphql") {
      // GraphQL goes as a POST, so the query itself must be a read: the one fixed query, never a mutation
      assert.equal(a[3], `query=${THREADS_QUERY}`);
      assert.match(THREADS_QUERY, /^query\(/);
      assert.doesNotMatch(THREADS_QUERY, /mutation/i);
      continue;
    }
    if (a[0] === "api") {
      assert.deepEqual(a.slice(1, 3), ["--method", "GET"], `${a.join(" ")}: GET pinned`);
      assert.ok(!a.some((x) => ["-f", "-F", "--field", "--raw-field", "--input", "-X"].includes(x)), "a field would make gh POST");
    } else assert.ok(["pr checks", "search prs"].includes(a.slice(0, 2).join(" ")), `${a.join(" ")}: a read command`);
    assert.ok(!a.some((x) => /^(comment|review|merge|edit|close|reopen|ready|label|create|delete)$/.test(x)), "no write subcommand");
  }
  assert.deepEqual(queueArgs.trigger("acme/app", 7), ["api", "--method", "POST", "repos/acme/app/issues/7/comments", "-f", `body=${TRIGGER}`]);
  assert.equal(TRIGGER, "@coderabbitai review");
});

test("a value that isn't a repo, PR number, page, cursor or login never reaches gh", () => {
  assert.throws(() => queueArgs.pull("acme/app --web", 1), /repo/);
  assert.throws(() => queueArgs.trigger("../../orgs", 1), /repo/);
  assert.throws(() => queueArgs.trigger("acme/app", 0), /PR number/);
  assert.throws(() => queueArgs.comments("acme/app", 1, 21), /page/);
  assert.throws(() => queueArgs.threads("acme/app", 1, "x -F y"), /cursor/);
  assert.throws(() => queueArgs.discover("--web"), /login/);
});

test("the host has exactly one write: queueArgs.trigger, in post(), after the dry-run return", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "review-queue", "host.ts"), "utf8");
  assert.equal(src.match(/queueArgs\.trigger\(/g)?.length, 1, "one trigger call site");
  assert.doesNotMatch(src, /"POST"|"-X"|--method", "POST|\bexec\(|execSync|spawn|shell:\s*true/, "no other way to write or run");
  const post = src.slice(src.indexOf("async function post("));
  assert.ok(post.indexOf("if (input.dryRun) return") > 0 && post.indexOf("if (input.dryRun) return") < post.indexOf("queueArgs.trigger("), "dry-run returns before the write");
  for (const file of ["server.ts", "runner.ts", "contract.ts", "store.ts", "picker.ts"])
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, "..", "review-queue", file), "utf8"), /queueArgs\.trigger|execFile|child_process/, `${file} can't reach gh`);
  // the server's run port never asks the host to post without its own dry-run check
  assert.match(readFileSync(join(import.meta.dirname, "..", "review-queue", "server.ts"), "utf8"), /dryRun: dryRun \|\| deps\.dryRun\(\)/);
});
