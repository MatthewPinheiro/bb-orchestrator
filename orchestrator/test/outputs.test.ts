// Outputs' promises (phase 3, the earlier Docs record): an agent can show the owner only files it may show them, from its own
// folder or the shared state and vault folders; only the agents that make work (leads and threads) record it; and
// every new output also reaches the Board, so nothing the owner should see lands silently.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Engine, type DeliverResult } from "../core/engine.ts";

// No /tmp: a scratch folder beside the tests (.scratch/ is git-ignored), removed afterwards.
const scratchRoot = join(import.meta.dirname, ".scratch");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "outputs-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function file(rel: string, text = "x"): string {
  const p = join(scratch, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
  return p;
}

const env = join(scratch, "env"); // the thread's own environment folder
const shared = join(scratch, "state"); // stands in for the state folder
const inEnv = file("env/docs/plan.md");
const inShared = file("state/reports/r.html");
const outside = file("elsewhere/secret.txt");
const sibling = file("env-x/look-alike.md"); // shares the env folder's prefix, but isn't in it
symlinkSync(outside, join(env, "sneaky.txt")); // a link inside the folder that points out of it
const place = { roots: [env, shared], hostId: "host-1" };

function setup() {
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, {
    now: () => Date.parse("2026-11-13T10:00:00Z"),
    async deliver(): Promise<DeliverResult> {
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  const cos = e.register("T-cos", "cos", null);
  const steward = e.register("T-st", "steward", null);
  const lead = e.register("T-la", "lead", "alpha");
  const thread = e.register("T-w1", "thread", "alpha", "T-la");
  return { e, cos, steward, lead, thread };
}

test("a file outside the thread's own folder is refused, however it is reached, so an agent can't put any file on the owner's screen", () => {
  const s = setup();
  for (const [why, path] of [
    ["a plain outside path", outside],
    ["a symlink inside the folder pointing out", join(env, "sneaky.txt")],
    ["a sibling folder sharing the prefix", sibling],
    ["a path climbing out with ..", join(env, "..", "elsewhere", "secret.txt")],
  ] as const) {
    assert.throws(() => s.e.addOutput(s.thread, { title: "t", kind: "doc", path }, place), /outside your environment folder/, why);
  }
  assert.throws(() => s.e.addOutput(s.thread, { title: "t", kind: "doc", path: "docs/plan.md" }, place), /must be absolute/);
  assert.throws(() => s.e.addOutput(s.thread, { title: "t", kind: "doc", path: join(env, "missing.md") }, place), /no such file/);
  assert.throws(() => s.e.addOutput(s.thread, { title: "t", kind: "doc", path: join(env, "docs") }, place), /not a file/);
  assert.equal(s.e.outputs().length, 0, "nothing refused is recorded");

  const mine = s.e.addOutput(s.thread, { title: "Plan", kind: "doc", path: inEnv }, place);
  const kept = s.e.addOutput(s.thread, { title: "Report", kind: "report", path: inShared }, place);
  assert.equal(mine.output.path, inEnv);
  assert.equal(kept.output.hostId, "host-1", "a file keeps its host, so bb's preview can open it");
});

test("only a link the owner can safely click is recorded: http(s), never javascript: or file:", () => {
  const s = setup();
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
    assert.throws(() => s.e.addOutput(s.lead, { title: "t", kind: "link", url }, place), /only http\(s\)|not a URL/, url);
  }
  assert.throws(() => s.e.addOutput(s.lead, { title: "t", kind: "link", path: inEnv }, place), /a link is a url/);
  assert.throws(() => s.e.addOutput(s.lead, { title: "t", kind: "doc", path: inEnv, url: "https://x.example/" }, place), /one of path or url/);
  const ok = s.e.addOutput(s.lead, { title: "Demo", kind: "video", url: "https://github.com/user-attachments/assets/abc" }, place);
  assert.equal(ok.output.hostId, null, "a link needs no host");
});

test("the CoS and the Steward can't record outputs: only the agents that make the work show it to the owner", () => {
  const s = setup();
  for (const a of [s.cos, s.steward]) {
    assert.throws(() => s.e.addOutput(a, { title: "t", kind: "doc", path: inShared }, place), (err: Error & { kind?: string }) => err.kind === "forbidden", a.address);
  }
  assert.equal(s.e.outputs().length, 0);
  assert.equal(s.e.board().filter((r) => r.kind === "output").length, 0);
});

test("a new output is posted on the Board as an output row from its author, once, so the owner sees it in the activity too", () => {
  const s = setup();
  const { output, created } = s.e.addOutput(s.thread, { title: "Checkout demo", kind: "video", url: "https://example.com/demo.mp4", note: "the new flow" }, place);
  assert.ok(created);
  const rows = s.e.board().filter((r) => r.kind === "output");
  assert.equal(rows.length, 1);
  assert.deepEqual({ from: rows[0]!.from, project: rows[0]!.project, title: rows[0]!.title, ref: rows[0]!.ref }, { from: "thread:alpha:1", project: "alpha", title: "Checkout demo", ref: output.id });
  assert.match(rows[0]!.body, /video: https:\/\/example\.com\/demo\.mp4\nthe new flow/);

  const again = s.e.addOutput(s.thread, { title: "Checkout demo (again)", kind: "video", url: "https://example.com/demo.mp4" }, place);
  assert.equal(again.created, false, "recording the same link twice is one output");
  assert.equal(again.output.id, output.id);
  assert.equal(s.e.board().filter((r) => r.kind === "output").length, 1, "and one Board row");
});

test("The owner's remove takes an output off the record and leaves the file alone", () => {
  const s = setup();
  const { output } = s.e.addOutput(s.lead, { title: "Plan", kind: "doc", path: inEnv }, place);
  s.e.removeOutput(output.id);
  assert.equal(s.e.outputs().length, 0);
  assert.throws(() => s.e.removeOutput(output.id), /no output/);
  assert.ok(s.e.addOutput(s.lead, { title: "Plan", kind: "doc", path: inEnv }, place).created, "the file is still there to record again");
});
