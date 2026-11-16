// The owner, 2026-11-16: "All of my agent sessions should not be clearing, they should be compacting, using Claude Code as
// their harness." The orchestrator cleared the CoS's whole context at 150k tokens; it now asks Claude Code to compact
// (bb's threads.compact, which sends /compact) and never calls clearContext on any role. These tests run the real
// server entry on a fake bb host whose clearContext throws, and scan the plugin's own code for any clear path.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import plugin, { retireClearSetting } from "../server.ts";
import { Engine } from "../core/engine.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

type Cli = (argv: string[], ctx: { threadId: string | null; cwd: string | null }) => Promise<{ exitCode: number; stdout: string }>;

/** The real plugin on a fake host with an idle CoS (T-cos) at `used` tokens, and stored settings `stored`. */
async function host(stored: Record<string, unknown>, used: number) {
  const root = mkdtempSync(join(tmpdir(), "orch-compact-"));
  roots.push(root);
  const db = Object.assign(new DatabaseSync(join(root, "data.db")), { name: join(root, "data.db") });
  new Engine(db as never, { now: Date.now, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} }).register("T-cos", "cos", null);
  const calls: string[] = [];
  const reading = { usedTokens: used, capturedAt: "2026-11-16T10:00:00.000Z" };
  const known: Record<string, (a: { threadId: string }) => Promise<unknown>> = {
    get: async ({ threadId }) => ({ id: threadId, projectId: "P1", environmentId: null, title: threadId, status: "idle", archivedAt: null }),
    context: async () => ({ usage: { usedTokens: reading.usedTokens, estimated: false, modelContextWindow: 1_000_000, snapshot: { capturedAt: reading.capturedAt, usedTokens: reading.usedTokens } } }),
    compact: async ({ threadId }) => (calls.push(`compact ${threadId}`), { ok: true }),
    clearContext: async ({ threadId }) => {
      calls.push(`clearContext ${threadId}`);
      throw new Error("the orchestrator must never clear a role's context");
    },
    updatePluginMetadata: async () => ({}),
  };
  const threads = new Proxy(known, { get: (t, k: string) => t[k] ?? (async () => ({})) });
  let cliRun: Cli | null = null;
  const logs: string[] = [];
  const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : noop), apply: () => noop });
  const bb: any = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "pluginId") return "orchestrator";
        if (k === "settings")
          return {
            // like bb: get() is the stored value, else the default; experimental_set writes, null unsets
            define: (schema: Record<string, { default?: unknown }>) => {
              const fixed = { stateDir: join(root, "state"), projectsDir: join(root, "projects"), memoryConfig: "", diskPath: root };
              const get = async () => {
                const v: any = {};
                for (const [key, d] of Object.entries(schema)) v[key] = Object.hasOwn(stored, key) ? stored[key] : key in fixed ? fixed[key as keyof typeof fixed] : d.default;
                return v;
              };
              return {
                get,
                onChange: () => {},
                experimental_set: async (vals: Record<string, unknown>) => {
                  for (const [key, val] of Object.entries(vals)) {
                    if (stored.__crashOn === key) {
                      delete stored.__crashOn;
                      throw new Error(`crash writing ${key}`);
                    }
                    if (val === null) delete stored[key];
                    else stored[key] = val;
                  }
                  return get();
                },
              };
            },
          };
        if (k === "storage") return { database: () => db, kv: noop };
        if (k === "agents") return { registerTool: () => {}, configure: () => {}, contributeInstructions: () => {} };
        if (k === "sdk") return { threads, plugins: noop, environments: noop, projects: noop };
        if (k === "cli") return { register: (c: { run: Cli }) => (cliRun = c.run) };
        if (k === "log") return { info: () => {}, warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
        return noop;
      },
    },
  );
  await plugin(bb);
  const cli = async (...argv: string[]) => (await cliRun!(argv, { threadId: null, cwd: null })).stdout.trim();
  const board = () => (db.prepare("SELECT title FROM board WHERE kind = 'notice' ORDER BY rowid").all() as { title: string }[]).map((r) => r.title);
  return { cli, calls, reading, stored, logs, board, reload: () => plugin(bb) };
}

