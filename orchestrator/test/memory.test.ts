// Which orchestrator agents reach the memory engine, and what they are told (core/memory.ts; docs/memory-port.md gaps
// 1, 3 and 4). Temp folders live under the repo's ignored .scratch, never /tmp (a RAM tmpfs on the runner).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { configEnvName, liveProjects, loadMemory, memoryConfigPath, memoryProjects, memorySetup, searchArgv, TOOL_PAGE, TOOL_SEARCH } from "../core/memory.ts";

const TMP = join(import.meta.dirname, "..", "..", ".scratch", "test-tmp");

function world() {
  mkdirSync(TMP, { recursive: true });
  const root = mkdtempSync(join(TMP, "mem-"));
  const a = join(root, "a"), b = join(root, "b");
  for (const [dir, slug] of [[a, "alpha"], [b, "alpha"], [b, "beta"]] as const) {
    mkdirSync(join(dir, slug), { recursive: true });
    writeFileSync(join(dir, slug, "PROJECT.md"), `# ${slug}\n`);
  }
  mkdirSync(join(a, "no-project-md"));
  const cfg = join(root, "config.json");
  writeFileSync(cfg, JSON.stringify({ memory: { projectRoots: [a, b], vault: join(root, "vault") } }));
  const { local } = loadMemory(cfg, "/opt/test/memory-search");
  return { root, a, b, local: local!, projects: memoryProjects(local!) };
}

test("a lead of a memory project gets both tools, the pointer, and its folder recorded so its sessions count", () => {
  const w = world();
  const s = memorySetup({ role: "lead", project: "alpha" }, "orch-scratch", "/work/thr_abc", w.local, w.projects);
  assert.deepEqual(s.tools, [TOOL_SEARCH, TOOL_PAGE]);
  assert.deepEqual(s.map, { folder: "/work/thr_abc", project: "alpha" });
  assert.match(s.instructions!, /project: "alpha"/);
});

test("durable feedback goes to the project's notes folder that every thread searches, not per-folder auto-memory", () => {
  const w = world();
  const s = memorySetup({ role: "thread", project: "alpha" }, "orch-scratch", null, w.local, w.projects);
  assert.ok(s.instructions!.includes(`${join(w.a, "alpha")}/memory/`), "the first root holding the project wins");
  assert.match(s.instructions!, /auto-memory/);
  assert.equal(s.map, undefined, "no folder yet: nothing to record");
});

test("the CoS and the Steward get no project memory tools; nor does an agent of an unknown project", () => {
  const w = world();
  for (const role of ["cos", "steward"]) assert.deepEqual(memorySetup({ role, project: null }, "x", "/f", w.local, w.projects).tools, []);
  assert.deepEqual(memorySetup({ role: "lead", project: "gamma" }, "x", "/f", w.local, w.projects).tools, []);
  assert.deepEqual(memorySetup({ role: "lead", project: "no-project-md" }, "x", "/f", w.local, w.projects).tools, [], "a folder without PROJECT.md is no project");
});

test("any thread of a memory project gets the tools, even without a role, and a role's project wins over the bb name", () => {
  const w = world();
  const plain = memorySetup({ role: null, project: null }, "beta", "/f", w.local, w.projects);
  assert.deepEqual(plain.tools, [TOOL_SEARCH, TOOL_PAGE]);
  assert.match(plain.instructions!, /project: "beta"/);
  assert.match(memorySetup({ role: "lead", project: "alpha" }, "beta", "/f", w.local, w.projects).instructions!, /project: "alpha"/);
  assert.deepEqual(memorySetup({ role: null, project: null }, "orch-scratch", "/f", w.local, w.projects).tools, [], "a bb project that isn't a memory project gets nothing");
});

test("without a memory config nobody gets the tools", () => {
  assert.deepEqual(memorySetup({ role: "lead", project: "alpha" }, "x", "/f", null, new Map()), { tools: [] });
  assert.equal(loadMemory("/nonexistent/config.json").local, null);
});

test("memory is opt-in: an empty memoryConfig setting is off, and no config is guessed from the home folder", () => {
  // a fresh install must never run a memory tool or read a config it wasn't pointed at
  assert.equal(memoryConfigPath(""), null);
  assert.equal(memoryConfigPath("   "), null);
  assert.match(loadMemory(memoryConfigPath("")).why, /no memory config set/);
  assert.equal(memoryConfigPath("~/mem/config.json", "/home/u"), "/home/u/mem/config.json", "a set path still takes ~");
});

test("the memory tools get the config path only through a plain environment variable name", () => {
  assert.equal(configEnvName("MEMORY_CONFIG"), "MEMORY_CONFIG");
  assert.equal(configEnvName(""), null, "empty: the path isn't passed");
  for (const bad of ["PATH=/x", "A B", "1X", "$(id)"]) assert.equal(configEnvName(bad), null, bad);
});

test("a query that looks like a flag is searched for, never run as one", () => {
  assert.deepEqual(searchArgv({ query: "--refresh", project: "alpha" }), ["--project", "alpha", "-n", "8", "--", "--refresh"]);
  assert.throws(() => searchArgv({ query: "x", project: "../etc" }), /project/);
});

test("a project folder added to the projects folder shows in Projects once it has a live record, so its lead can be started", () => {
  mkdirSync(TMP, { recursive: true });
  const root = mkdtempSync(join(TMP, "live-"));
  const proj = (slug: string, record: object | null) => {
    mkdirSync(join(root, slug));
    writeFileSync(join(root, slug, "PROJECT.md"), `# ${slug}\n`);
    if (record) writeFileSync(join(root, slug, "project.json"), JSON.stringify(record));
  };
  proj("agent-v2", { slug: "agent-v2", archived_at: null });
  proj("code-reviews", { slug: "code-reviews", archived_at: null });
  proj("speedups", { slug: "speedups", archived_at: "2026-11-10T00:00:00Z" }); // archived: stays out
  proj("night-shift", null); // a folder of another root's kind, with no project record: memory only
  mkdirSync(join(root, "half-made")); // no PROJECT.md
  writeFileSync(join(root, "half-made", "project.json"), "{}");
  assert.deepEqual(liveProjects(root), ["agent-v2", "code-reviews"]);
  assert.deepEqual(liveProjects(join(root, "missing")), [], "a missing root lists nothing rather than failing the reload");
});

test("the projectRecord setting lets existing project folders keep their own record file name", () => {
  mkdirSync(TMP, { recursive: true });
  const root = mkdtempSync(join(TMP, "rec-"));
  mkdirSync(join(root, "kept"));
  writeFileSync(join(root, "kept", "PROJECT.md"), "# kept\n");
  writeFileSync(join(root, "kept", "legacy.json"), JSON.stringify({ archived_at: null }));
  assert.deepEqual(liveProjects(root), [], "the default record (project.json) is missing");
  assert.deepEqual(liveProjects(root, "legacy.json"), ["kept"]);
  assert.deepEqual(liveProjects(root, "../kept/legacy.json"), [], "a record name is a file name, never a path");
});
