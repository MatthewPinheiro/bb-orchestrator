// The Watchers list (2026-11-17): every open PR wait and every timed job. The owner (the Board's routes) and the CoS
// (orch_watch) may retarget, move, drop and add any PR wait, for anyone, and the wait's owners always hear of it: a
// wait that moves silently is a promise nobody knows they hold. Leads and threads keep only orch_ack's own-wait moves.
// Intervals are the owner's settings: the CoS lists jobs and can't change one, and the page shows the exact command.
// These tests load the real server entry against a fake bb host, so the tool and the routes run the real wiring.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import plugin from "../server.ts";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { WRITES, type Board } from "../contract.ts";
import { JOBS, jobRefusal, jobsView, settingCommand, watchText, type JobSettings } from "../core/watchers.ts";
import { parseWaitReading } from "../core/open-prs.ts";

const SCRATCH = join(import.meta.dirname, "..", ".scratch-test");
mkdirSync(SCRATCH, { recursive: true });
const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const PR = "https://github.com/acme-co/widgets/pull/7";
const PR2 = "https://github.com/acme-co/widgets/pull/8";
const OTHER = "https://github.com/other-org/gadgets/pull/42";

type Tool = { name: string; parameters: z.ZodTypeAny; execute(p: unknown, ctx: { threadId: string }): Promise<{ content: { text: string }[]; isError?: boolean }> };
type Route = (c: unknown) => Promise<Response>;

/** The real server against a fake bb; its settings record every write (none may come from the CoS). */
async function server() {
  const root = mkdtempSync(join(SCRATCH, "watchers-"));
  roots.push(root);
  const db = Object.assign(new DatabaseSync(join(root, "data.db")), { name: join(root, "data.db") });
  const tools = new Map<string, Tool>();
  const routes = new Map<string, Route>();
  const rpc: Record<string, (input: unknown) => unknown> = {};
  const settingWrites: unknown[] = [];
  let configure: (c: unknown) => { tools: string[] } = () => ({ tools: [] });
  let values: Record<string, unknown> = {};
  const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : noop), apply: () => noop });
  const sdk = {
    hosts: { list: async () => [] },
    threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, status: "idle", archivedAt: null }), send: async () => ({ delivery: "sent" }), queuedMessages: { list: async () => [] }, list: async () => [] },
  };
  const bb: any = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "pluginId") return "orchestrator";
        if (k === "settings")
          return {
            define: (schema: Record<string, { default: unknown }>) => {
              const v: Record<string, unknown> = Object.fromEntries(Object.entries(schema).map(([key, d]) => [key, d.default]));
              Object.assign(v, { stateDir: join(root, "state"), projectsDir: join(root, "projects"), memoryConfig: "", diskPath: root, ownerName: "" });
              if ("prPollMinutes" in schema) values = v;
              return { get: async () => v, onChange: () => {}, experimental_set: async (w: unknown) => void settingWrites.push(w) };
            },
          };
        if (k === "storage") return { database: () => db, kv: noop };
        if (k === "agents") return new Proxy({ registerTool: (t: Tool) => tools.set(t.name, t), configure: (f: any) => (configure = f) }, { get: (a: any, n) => a[n] ?? noop });
        if (k === "rpc") return { register: (_c: unknown, h: Record<string, (i: unknown) => unknown>) => Object.assign(rpc, h) };
        if (k === "http") return { route: (_m: string, path: string, h: Route) => routes.set(path, h) };
        if (k === "sdk") return new Proxy(sdk, { get: (s: any, n) => s[n] ?? noop });
        if (k === "background") return { service: () => {} };
        if (k === "log") return { info: () => {}, warn: () => {}, error: () => {} };
        return noop;
      },
    },
  );
  await plugin(bb);
  const engine = new Engine(db as never, { now: () => Date.now(), deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} }, {});
  /** An agent's tool call, its raw arguments parsed by the tool's own schema as bb does. */
  const call = async (name: string, raw: unknown, threadId: string) => {
    const t = tools.get(name)!;
    const r = await t.execute(t.parameters.parse(raw), { threadId });
    return { ok: !r.isError, text: r.content[0]!.text };
  };
  /** The owner's click on the Board: a POST from the app's own screen. */
  const click = async (path: string, body: unknown, headers: Record<string, string> = { origin: "http://app.test", "sec-fetch-site": "same-origin" }) => {
    const c = {
      req: { url: "http://app.test/x", header: (n: string) => headers[n.toLowerCase()], json: async () => body },
      json: (b: unknown, status = 200) => new Response(JSON.stringify(b), { status }),
    };
    return (await (await routes.get(path)!(c)).json()) as { ok: boolean; result?: string; error?: { kind: string; message: string } };
  };
  const board = () => rpc.board!(null) as Board;
  const toolsOf = (threadId: string) => configure({ thread: { id: threadId }, pluginMetadata: {}, origin: { pluginId: "other" }, project: { name: "p" }, environment: { path: root } }).tools;
  return { engine, db, tools, call, click, board, settingWrites, values: () => values, toolsOf };
}

