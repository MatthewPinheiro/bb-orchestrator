import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type BbRun, SECTION_ORDER, cliRun, setupSidebar } from "../core/sidebar.ts";

// A fake bb holding the sidebar state; set/pin calls mutate it, so a second run sees the first run's result.
function fakeBb() {
  const st = { exp: false, meta: false, order: ["pinned", "sections", "threads"], pinned: new Set<string>(), calls: [] as string[][] };
  const run: BbRun = async (a) => {
    const k = a.join(" ");
    if (k.startsWith("settings show")) return JSON.stringify({ experiments: { threadRowMetadata: st.exp } });
    if (k.startsWith("thread-list prefs list")) return JSON.stringify({ showRowMetadata: st.meta, sectionOrder: st.order });
    if (k.startsWith("thread list")) return JSON.stringify(a.filter((_, i) => a[i - 1] === "--thread").map((id) => ({ id, pinnedAt: st.pinned.has(id) ? "x" : null })));
    st.calls.push(a);
    if (k === "settings experiment threadRowMetadata true") st.exp = true;
    else if (k === "thread-list prefs set showRowMetadata true") st.meta = true;
    else if (a[2] === "set" && a[3] === "sectionOrder") st.order = JSON.parse(a[4]!);
    else if (a[1] === "pin") st.pinned.add(a[2]!);
    else throw new Error(`unexpected bb call: ${k}`);
    return "";
  };
  return { st, run };
}
const pins = [{ label: "Chief of Staff", threadId: "thr_cos" }, { label: "Steward", threadId: "thr_st" }];

test("setup sidebar turns everything on the first time, and the second run changes nothing (idempotent)", async () => {
  const { st, run } = fakeBb();
  const first = await setupSidebar(run, pins);
  assert.equal(first.length, 5);
  assert.ok(first.every((l) => l.startsWith("set: ")), "first run reports every change");
  assert.deepEqual(st.order, SECTION_ORDER);
  assert.deepEqual([...st.pinned].sort(), ["thr_cos", "thr_st"]);
  const writes = st.calls.length;
  const second = await setupSidebar(run, pins);
  assert.ok(second.every((l) => l.startsWith("already set: ")), "second run says nothing changed");
  assert.equal(st.calls.length, writes, "second run makes no write calls");
});

test("setup sidebar only writes what differs", async () => {
  const { st, run } = fakeBb();
  st.exp = true;
  st.pinned.add("thr_cos");
  const lines = await setupSidebar(run, pins);
  assert.deepEqual(st.calls.map((c) => c.join(" ")).sort(), ["thread pin thr_st", "thread-list prefs set sectionOrder [\"pinned\",\"projects\",\"threads\"]", "thread-list prefs set showRowMetadata true"].sort());
  assert.equal(st.calls.length, 3);
  assert.ok(lines.some((l) => l === "already set: experiment threadRowMetadata = true"));
  assert.ok(lines.some((l) => l === "already set: Chief of Staff thread thr_cos pinned"));
});

// 2026-11-18: run in an isolated bb, setup sidebar called the live app at 127.0.0.1:38886: the CLI it ran got the plugin
// process's environment, which named no server, and the CLI's default is the live one. A stand-in bb records the server
// each call went to; nothing here reaches a real bb.
test("setup sidebar's bb calls go to the bb the plugin runs in, whatever the plugin's environment names", async () => {
  const root = join(import.meta.dirname, ".scratch");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "sidebar-cli-"));
  try {
    const bin = join(dir, "bb");
    writeFileSync(bin, `#!/bin/sh\necho "\${BB_SERVER_URL:-none} $*" >> "${join(dir, "calls")}"\necho '{}'\n`);
    chmodSync(bin, 0o755);
    const isolated = "http://127.0.0.1:39561";
    for (const env of [{ PATH: process.env.PATH }, { PATH: process.env.PATH, BB_SERVER_URL: "http://127.0.0.1:38886" }]) {
      rmSync(join(dir, "calls"), { force: true });
      const run = cliRun(bin, isolated, env);
      assert.equal(await run(["settings", "show", "--json"]), "{}\n");
      await run(["thread", "pin", "thr_cos"]);
      assert.deepEqual(readFileSync(join(dir, "calls"), "utf8").trim().split("\n"), [`${isolated} settings show --json`, `${isolated} thread pin thr_cos`], `with ${env.BB_SERVER_URL ?? "no server"} in the plugin's environment`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed bb call is an error naming the call, not a result", async () => {
  await assert.rejects(cliRun("/nonexistent/bb", "http://127.0.0.1:39561", {})(["settings", "show"]), /bb settings show: /);
});