test("above the threshold the idle CoS is compacted by Claude Code, never cleared, and a stale reading doesn't re-fire it", async () => {
  const h = await host({ cosCompactTokens: 350_000 }, 400_000);
  assert.match(await h.cli("compact-cos"), /requested compaction of the CoS's context at 400000 tokens/);
  assert.deepEqual(h.calls, ["compact T-cos"]);
  assert.ok(h.board().some((t) => /compact the CoS's context \(400000 tokens\)/.test(t)), "the Board says it compacted");
  // bb's reading still shows the old size until the CoS's next turn: one /compact, not one a minute
  assert.match(await h.cli("compact-cos"), /waiting for a new reading/);
  assert.deepEqual(h.calls, ["compact T-cos"]);
});

test("a fresh install leaves plugin compaction off and never clears, even at 900k tokens", async () => {
  const h = await host({}, 900_000);
  assert.match(await h.cli("compact-cos"), /compaction is off \(cosCompactTokens = 0\)/);
  assert.deepEqual(h.calls, [], "no compact and no clearContext: Claude Code's own auto-compaction handles it");
  assert.equal(Object.hasOwn(h.stored, "cosCompactTokens"), false, "nothing is written for it");
});

test("0 is off: no compaction even far above any threshold, and the reply says off, not 'under the threshold'", async () => {
  const h = await host({ cosCompactTokens: 0 }, 900_000);
  assert.match(await h.cli("compact-cos"), /compaction is off \(cosCompactTokens = 0\)/);
  assert.deepEqual(h.calls, []);
  // --force is the owner's manual path: it still compacts (and only compacts) while the automatic one is off
  assert.match(await h.cli("compact-cos", "--force"), /requested compaction/);
  assert.deepEqual(h.calls, ["compact T-cos"]);
});

// An upgrade must never switch plugin compaction on: the old clear threshold is unset, not carried over.
for (const old of [150_000, 0, undefined]) {
  test(`an upgrade from cosClearTokens = ${old ?? "unset"} leaves plugin compaction off, never clears, and drops the retired key`, async () => {
    const stored: Record<string, unknown> = old === undefined ? {} : { cosClearTokens: old };
    const h = await host(stored, 900_000);
    assert.equal(Object.hasOwn(stored, "cosClearTokens"), false, "the retired key is unset");
    assert.equal(Object.hasOwn(stored, "cosCompactTokens"), false, "no value is carried over to the new key");
    assert.match(await h.cli("compact-cos"), /compaction is off/);
    assert.deepEqual(h.calls, []);
  });
}

test("an upgrade keeps an owner's explicit cosCompactTokens and a failed unset never stops the load", async () => {
  const stored: Record<string, unknown> = { cosClearTokens: 150_000, cosCompactTokens: 300_000, __crashOn: "cosClearTokens" };
  const h = await host(stored, 400_000);
  assert.equal(stored.cosCompactTokens, 300_000, "the opt-in is untouched");
  assert.ok(h.logs.some((m) => /retired cosClearTokens/.test(m)), "the failure is logged, and the load goes on");
  await h.reload();
  assert.equal(Object.hasOwn(stored, "cosClearTokens"), false, "the next load finishes the unset");
  assert.equal(stored.cosCompactTokens, 300_000);
});

test("an explicit opt-in still compacts above its threshold, only compacts, and leaves a smaller CoS alone", async () => {
  const over = await host({ cosCompactTokens: 300_000 }, 400_000);
  assert.match(await over.cli("compact-cos"), /requested compaction of the CoS's context at 400000 tokens/);
  assert.deepEqual(over.calls, ["compact T-cos"], "compacts, never clearContext");
  const under = await host({ cosCompactTokens: 300_000 }, 200_000);
  assert.match(await under.cli("compact-cos"), /under the threshold/);
  assert.deepEqual(under.calls, []);
});

test("retireClearSetting only unsets the old key: no write to the new one", async () => {
  const stored: Record<string, unknown> = { cosClearTokens: 150_000 };
  await retireClearSetting({ get: async () => ({ cosClearTokens: stored.cosClearTokens as number | undefined }), experimental_set: async () => void delete stored.cosClearTokens }, () => {});
  assert.deepEqual(stored, {});
});

/** The plugin's own source: everything but tests, dependencies and build output. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "test", "dist", ".bb"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

test("no plugin code clears a role's context: no clearContext, no `bb thread clear`, no /clear sent", () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const hits: string[] = [];
  for (const f of sources(root))
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/clearContext|thread\/context\/clear|\bthread clear\b|["'`]\/clear\b/.test(line)) hits.push(`${relative(root, f)}:${i + 1}: ${line.trim()}`);
      });
  assert.deepEqual(hits, [], "a clear wipes the agent's context; use bb.sdk.threads.compact (Claude Code's /compact)");
});