/** Agents and one open wait: lead:alpha's ack of the CoS's message, bound to PR until approved. */
async function withWait() {
  const s = await server();
  const cos = s.engine.register("T-cos", "cos", null);
  const alpha = s.engine.register("T-alpha", "lead", "alpha");
  const beta = s.engine.register("T-beta", "lead", "beta");
  const worker = s.engine.register("T-w1", "thread", "alpha", "T-alpha");
  const it = s.engine.send(cos, alpha.address, "Merge it once it is approved.", null, null);
  s.engine.ack(alpha, it.id, "done", null, { pr: PR, when: "approved" });
  const [w] = s.engine.openWaits();
  /** The one-line notices each address got about wait `id`. */
  // oldest first, in the order they were written
  const told = (to: string, id: string) => (s.db.prepare(`SELECT body FROM items WHERE recipient = ? AND kind = 'notice' AND instr(body, ?) > 0 ORDER BY rowid`).all(to, id) as { body: string }[]).map((r) => r.body);
  const logged = (id: string) => (s.db.prepare(`SELECT title FROM board WHERE ref = ? ORDER BY rowid`).all(id) as { title: string }[]).map((r) => r.title);
  return { ...s, cos, alpha, beta, worker, it, w: w!, told, logged };
}

const waitRow = (s: { db: DatabaseSync }, id: string) => ({ ...(s.db.prepare(`SELECT owner, pr_url AS url, cond, outcome FROM waits WHERE id = ?`).get(id) as { owner: string; url: string; cond: string; outcome: string | null }) });

// ---------------------------------------------------------------- who may change a wait

test("the owner retargets, moves and drops anyone's wait from the Board; each owner hears it in one line and the Board logs it", async () => {
  const s = await withWait();
  const re = await s.click(WRITES.watchRetarget, { id: s.w.id, pr: PR2, when: "green" });
  assert.equal(re.ok, true, re.error?.message);
  assert.deepEqual(waitRow(s, s.w.id), { owner: "lead:alpha", url: PR2, cond: "green", outcome: null });
  assert.deepEqual(s.told("lead:alpha", s.w.id), [`The owner retargeted your PR wait ${s.w.id} (${s.it.id}): now until ${PR2} green (checks passing), was ${PR} approved.`]);

  const mv = await s.click(WRITES.watchMove, { id: s.w.id, to: "lead:beta" });
  assert.equal(mv.ok, true, mv.error?.message);
  assert.equal(waitRow(s, s.w.id).owner, "lead:beta");
  assert.match(s.told("lead:alpha", s.w.id)[1]!, /^The owner moved your PR wait .* to lead:beta\.$/, "the old owner knows it no longer holds it");
  assert.match(s.told("lead:beta", s.w.id)[0]!, /^The owner gave you PR wait .* from lead:alpha: once .* you get back .*Merge it once it is approved/, "the new owner knows what it now holds");

  const dr = await s.click(WRITES.watchDrop, { id: s.w.id });
  assert.equal(dr.ok, true, dr.error?.message);
  assert.equal(waitRow(s, s.w.id).outcome, "dropped");
  assert.match(s.told("lead:beta", s.w.id)[1]!, /^The owner dropped your PR wait .*nothing comes back for it\.$/);
  for (const n of [...s.told("lead:alpha", s.w.id), ...s.told("lead:beta", s.w.id)]) assert.ok(!n.includes("\n"), "one line each");
  assert.deepEqual(s.logged(s.w.id).map((t) => t.split(" PR wait")[0]), ["The owner retargeted", "The owner moved", "The owner dropped"]);
  assert.equal((await s.click(WRITES.watchDrop, { id: s.w.id })).error?.kind, "bad_state", "a closed wait stays closed");
});

