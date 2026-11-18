// A batched wake goes when it comes due (2026-11-18, speed). It used to wait for the next flush: another tool call, a
// turn ending, or the clock's pass, which runs 5 s after the last one finished and waits behind pr-watch, xp and
// layout. Live that put the plugin's own share of a wake's delay at p90 10 s and up to 112 s. These tests load the real
// server entry against a fake bb host and run its clock service, as bb does.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../server.ts";
import { Engine } from "../core/engine.ts";

type Service = { start: (signal: AbortSignal) => Promise<void> };
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake bb host whose threads are all idle; it records each wake bb is asked to send, and when. A wake for
 *  queuedThread is queued behind its turn (bb keeps the queued row), as for a busy thread. */
function host(debounceMs: number, slowThread: string | null = null, slowMs = 0, queuedThread: string | null = null) {
  const root = mkdtempSync(join(tmpdir(), "orch-wake-"));
  roots.push(root);
  mkdirSync(join(root, "projects"));
  const db = Object.assign(new DatabaseSync(join(root, "data.db")), { name: join(root, "data.db") });
  const wakes: { threadId: string; at: number }[] = [];
  const services = new Map<string, Service>();
  const tools: Record<string, { execute: (p: unknown, ctx: { threadId: string }) => Promise<unknown> }> = {};
  const sdk = (path: string[]): any =>
    new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? undefined : sdk([...path, String(k)])),
      apply: (_t, _this, args: any[]) => {
        const p = path.join(".");
        if (p === "threads.send") {
          if (JSON.stringify(args[0]?.input).includes("Inbox wake")) wakes.push({ threadId: args[0].threadId, at: Date.now() });
          if (args[0]?.threadId === queuedThread) return Promise.resolve({ delivery: "queued", queuedMessage: { id: "queued-1" } });
          return args[0]?.threadId === slowThread ? sleep(slowMs).then(() => ({ delivery: "sent" })) : Promise.resolve({ delivery: "sent" });
        }
        if (p === "threads.get") return Promise.resolve({ status: "idle", archivedAt: null });
        if (p === "threads.queuedMessages.list") return Promise.resolve(args[0]?.threadId === queuedThread ? [{ id: "queued-1" }] : []);
        if (/\.list$/.test(p)) return Promise.resolve([]);
        return Promise.resolve({});
      },
    });
  const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : noop), apply: () => noop });
  const bb: any = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "pluginId") return "orchestrator";
        if (k === "settings")
          return {
            define: (schema: Record<string, { default: unknown }>) => {
              const v: any = Object.fromEntries(Object.entries(schema).map(([key, d]) => [key, d.default]));
              Object.assign(v, { stateDir: join(root, "state"), projectsDir: join(root, "projects"), memoryConfig: "", diskPath: root, batchInbox: true, inboxDebounceMs: debounceMs, prPollMinutes: 0 });
              return { get: async () => v, onChange: () => {} };
            },
          };
        if (k === "storage") return { database: () => db, kv: { get: async () => null, set: async () => {}, delete: async () => {} } };
        if (k === "sdk") return sdk([]);
        if (k === "agents") return new Proxy({ registerTool: (t: any) => (tools[t.name] = t) } as any, { get: (o, kk) => o[kk] ?? (() => {}) });
        if (k === "background") return { service: (name: string, s: Service) => services.set(name, s) };
        if (k === "log") return { info: () => {}, warn: () => {}, error: () => {} };
        return noop;
      },
    },
  );
  return { bb, db, wakes, services, tools };
}

