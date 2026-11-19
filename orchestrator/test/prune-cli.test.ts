// `bb orchestrator prune` from an agent (2026-11-19). The Steward's prune pass got "forbidden: not from an agent" even
// for a dry run, which only counts and deletes nothing. The owner's call: the Steward may run the dry run; a real prune
// stays off-limits to every agent, because it deletes the owner's record and already runs once a day under the owner's
// retention settings. The refusal says what an agent may run, so the Steward doesn't have to guess.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, type DeliverResult } from "../core/engine.ts";
import plugin, { pruneRefusal } from "../server.ts";

function agents() {
  const e = new Engine(new DatabaseSync(":memory:") as never, {
    now: () => Date.parse("2026-11-19T01:00:00Z"),
    deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }),
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  return {
    cos: e.register("T-cos", "cos", null),
    steward: e.register("T-steward", "steward", null),
    lead: e.register("T-lead", "lead", "alpha"),
    thread: e.register("T-thread", "thread", "alpha", "T-lead"),
  };
}

test("the Steward may run `prune --dry-run`: it only counts, so the Steward's prune pass can see what would go", () => {
  const s = agents();
  assert.equal(pruneRefusal(s.steward, true), null);
});

test("a real prune is refused for every agent, the Steward too, and the refusal names the one command an agent may run", () => {
  const s = agents();
  for (const a of [s.steward, s.cos, s.lead, s.thread]) {
    const why = pruneRefusal(a, false);
    assert.ok(why, `${a.address}: a real prune deletes the owner's record`);
    assert.match(why!, /bb orchestrator prune --dry-run/, `${a.address}: says what an agent may run`);
    assert.match(why!, /once a day/, `${a.address}: says the real prune already runs on its own`);
  }
});

test("only the Steward's dry run is opened: the CoS, a lead and a thread are refused it with the same words", () => {
  const s = agents();
  for (const a of [s.cos, s.lead, s.thread]) assert.match(pruneRefusal(a, true) ?? "", /only the Steward may run `bb orchestrator prune --dry-run`/, a.address);
});

test("the owner from a terminal (no agent) runs either", () => {
  assert.equal(pruneRefusal(null, true), null);
  assert.equal(pruneRefusal(null, false), null);
});

// The same rule through the real CLI entry (`bb orchestrator prune`), on a fake bb host: the caller is the agent whose
// bb thread runs the command. Before the fix the Steward's dry run got "forbidden: not from an agent".
test("through the CLI: the Steward's dry run counts and deletes nothing; its real prune and a thread's dry run are refused", async () => {
  const root = mkdtempSync(join(tmpdir(), "orch-prune-"));
  try {
    const db = Object.assign(new DatabaseSync(join(root, "data.db")), { name: join(root, "data.db") });
    const e = new Engine(db as never, { now: Date.now, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
    e.register("T-steward", "steward", null);
    e.register("T-lead", "lead", "alpha");
    e.register("T-thread", "thread", "alpha", "T-lead");
    type Cli = (argv: string[], ctx: { threadId: string | null; cwd: string | null }) => Promise<{ exitCode: number; stdout: string; stderr?: string }>;
    let cliRun: Cli | null = null;
    const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : noop), apply: () => noop });
    const threads = new Proxy({} as Record<string, unknown>, {
      get: (_t, k: string) => (k === "get" ? async ({ threadId }: { threadId: string }) => ({ id: threadId, projectId: "P1", environmentId: null, title: threadId, status: "idle", archivedAt: null }) : async () => ({})),
    });
    const bb: any = new Proxy(
      {},
      {
        get(_t, k) {
          if (k === "pluginId") return "orchestrator";
          if (k === "settings")
            return {
              define: (schema: Record<string, { default?: unknown }>) => {
                const fixed: Record<string, unknown> = { stateDir: join(root, "state"), projectsDir: join(root, "projects"), memoryConfig: "", diskPath: root };
                const get = async () => Object.fromEntries(Object.entries(schema).map(([key, d]) => [key, key in fixed ? fixed[key] : d.default]));
                return { get, onChange: () => {}, experimental_set: get };
              },
            };
          if (k === "storage") return { database: () => db, kv: noop };
          if (k === "agents") return { registerTool: () => {}, configure: () => {}, contributeInstructions: () => {} };
          if (k === "sdk") return { threads, plugins: noop, environments: noop, projects: noop };
          if (k === "cli") return { register: (c: { run: Cli }) => (cliRun = c.run) };
          if (k === "log") return { info: () => {}, warn: () => {}, error: () => {} };
          return noop;
        },
      },
    );
    await plugin(bb);
    const run = (threadId: string, ...argv: string[]) => cliRun!(argv, { threadId, cwd: null });

    const dry = await run("T-steward", "prune", "--dry-run");
    assert.equal(dry.exitCode, 0, dry.stderr);
    assert.match(dry.stdout, /^would delete: /);
    const real = await run("T-steward", "prune");
    assert.equal(real.exitCode, 1);
    assert.match(real.stderr ?? "", /the Steward may run only `bb orchestrator prune --dry-run`/);
    const thread = await run("T-thread", "prune", "--dry-run");
    assert.equal(thread.exitCode, 1);
    assert.match(thread.stderr ?? "", /only the Steward may run `bb orchestrator prune --dry-run`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
