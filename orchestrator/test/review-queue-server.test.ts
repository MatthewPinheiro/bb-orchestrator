// The review queue with its defaults (2026-11-18): nothing runs and nothing is written until the owner says so.
// Schedule and Auto start off and dry-run (the reviewQueueDryRun setting) starts on; no timer exists until Schedule is
// on; Run now with dry-run on asks the host for a dry run, so gh never runs a write; the queue's changes are the
// owner's page-only writes, never an RPC an agent can call. The optional model picker is off by default: no settings
// change, no picker thread. The full server entry runs against a fake bb host whose machine is a fake gh, so "no write"
// is checked on the argument lists gh would have run, and "no picker thread" on every threads.spawn bb was asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../server.ts";
import { migrate } from "../core/db.ts";
import { TRIGGER } from "../core/review-queue.ts";
import { makeQueueGitHub, type Run } from "../review-queue/host.ts";
import { registerReviewQueue } from "../review-queue/server.ts";
import { REVIEW_QUEUE_WRITE, type QueueView } from "../review-queue/contract.ts";
import { PICKER_TITLE } from "../review-queue/picker.ts";

const PR = "https://github.com/acme/app/pull/1";
const PR2 = "https://github.com/acme/app/pull/2";
const ok = (v: unknown) => ({ stdout: JSON.stringify(v), stderr: "", code: 0 });
const owner = { login: "owner", type: "User" };

