// The nav badge re-reads needsYou on every change notice, in every open bb client (2026-11-18, speed). It asks bb for
// each live agent's pending interactions; one after another, that was a bb round trip per agent (58 live agents) on
// every read. All 58 at once was no faster, and bb was timing out under load, so it asks 8 at a time. This loads the
// real server entry against a fake bb host whose calls each take 100 ms.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../server.ts";
import { Engine } from "../core/engine.ts";

const root = mkdtempSync(join(tmpdir(), "orch-rpc-speed-"));
after(() => rmSync(root, { recursive: true, force: true }));

test("needsYou asks bb about 8 agents at a time, and keeps the agents' order", async () => {
  mkdirSync(join(root, "projects"));
  const db = Object.assign(new DatabaseSync(join(root, "data.db")), { name: join(root, "data.db") });
  const e = new Engine(db as never, { now: Date.now, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const agents = Array.from({ length: 20 }, (_, i) => e.register(`T-${i}`, "lead", `p${i}`));
  let inFlight = 0;
  let most = 0;
  const later = <T>(v: T) => {
    most = Math.max(most, ++inFlight);
    return new Promise<T>((r) => setTimeout(() => (inFlight--, r(v)), 100));
  };
  const sdk = (path: string[]): any =>
    new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? undefined : sdk([...path, String(k)])),
      apply: (_t, _this, args: any[]) => {
        const p = path.join(".");
        // every other agent has one question waiting
        if (p === "threads.interactions.list") return later(Number(args[0].threadId.slice(2)) % 2 ? [] : [{ id: `q-${args[0].threadId}`, status: "pending", kind: "prompt" }]);
        if (p === "threads.get") return later({ title: `title ${args[0].threadId}` });
        return later({});
      },
    });
  const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : noop), apply: () => noop });
  const rpc: Record<string, (input: unknown) => Promise<{ interactions: { threadId: string }[] }>> = {};
  const bb: any = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "pluginId") return "orchestrator";
        if (k === "settings")
          return {
            define: (schema: Record<string, { default: unknown }>) => {
              const v: any = Object.fromEntries(Object.entries(schema).map(([key, d]) => [key, d.default]));
              Object.assign(v, { stateDir: join(root, "state"), projectsDir: join(root, "projects"), memoryConfig: "", diskPath: root });
              return { get: async () => v, onChange: () => {} };
            },
          };
        if (k === "storage") return { database: () => db, kv: noop };
        if (k === "sdk") return sdk([]);
        if (k === "rpc") return { register: (_c: unknown, h: typeof rpc) => Object.assign(rpc, h) };
        if (k === "log") return { info: () => {}, warn: () => {}, error: () => {} };
        return noop;
      },
    },
  );
  await plugin(bb);
  const t0 = Date.now();
  const out = await rpc.needsYou!({ zone: "UTC" });
  const ms = Date.now() - t0;
  assert.deepEqual(out.interactions.map((x) => x.threadId), agents.filter((_, i) => i % 2 === 0).map((a) => a.threadId));
  assert.ok(most <= 8, `at most 8 bb calls in flight, saw ${most}`);
  assert.ok(most >= 4, `and not one after another, saw ${most}`);
  // 20 agents, 100 ms per bb call: one after another is 3 s (20 lists, 10 titles); 8 at a time is about 0.5 s
  assert.ok(ms < 1500, `needsYou took ${ms} ms`);
});