test("the CoS retargets, moves and drops any wait with orch_watch, and owners are told the same way", async () => {
  const s = await withWait();
  assert.match((await s.call("orch_watch", { action: "retarget", id: s.w.id, when: "merged" }, "T-cos")).text, new RegExp(`${s.w.id} now waits until ${PR} merged`));
  assert.match(s.told("lead:alpha", s.w.id)[0]!, /^The CoS retargeted your PR wait/);
  assert.match((await s.call("orch_watch", { action: "move", id: s.w.id, to: "thread:alpha:1" }, "T-cos")).text, /moved from lead:alpha to thread:alpha:1/);
  assert.match(s.told("lead:alpha", s.w.id)[1]!, /^The CoS moved your PR wait/);
  assert.match(s.told("thread:alpha:1", s.w.id)[0]!, /^The CoS gave you PR wait/);
  assert.match((await s.call("orch_watch", { action: "drop", id: s.w.id }, "T-cos")).text, /dropped/);
  assert.match(s.told("thread:alpha:1", s.w.id)[1]!, /^The CoS dropped your PR wait/);
  assert.deepEqual(s.logged(s.w.id).map((t) => t.split(" PR wait")[0]), ["The CoS retargeted", "The CoS moved", "The CoS dropped"]);
});

test("a PR wait added for any agent comes back to it as work once the PR is there; a retarget to a PR already there fires at once", async () => {
  const s = await withWait();
  const add = await s.call("orch_watch", { action: "add", to: "lead:beta", pr: OTHER, when: "approved", note: "tell the docs team" }, "T-cos");
  assert.ok(add.ok, add.text);
  const id = /PR wait (w-[0-9a-f]+)/.exec(add.text)![1]!;
  assert.match(s.told("lead:beta", id)[0]!, /^The CoS added a PR wait for you .* carry out "tell the docs team"/);
  s.engine.waitPrSeen(parseWaitReading({ url: OTHER, number: 42, state: "OPEN", isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [], mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" }));
  const back = s.engine.items(500).filter((i) => i.recipient === "lead:beta" && i.kind === "message" && i.sender === "orchestrator");
  assert.equal(back.length, 1);
  assert.match(back[0]!.body, /PR #42 is approved.*PR wait w-[0-9a-f]+ was set on it.*The CoS's note: "tell the docs team"\. Carry it out now/);
  assert.equal(back[0]!.needsAck, true, "it is work: unacked, it is resent like any message");
  // lead:alpha's wait, retargeted to that approved PR, goes back at once
  const re = await s.click(WRITES.watchRetarget, { id: s.w.id, pr: OTHER });
  assert.match(re.result!, /it is there already, so it went to lead:alpha at once/);
  assert.equal(waitRow(s, s.w.id).outcome, "met");
});

test("a wait goes only to a live agent, and to a real PR: bad input changes nothing", async () => {
  const s = await withWait();
  assert.equal((await s.click(WRITES.watchMove, { id: s.w.id, to: "lead:nobody" })).error?.kind, "invalid");
  assert.equal((await s.click(WRITES.watchAdd, { to: "lead:nobody", pr: OTHER, when: "merged", note: "x" })).error?.kind, "invalid");
  assert.equal((await s.click(WRITES.watchRetarget, { id: s.w.id, pr: "not a url" })).error?.kind, "invalid");
  assert.equal((await s.click(WRITES.watchRetarget, { id: "w-nope", when: "merged" })).error?.kind, "not_found");
  assert.match((await s.call("orch_watch", { action: "add", to: "lead:beta", pr: OTHER }, "T-cos")).text, /^invalid: add needs to, pr, when and note/);
  assert.deepEqual(waitRow(s, s.w.id), { owner: "lead:alpha", url: PR, cond: "approved", outcome: null });
  assert.equal(s.engine.openWaits().length, 1);
});

test("a lead or a thread calling orch_watch is refused, only the CoS has the tool, and the owner's routes take only the app's screens; own waits still move with orch_ack", async () => {
  const s = await withWait();
  for (const t of ["T-alpha", "T-w1"]) {
    for (const args of [{}, { action: "drop", id: s.w.id }, { action: "move", id: s.w.id, to: "lead:beta" }, { action: "add", to: "lead:beta", pr: OTHER, when: "merged", note: "x" }]) {
      assert.deepEqual(await s.call("orch_watch", args, t), { ok: false, text: "forbidden: CoS only" }, `${t} ${JSON.stringify(args)}`);
    }
  }
  // the owner's routes act as the owner, so they take only the app's own screens: an agent's direct POST is refused
  for (const [path, body] of [[WRITES.watchDrop, { id: s.w.id }], [WRITES.watchMove, { id: s.w.id, to: "lead:beta" }], [WRITES.watchRetarget, { id: s.w.id, when: "merged" }], [WRITES.watchAdd, { to: "lead:beta", pr: OTHER, when: "merged", note: "x" }]] as const) {
    for (const headers of [{}, { origin: "http://elsewhere.test", "sec-fetch-site": "cross-site" }] as Record<string, string>[]) assert.equal((await s.click(path, body, headers)).error?.kind, "forbidden", `${path} ${JSON.stringify(headers)}`);
  }
  assert.deepEqual(waitRow(s, s.w.id), { owner: "lead:alpha", url: PR, cond: "approved", outcome: null }, "nothing changed");
  assert.equal(s.engine.openWaits().length, 1);
  assert.throws(() => s.engine.watchDrop(s.alpha, s.w.id), /only the CoS .* and the owner/, "the engine refuses a lead too, whatever calls it");
  assert.ok(s.toolsOf("T-cos").includes("orch_watch"));
  assert.ok(!s.toolsOf("T-alpha").includes("orch_watch") && !s.toolsOf("T-w1").includes("orch_watch"), "leads and threads aren't given it");
  // bb turns the parameters into JSON Schema; every one is optional, so a partial call reaches the tool's own refusal
  const js = z.toJSONSchema(s.tools.get("orch_watch")!.parameters as never, { io: "input" }) as { required?: string[]; properties: Record<string, unknown> };
  assert.deepEqual(js.required ?? [], []);
  // and the own-wait rule of orch_ack is untouched: lead:beta can't move lead:alpha's wait with an ack
  assert.match((await s.call("orch_ack", { id: s.it.id, outcome: "done", pr: OTHER, when: "merged" }, "T-beta")).text, /forbidden|not you/);
  assert.equal(waitRow(s, s.w.id).owner, "lead:alpha");
});

// ---------------------------------------------------------------- intervals are the owner's

test("the CoS can't change an interval: orch_watch has no interval parameter, a job id is refused, and no setting is written", async () => {
  const s = await withWait();
  const props = Object.keys((z.toJSONSchema(s.tools.get("orch_watch")!.parameters as never, { io: "input" }) as { properties: Record<string, unknown> }).properties);
  assert.deepEqual(props.sort(), ["action", "id", "note", "pr", "to", "when"], "nothing that sets an interval");
  const before = { ...s.values() };
  for (const action of ["retarget", "move", "drop"]) {
    const r = await s.call("orch_watch", { action, id: "pr-watch", pr: OTHER, when: "merged", to: "lead:beta" }, "T-cos");
    assert.equal(r.ok, false);
    assert.match(r.text, /^forbidden: pr-watch is a timed job .* the owner's setting prPollMinutes, which only the owner changes .*orch_watch only lists jobs/);
  }
  assert.match((await s.call("orch_watch", { action: "drop", id: "tick" }, "T-cos")).text, /^forbidden: tick is a timed job with a fixed interval/);
  // extra keys an agent might send are dropped by the schema, never acted on
  await s.call("orch_watch", { action: "list", prPollMinutes: 1, sampleSeconds: 5, interval: 1 }, "T-cos");
  assert.deepEqual(s.settingWrites, [], "no settings write, ever");
  assert.deepEqual(s.values(), before);
  const list = (await s.call("orch_watch", {}, "T-cos")).text;
  assert.match(list, /Timed jobs \(\d+\), list only: intervals are the owner's settings/);
  assert.match(list, new RegExp(`- ${s.w.id} lead:alpha: ${s.it.id} until ${PR} is approved`));
});

// ---------------------------------------------------------------- the list

const CFG: JobSettings = { prPollMinutes: 5, escalateMinutes: 5, resendMinutes: 10, sampleSeconds: 60, sustainSeconds: 300, retentionDays: 0, activityRetentionDays: 0, cosCompactTokens: 0 };

test("each job shows its setting's interval or 'fixed', its last and next run, and the owner's exact command", () => {
  const t = Date.parse("2026-11-17T12:00:00Z");
  const jobs = jobsView(CFG, { "pr-watch": t - 60_000, tick: t - 2000, sampler: t - 10_000 });
  const by = Object.fromEntries(jobs.map((j) => [j.id, j]));
  assert.deepEqual(jobs.map((j) => j.id), JOBS.map((j) => j.id), "every job, in order");
  assert.deepEqual([by["pr-watch"]!.interval, by["pr-watch"]!.last, by["pr-watch"]!.next, by["pr-watch"]!.command], ["every 5 min", t - 60_000, t + 4 * 60_000, "bb plugin config orchestrator set prPollMinutes 5"]);
  assert.deepEqual([by.escalate!.interval, by.escalate!.next], ["after 5 min", t + 3000], "checked on each tick");
  assert.deepEqual([by.alarm!.interval, by.alarm!.setting, by.alarm!.next], ["after 5 min", "sustainSeconds", t + 50_000], "the alarm hold is checked on each sample");
  assert.deepEqual([by.tick!.interval, by.tick!.setting, by.tick!.command], ["every 5 s, fixed", null, null], "fixed: read-only");
  assert.deepEqual([by.xp!.last, by.xp!.next], [null, null], "never run since the reload: no next to guess");
  assert.equal(by.retention!.off, true, "no retention days: off");
  const off = Object.fromEntries(jobsView({ ...CFG, prPollMinutes: 0 }, { "pr-watch": t }).map((j) => [j.id, j]));
  assert.deepEqual([off["pr-watch"]!.interval, off["pr-watch"]!.next], ["off", null], "0 = never");
  assert.equal(settingCommand("sampleSeconds", 30), "bb plugin config orchestrator set sampleSeconds 30");
  assert.match(jobRefusal("sampler", CFG), /sampleSeconds/);
  assert.match(watchText([], jobs, t), /^No open PR waits\.\nTimed jobs/);
});

test("the Board read lists each open wait with whose it is, its PR, condition, age and its last reading and where from", async () => {
  const s = await withWait();
  s.engine.waitPrSeen(parseWaitReading({ url: PR, number: 7, state: "OPEN", isDraft: false, reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }], mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" }));
  const w = s.board().watchers!;
  assert.equal(w.waits.length, 1);
  assert.deepEqual({ ...w.waits[0]!, createdAt: 0, reading: { ...w.waits[0]!.reading!, changedAt: 0, readAt: 0 } }, {
    id: s.w.id, owner: "lead:alpha", ownerLive: true, ref: s.it.id, about: w.waits[0]!.about, prUrl: PR, when: "approved", createdAt: 0,
    reading: { state: "open", checks: "passing", review: "review_required", attention: "blocked", source: "gh", changedAt: 0, readAt: 0 },
  });
  assert.deepEqual(w.conditions, ["approved", "green", "ready", "merged"]);
  assert.ok(w.jobs.some((j) => j.id === "pr-watch" && j.setting === "prPollMinutes"));
});