/** A fake gh on the fake machine: open, green, unreviewed PRs (1 and 2). Records every argument list. */
function fakeGh() {
  const argv: string[][] = [];
  const run: Run = async (args) => {
    argv.push(args);
    if (args.includes("POST") || args.includes("-X")) return ok({ user: owner, body: TRIGGER, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", html_url: `${PR}#c1` });
    if (args[0] === "pr") return ok([{ bucket: "pass" }]);
    if (args[0] === "search") return ok([{ url: PR }]);
    if (args[1] === "graphql") return ok({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
    const path = args[3]!;
    if (path === "user") return ok(owner);
    if (/^repos\/acme\/app\/pulls\/[12]\/reviews/.test(path) || path.includes("/comments?")) return ok([]);
    if (/^repos\/acme\/app\/pulls\/[12]$/.test(path)) return ok({ title: "A PR", head: { sha: "abc" }, user: owner, state: "open", merged: false, draft: false, mergeable: true, mergeable_state: "clean" });
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  const gh = makeQueueGitHub(run);
  const calls: { method: string; input: any }[] = [];
  const client = {
    call: async (method: string, input: any) => {
      calls.push({ method, input });
      if (method === "reviewQueue.identity") return gh.identity();
      if (method === "reviewQueue.inspect") return gh.inspect(input.url);
      if (method === "reviewQueue.discover") return gh.discover();
      if (method === "reviewQueue.outcome") return gh.outcome(input.url, input.at);
      if (method === "reviewQueue.post") return gh.post(input);
      throw new Error(`no ${method} here`);
    },
  };
  const writes = () => argv.filter((a) => a.includes("POST") || a.includes("-X"));
  return { argv, calls, client, writes };
}
const machine = { id: "m1", name: "dev box", type: "persistent", lifecycle: { phase: "active" }, status: "connected" };

/** bb's thread API as the picker sees it: every spawn recorded; the model answers `answer`. */
function fakeThreads(answer = '{"index":1}') {
  const spawned: any[] = [];
  const done: string[] = [];
  const threads = {
    spawn: async (args: any) => {
      spawned.push(args);
      return { id: `t${spawned.length}` };
    },
    wait: async () => ({ matched: true }),
    output: async () => ({ output: answer }),
    stop: async ({ threadId }: { threadId: string }) => void done.push(`stop ${threadId}`),
    archive: async ({ threadId }: { threadId: string }) => void done.push(`archive ${threadId}`),
  };
  const models: unknown[] = [];
  const providers = {
    catalog: async () => [{ id: "claude-code", displayName: "Claude Code", enabled: true, available: true }],
    models: async (q: unknown) => {
      models.push(q);
      return { modelLoadError: null, providers: [{ id: "claude-code", available: true }], models: [{ id: "claude-haiku-5-5", model: "claude-haiku-5-5", isDefault: true }] };
    },
  };
  return { threads, providers, spawned, done, models };
}

/** registerReviewQueue alone, with its timers in the test's hands. */
function queueAlone(dryRun = true) {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const gh = fakeGh();
  const bbThreads = fakeThreads();
  const services = new Map<string, { start: (s: AbortSignal) => Promise<void> }>();
  const set: number[] = [];
  let pending: (() => void) | null = null;
  const rpc: Record<string, (i: unknown) => Promise<unknown>> = {};
  const bb: any = {
    hosts: { experimental_client: () => gh.client },
    sdk: { hosts: { list: async () => [machine] }, threads: bbThreads.threads, providers: bbThreads.providers },
    realtime: { publish: () => {} },
    rpc: { register: (_c: unknown, h: typeof rpc) => Object.assign(rpc, h) },
    background: { service: (n: string, s: any) => services.set(n, s) },
    onDispose: () => {},
    log: { warn: () => {}, info: () => {}, error: () => {} },
  };
  const q = registerReviewQueue(bb, {
    db,
    dryRun: () => dryRun,
    timers: {
      set: (f, ms) => {
        set.push(ms);
        pending = f;
        return set.length;
      },
      clear: () => {
        pending = null;
      },
    },
  });
  const stop = new AbortController();
  void services.get("review-queue")!.start(stop.signal);
  const idle = async () => {
    for (let i = 0; i < 200 && ((await rpc.reviewQueue!(null)) as QueueView).busy; i++) await new Promise((r) => setTimeout(r, 5));
  };
  return { db, gh, q, set, pending: () => pending, rpc, stop, idle, threads: bbThreads };
}

test("with the defaults there is no timer, no lease, no read and no write", async () => {
  const t = queueAlone();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(t.set, [], "the service started and armed nothing: Schedule is off");
  assert.equal(t.pending(), null);
  assert.deepEqual(t.gh.calls, [], "no host call at all");
  assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM review_queue_lease").get() as { n: number }).n, 0, "no run took the lease");
  const v = (await t.rpc.reviewQueue!(null)) as QueueView;
  assert.deepEqual([v.config.enabled, v.config.auto, v.dryRun], [false, false, true], "Schedule off, Auto off, dry-run on");
  t.stop.abort();
  t.db.close();
});

test("the timer exists only while Schedule is on: on arms one, off clears it", async () => {
  const t = queueAlone();
  t.q.act({ action: "configure", config: { enabled: true } });
  assert.equal(t.set.length, 1, "Schedule on: one timer");
  assert.ok(Math.abs(t.set[0]! - 65 * 60_000) < 1000, "for the interval");
  t.q.act({ action: "configure", config: { enabled: false } });
  assert.equal(t.pending(), null, "Schedule off: no timer left");
  assert.equal(t.set.length, 1, "and none set again");
  assert.deepEqual(t.gh.calls, []);
  t.stop.abort();
  t.db.close();
});

test("a due tick runs once (a dry run) and re-arms for the next interval", async () => {
  const t = queueAlone();
  t.q.act({ action: "add", url: PR });
  await t.idle();
  t.q.act({ action: "configure", config: { enabled: true } });
  t.q.store.mutate((s) => {
    s.nextAt = Date.now() - 1; // due
  });
  t.q.armTimer();
  t.pending()!();
  await t.idle();
  assert.equal(t.gh.calls.filter((c) => c.method === "reviewQueue.post").length, 1, "one run, one (dry) post call");
  assert.deepEqual(t.gh.writes(), []);
  assert.ok(Math.abs(t.set.at(-1)! - 65 * 60_000) < 2000, `re-armed for the interval, not ${t.set.at(-1)}`);
  t.stop.abort();
  t.db.close();
});

test("a tick that finds the lease held (a reload mid-run) waits a minute, never spins", async () => {
  const t = queueAlone();
  t.q.act({ action: "configure", config: { enabled: true } });
  t.q.store.mutate((s) => {
    s.nextAt = Date.now() - 1;
  });
  t.db.prepare("INSERT INTO review_queue_lease (id, token, expires) VALUES (1, 'other-generation', ?)").run(Date.now() + 5 * 60_000);
  t.q.armTimer();
  t.pending()!();
  await t.idle();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(t.gh.calls, [], "the held lease stops the run before any read");
  assert.ok(t.set.at(-1)! >= 60_000, `the next try is at least a minute away, not ${t.set.at(-1)} ms`);
  t.stop.abort();
  t.db.close();
});

test("Run now with dry-run on makes no GitHub write and shows what it would post", async () => {
  const t = queueAlone(true);
  t.q.act({ action: "add", url: PR });
  await t.idle(); // Add reads the new PR at once
  assert.ok(!t.gh.calls.some((c) => c.method === "reviewQueue.post"), "Add only reads");
  t.q.act({ action: "run" });
  await t.idle();
  assert.ok(t.gh.calls.some((c) => c.method === "reviewQueue.post" && c.input.dryRun === true), "the host was asked for a dry run");
  assert.ok(!t.gh.calls.some((c) => c.method === "reviewQueue.post" && c.input.dryRun !== true), "never for a live one");
  assert.deepEqual(t.gh.writes(), [], "gh ran no write");
  const v = (await t.rpc.reviewQueue!(null)) as QueueView;
  assert.deepEqual(v.wouldPost && [v.wouldPost.url, v.wouldPost.comment], [PR, TRIGGER]);
  assert.deepEqual(v.history, {}, "a dry run spends no attempt");
  assert.deepEqual(t.set, [], "and Run now set no timer");
  t.stop.abort();
  t.db.close();
});

test("with dry-run off, Run now needs the owner's confirm of the PR and comment", async () => {
  const t = queueAlone(false);
  t.q.act({ action: "add", url: PR });
  await t.idle(); // Add reads the new PR at once (reads only)
  const before = t.gh.calls.length;
  assert.throws(() => t.q.act({ action: "run" }), /Confirm/);
  assert.equal(t.gh.calls.length, before, "refused before any read");
  t.q.act({ action: "refresh" });
  await t.idle();
  const v = (await t.rpc.reviewQueue!(null)) as QueueView;
  assert.deepEqual(v.next && [v.next.url, v.next.head, v.next.comment], [PR, "abc", TRIGGER], "the confirm names the PR, its head and the exact comment");
  assert.deepEqual(t.gh.writes(), [], "a refresh reads only");
  t.q.act({ action: "run", confirm: { url: PR, head: "abc" } });
  await t.idle();
  assert.equal(t.gh.writes().length, 1, "the confirmed run posts once");
  t.stop.abort();
  t.db.close();
});

test("with default settings no run ever starts a picker thread: refresh, a due tick and Run now are all deterministic", async () => {
  const t = queueAlone();
  t.q.act({ action: "add", url: PR });
  await t.idle();
  t.q.act({ action: "add", url: PR2 });
  await t.idle(); // two eligible PRs: the case the picker would rank
  t.q.act({ action: "refresh" });
  await t.idle();
  t.q.act({ action: "run" });
  await t.idle();
  t.q.store.mutate((s) => {
    s.config.enabled = true;
    s.nextAt = Date.now() - 1;
    s.wouldPost = null;
  });
  t.q.armTimer();
  t.pending()!();
  await t.idle();
  const v = (await t.rpc.reviewQueue!(null)) as QueueView;
  assert.equal(v.wouldPost?.url, PR, "the tick ran too, and picked the first PR in queue order");
  assert.deepEqual(t.threads.spawned, [], "no thread was spawned");
  assert.deepEqual(t.threads.models, [], "and no provider was even asked about its models");
  assert.equal(v.lastPicker, "Deterministic: pin, approval tier, then queue order");
  assert.deepEqual([v.config.pickerProvider, v.config.pickerModel, v.config.pickerProjectId], ["", "", ""], "the picker's settings start empty");
  t.stop.abort();
  t.db.close();
});

test("a configured picker runs in a personal folder on the queue's machine, its choice is used, and it is archived", async () => {
  const t = queueAlone();
  t.q.act({ action: "add", url: PR });
  await t.idle();
  t.q.act({ action: "add", url: PR2 });
  await t.idle();
  t.q.act({ action: "configure", config: { pickerProvider: "claude-code", pickerModel: "claude-haiku-5-5", pickerProjectId: "proj" } });
  t.q.act({ action: "run" });
  await t.idle();
  const v = (await t.rpc.reviewQueue!(null)) as QueueView;
  assert.equal(t.threads.spawned.length, 1, "one picker thread");
  const a = t.threads.spawned[0];
  assert.deepEqual(a.environment, { type: "host", hostId: "m1", workspace: { type: "personal" } }, "no worktree, no reused environment");
  assert.equal(a.permissionMode, "accept-edits", "bb's lowest permission mode");
  assert.equal(a.title, PICKER_TITLE);
  assert.deepEqual([a.providerId, a.model, a.projectId, a.parentNotifications], ["claude-code", "claude-haiku-5-5", "proj", "off"]);
  assert.ok(!a.prompt.includes("github.com") && !a.prompt.includes("A PR") && !a.prompt.includes("owner") && !a.prompt.includes("abc"), "no URL, title, login or head in the prompt");
  assert.deepEqual(t.threads.done, ["stop t1", "archive t1"], "stopped and archived after it picked");
  assert.equal(v.wouldPost?.url, PR2, "the model's choice (index 1) was the PR the dry run would ask");
  assert.match(v.lastPicker, /claude-code \/ claude-haiku-5-5/);
  assert.deepEqual(t.gh.writes(), [], "still a dry run: no write");
  assert.deepEqual(t.set, [], "and no timer: Schedule stays off");
  t.stop.abort();
  t.db.close();
});

test("a Schedule or Auto toggle keeps the picker's settings, and a picker save can't turn on Schedule or Auto", async () => {
  const t = queueAlone();
  t.q.act({ action: "configure", config: { pickerProvider: "claude-code", pickerModel: "m", pickerProjectId: "p" } });
  t.q.act({ action: "configure", config: { enabled: true } });
  t.q.act({ action: "configure", config: { auto: true } });
  assert.deepEqual(t.q.store.get().config, { enabled: true, auto: true, intervalMinutes: 65, hostId: "", pickerProvider: "claude-code", pickerModel: "m", pickerProjectId: "p" });
  t.q.act({ action: "configure", config: { enabled: false, auto: false } });
  t.q.act({ action: "configure", config: { pickerProvider: "" } });
  assert.deepEqual([t.q.store.get().config.enabled, t.q.store.get().config.auto], [false, false]);
  t.stop.abort();
  t.db.close();
});

test("the full server: dry-run defaults on, agents can only read the queue, and a default Run now writes nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "orch-rq-"));
  const file = join(root, "data.db");
  const raw = new DatabaseSync(file);
  const gh = fakeGh();
  const defined: Record<string, { default?: unknown }> = {};
  const rpc: Record<string, (input: unknown) => Promise<unknown>> = {};
  const routes = new Map<string, (c: any) => Promise<Response>>();
  const services = new Map<string, { start: (s: AbortSignal) => Promise<void> }>();
  const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : noop), apply: () => noop });
  const spawns: unknown[] = [];
  const threads = new Proxy({ spawn: async (a: unknown) => (spawns.push(a), { id: "t1" }) } as any, { get: (t, key) => (key in t ? t[key] : noop) });
  const sdk = { hosts: { list: async () => [machine] }, threads };
  const bb: any = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "pluginId") return "orchestrator";
        if (k === "settings")
          return {
            define: (schema: Record<string, { default: unknown }>) => {
              Object.assign(defined, schema);
              const v: any = Object.fromEntries(Object.entries(schema).map(([key, d]) => [key, d.default]));
              Object.assign(v, { stateDir: join(root, "state"), projectsDir: join(root, "projects"), memoryConfig: "", prPollMinutes: 0, dreamsEnabled: false, cloudConfigPath: join(root, "no-cloud.json") });
              return { get: async () => v, onChange: () => {} };
            },
          };
        if (k === "storage") return { database: () => Object.assign(raw, { name: file }), kv: noop };
        if (k === "hosts") return { experimental_client: () => gh.client };
        if (k === "rpc") return { register: (_c: unknown, handlers: typeof rpc) => Object.assign(rpc, handlers) };
        if (k === "http") return { route: (method: string, path: string, h: any) => routes.set(`${method} ${path}`, h) };
        if (k === "server") return { loopbackBaseUrl: "http://127.0.0.1:9", experimental_appUrl: null };
        if (k === "background") return { service: (n: string, s: any) => services.set(n, s), schedule: () => assert.fail("no cron schedules") };
        if (k === "sdk") return new Proxy(sdk, { get: (t: any, key) => (key in t ? t[key] : noop) });
        return noop;
      },
    },
  );
  await plugin(bb);
  assert.equal(defined.reviewQueueDryRun?.default, true, "dry-run is on by default");
  assert.ok(services.has("review-queue"), "the queue's timer is a service, armed only by Schedule");
  assert.ok(typeof rpc.reviewQueue === "function", "agents can read the queue");
  assert.deepEqual(
    Object.keys(rpc).filter((k) => /queue/i.test(k)),
    ["reviewQueue"],
    "and do nothing else: every change is a page-only write",
  );
  const post = async (body: unknown, origin = "http://127.0.0.1:9") => {
    const headers: Record<string, string> = { origin, "sec-fetch-site": "same-origin" };
    const c = {
      req: { url: `http://127.0.0.1:9/api/v1/plugins/orchestrator/http${REVIEW_QUEUE_WRITE}`, header: (n: string) => headers[n.toLowerCase()], json: async () => body },
      json: (b: unknown, status = 200) => new Response(JSON.stringify(b), { status }),
    };
    const r = await routes.get(`POST ${REVIEW_QUEUE_WRITE}`)!(c);
    return { status: r.status, body: (await r.json()) as { ok: boolean; error?: { message: string } } };
  };
  assert.equal((await post({ action: "configure", config: { enabled: true, auto: true, intervalMinutes: 65, hostId: "" } }, "http://evil.test")).status, 403, "not from the app's screens: refused");
  const v0 = (await rpc.reviewQueue!(null)) as QueueView;
  assert.deepEqual([v0.config.enabled, v0.config.auto, v0.dryRun], [false, false, true], "the refused write changed nothing");
  assert.equal((await post({ action: "add", url: PR })).body.ok, true);
  for (let i = 0; i < 200 && ((await rpc.reviewQueue!(null)) as QueueView).busy; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(((await rpc.reviewQueue!(null)) as QueueView).entries[0]?.facts, "Add read the new PR");
  assert.equal((await post({ action: "add", url: PR2 })).body.ok, true);
  for (let i = 0; i < 200 && ((await rpc.reviewQueue!(null)) as QueueView).busy; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal((await post({ action: "run" })).body.ok, true, "Run now with dry-run on needs no confirm");
  for (let i = 0; i < 200 && ((await rpc.reviewQueue!(null)) as QueueView).busy; i++) await new Promise((r) => setTimeout(r, 5));
  const v = (await rpc.reviewQueue!(null)) as QueueView;
  assert.equal(v.wouldPost?.url, PR, "it picked the PR and said what it would post");
  assert.deepEqual(gh.writes(), [], "and gh ran no write");
  assert.ok(gh.argv.length > 0, "it did read");
  assert.deepEqual(spawns, [], "with default settings, two eligible PRs and a Run now, no thread was spawned: the picker is off");
  assert.equal(v.lastPicker, "Deterministic: pin, approval tier, then queue order");
  raw.close();
  rmSync(root, { recursive: true, force: true });
});