test("a lead's message wakes an idle CoS when its debounce ends, not at the next clock pass", async () => {
  const h = host(300);
  const e = new Engine(h.db as never, { now: Date.now, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-lead", "lead", "demo");
  await plugin(h.bb);
  const stop = new AbortController();
  const clock = h.services.get("clock")!.start(stop.signal);
  try {
    await sleep(300); // the clock's first pass: reconcile, flush, then it sleeps 5 s
    const t0 = Date.now();
    await h.tools.orch_send!.execute({ to: "cos", text: "the plan is ready", severity: "ACTION" }, { threadId: lead.threadId });
    await sleep(1500);
    const wake = h.wakes.find((w) => w.threadId === cos.threadId);
    assert.ok(wake, "the wake went within 1.5 s, with no tool call or clock pass to carry it");
    assert.ok(wake!.at - t0 >= 300, "and not before its debounce");
  } finally {
    stop.abort();
    await clock;
  }
});

test("the wake timer stops with the clock service", async () => {
  const h = host(500);
  const e = new Engine(h.db as never, { now: Date.now, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-lead", "lead", "demo");
  await plugin(h.bb);
  const stop = new AbortController();
  const clock = h.services.get("clock")!.start(stop.signal);
  await sleep(300);
  await h.tools.orch_send!.execute({ to: "cos", text: "the plan is ready", severity: "ACTION" }, { threadId: lead.threadId });
  await sleep(50);
  // bb stops the services before it closes the database: an armed timer must not flush after that
  stop.abort();
  await clock;
  await sleep(800);
  assert.equal(h.wakes.filter((w) => w.threadId === cos.threadId).length, 0);
});

test("mail that arrives while a flush waits on a slow delivery is woken when that flush ends, not at the next clock pass", async () => {
  // a tool call's flush that finds one in flight was dropped; that flush had read its recipients before the mail came
  const h = host(300, "T-a", 2000);
  const e = new Engine(h.db as never, { now: Date.now, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const cos = e.register("T-cos", "cos", null);
  e.register("T-a", "lead", "alpha");
  const b = e.register("T-b", "lead", "beta");
  await plugin(h.bb);
  const stop = new AbortController();
  const clock = h.services.get("clock")!.start(stop.signal);
  try {
    await sleep(300);
    await h.tools.orch_send!.execute({ to: "lead:alpha", text: "for a", severity: "ACTION" }, { threadId: cos.threadId });
    await sleep(500); // a's wake is on its way (2 s)
    const t0 = Date.now();
    await h.tools.orch_send!.execute({ to: b.address, text: "for b", severity: "ACTION" }, { threadId: cos.threadId });
    for (let i = 0; i < 100 && !h.wakes.some((w) => w.threadId === b.threadId); i++) await sleep(100);
    const wake = h.wakes.find((w) => w.threadId === b.threadId);
    assert.ok(wake, "b is woken");
    // a's delivery ends about 1.5 s after b's mail; b's debounce is 0.3 s more. The next clock pass was 5 s on.
    assert.ok(wake!.at - t0 < 2800, `b's wake went ${wake!.at - t0} ms after its mail`);
  } finally {
    stop.abort();
    await clock;
  }
});

test("the wake timer, tool-call flushes and re-runs together wake each recipient once", async () => {
  // the lead's guardrail for the timer and the re-run: no lost wake, and no double delivery when they overlap
  const h = host(300, "T-a", 1000);
  const e = new Engine(h.db as never, { now: Date.now, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const cos = e.register("T-cos", "cos", null);
  const a = e.register("T-a", "lead", "alpha");
  const b = e.register("T-b", "lead", "beta");
  await plugin(h.bb);
  const stop = new AbortController();
  const clock = h.services.get("clock")!.start(stop.signal);
  try {
    await sleep(300);
    await h.tools.orch_send!.execute({ to: "lead:alpha", text: "for a", severity: "ACTION" }, { threadId: cos.threadId });
    await h.tools.orch_send!.execute({ to: b.address, text: "for b", severity: "ACTION" }, { threadId: cos.threadId });
    // a tool call every 50 ms for 2.5 s: flushes before, at and after the debounce, and during a's 1 s delivery
    for (let i = 0; i < 50; i++) {
      void h.tools.orch_inbox!.execute({}, { threadId: cos.threadId });
      await sleep(50);
    }
    const woken = (x: { threadId: string }) => h.wakes.filter((w) => w.threadId === x.threadId).length;
    for (let i = 0; i < 100 && !(woken(a) && woken(b)); i++) await sleep(100); // a loaded host can be slow to fire
    await sleep(1000);
    assert.equal(h.wakes.filter((w) => w.threadId === a.threadId).length, 1, "a is woken once");
    assert.equal(h.wakes.filter((w) => w.threadId === b.threadId).length, 1, "b is woken once");
  } finally {
    stop.abort();
    await clock;
  }
});

test("a recipient whose wake is sent or queued gets no second wake when the timer fires for other mail", async () => {
  // the lead's case: new mail for a recipient already woken (sent, or queued behind a busy turn) rides on that wake
  const h = host(300, null, 0, "T-q");
  const e = new Engine(h.db as never, { now: Date.now, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const cos = e.register("T-cos", "cos", null);
  const a = e.register("T-a", "lead", "alpha");
  const q = e.register("T-q", "lead", "queued");
  const b = e.register("T-b", "lead", "beta");
  await plugin(h.bb);
  const stop = new AbortController();
  const clock = h.services.get("clock")!.start(stop.signal);
  try {
    await sleep(300);
    for (const to of [a, q]) await h.tools.orch_send!.execute({ to: to.address, text: "first", severity: "ACTION" }, { threadId: cos.threadId });
    const woken = (x: { threadId: string }) => h.wakes.filter((w) => w.threadId === x.threadId).length;
    for (let i = 0; i < 100 && !(woken(a) && woken(q)); i++) await sleep(100); // a loaded host can be slow to fire
    await sleep(300);
    assert.deepEqual([a, q].map((x) => h.wakes.filter((w) => w.threadId === x.threadId).length), [1, 1], "a (sent) and q (queued) are woken once");
    const states = Object.fromEntries((h.db.prepare(`SELECT recipient, state FROM inbox_wakes`).all() as { recipient: string; state: string }[]).map((r) => [r.recipient, r.state]));
    assert.equal(states[a.address], "sent");
    assert.equal(states[q.address], "queued");
    // more mail for a and q, unread, and mail for b, whose wake arms the timer; tool calls flush throughout
    for (const to of [a, q, b]) await h.tools.orch_send!.execute({ to: to.address, text: "second", severity: "ACTION" }, { threadId: cos.threadId });
    for (let i = 0; i < 30; i++) {
      void h.tools.orch_inbox!.execute({}, { threadId: cos.threadId });
      await sleep(50);
    }
    for (let i = 0; i < 100 && !woken(b); i++) await sleep(100);
    await sleep(500);
    assert.equal(h.wakes.filter((w) => w.threadId === b.threadId).length, 1, "the timer fired: b is woken");
    assert.equal(h.wakes.filter((w) => w.threadId === a.threadId).length, 1, "a's sent wake is not sent again");
    assert.equal(h.wakes.filter((w) => w.threadId === q.threadId).length, 1, "q's queued wake is not sent again");
  } finally {
    stop.abort();
    await clock;
  }
});
