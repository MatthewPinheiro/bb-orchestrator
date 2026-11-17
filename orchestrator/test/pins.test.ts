// Pinned documents (2026-11-17): a project keeps up to twelve documents at hand under its message box. What matters to
// the owner:
// - a pin can only put on the owner's screen a file an agent could already show him as proof (the same check, the same
//   roots, never wider), and only an http(s) link;
// - the strip stays a shortlist: the 13th live pin is refused;
// - an unpinned document leaves the strip at once;
// - "updated" is read when the tab loads (a file's mtime, a deliverable's latest revision), never stored;
// - a lead pins only in its own project, and a thread doesn't pin at all;
// - the table is the last migration, so every existing database gains it on upgrade.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { MIGRATIONS, migrate } from "../core/db.ts";
import { PINS_MAX } from "../core/pins.ts";

// No /tmp: a scratch folder beside the tests (.scratch/ is git-ignored), removed afterwards.
const scratchRoot = join(import.meta.dirname, ".scratch");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "pins-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function file(rel: string, text = "x"): string {
  const p = join(scratch, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
  return p;
}

// A lead's environment folder holds the project's own files, its board among them: the same shape here, under the
// scratch folder.
const leadEnv = join(scratch, "projects", "kite");
const board = file("projects/kite/library/team-map/team-map.html", "<!doctype html><title>Team work map</title>");
const notes = file("projects/kite/notes.md");
const state = join(scratch, "state");
const report = file("state/reports/r.md");
const otherProject = file("projects/orchestrator/PROJECT.md"); // a sibling project's folder: not this lead's
const lookAlike = file("projects/kite-old/x.md"); // shares the prefix, isn't inside
symlinkSync(otherProject, join(leadEnv, "sneaky.md")); // inside the folder, pointing out of it
const place = { roots: [leadEnv, state], hostId: "host-1" };

const NOW = Date.parse("2026-11-17T10:00:00Z");
function setup() {
  const db = new DatabaseSync(":memory:");
  let clock = NOW;
  const e = new Engine(db as never, { now: () => clock, deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} });
  const lead = e.register("T-tm", "lead", "kite");
  const thread = e.register("T-tm1", "thread", "kite", "T-tm");
  const otherLead = e.register("T-or", "lead", "orchestrator");
  return { e, db, lead, thread, otherLead, advance: (ms: number) => (clock += ms) };
}
const titles = (s: ReturnType<typeof setup>, p = "kite") => s.e.pins(p).map((x) => x.title);

test("the team map passes the proof check from its lead's own folder, and opens on that lead's host", () => {
  const s = setup();
  const { pin } = s.e.pin("kite", board, { by: "owner" }, place);
  assert.equal(pin.kind, "file");
  assert.equal(pin.path, board);
  assert.equal(pin.hostId, "host-1", "bb's file preview needs the host");
  assert.equal(pin.icon, "page", "an HTML file reads as a page");
  assert.equal(pin.title, "team-map.html", "no title given: the file's name");
});

test("a file outside the project's roots is refused however it is reached: a pin can't show what proof couldn't", () => {
  const s = setup();
  for (const [why, path] of [
    ["another project's folder", otherProject],
    ["a symlink inside the folder pointing out", join(leadEnv, "sneaky.md")],
    ["a sibling folder sharing the prefix", lookAlike],
    ["a path climbing out with ..", join(leadEnv, "..", "orchestrator", "PROJECT.md")],
  ] as const) {
    assert.throws(() => s.e.pin("kite", path, { by: "owner" }, place), /outside kite's folders/, why);
  }
  assert.throws(() => s.e.pin("kite", "notes.md", { by: "owner" }, place), /must be absolute/);
  assert.throws(() => s.e.pin("kite", join(leadEnv, "missing.md"), { by: "owner" }, place), /no such file/);
  assert.throws(() => s.e.pin("kite", notes, { by: "owner" }, { roots: place.roots, hostId: null }), /no bb host/, "a file nobody can open isn't pinned");
  assert.deepEqual(s.e.pins("kite"), [], "nothing refused is pinned");
  assert.equal(s.e.pin("kite", report, { by: "owner" }, place).created, true, "the shared state folder is a root, as for proof");
});

test("only http(s) links: a javascript: or file: URL never reaches the owner's screen", () => {
  const s = setup();
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi"]) assert.throws(() => s.e.pin("kite", url, { by: "owner" }, place), /only http\(s\)/, url);
  const { pin } = s.e.pin("kite", "https://claude.ai/artifact/abc123", { by: "owner", title: "Work map" }, place);
  assert.deepEqual([pin.kind, pin.icon, pin.title, pin.hostId], ["link", "link", "Work map", null]);
});

test("a 13th pin is refused, and unpinning one makes room: the strip is a shortlist, not a folder", () => {
  const s = setup();
  for (let i = 0; i < PINS_MAX; i++) s.e.pin("kite", `https://example.com/doc/${i}`, { by: "owner" }, place);
  assert.equal(s.e.pins("kite").length, 12);
  assert.throws(() => s.e.pin("kite", "https://example.com/doc/12", { by: "owner" }, place), /12 pins already/);
  assert.equal(s.e.pin("kite", "https://example.com/doc/3", { by: "owner" }, place).created, false, "a target already pinned is that pin, not a 13th");
  const first = s.e.pins("kite")[0]!;
  s.e.unpinDoc(first.id, { by: "owner" });
  assert.equal(s.e.pin("kite", "https://example.com/doc/12", { by: "owner" }, place).created, true);
  assert.equal(s.e.pins("orchestrator").length, 0, "the cap is per project");
});

test("an unpinned document leaves the strip at once, keeps its row, and can be pinned again", () => {
  const s = setup();
  const a = s.e.pin("kite", board, { by: "owner", title: "Team work map" }, place).pin;
  s.e.pin("kite", "https://example.com/plan", { by: "owner", title: "Plan" }, place);
  s.e.unpinDoc(a.id, { by: "owner" });
  assert.deepEqual(titles(s), ["Plan"]);
  const row = s.db.prepare(`SELECT unpinned_at FROM project_pins WHERE id = ?`).get(a.id) as { unpinned_at: number };
  assert.equal(row.unpinned_at, NOW, "the record keeps when it was unpinned");
  s.e.unpinDoc(a.id, { by: "owner" }); // twice is a no-op
  const again = s.e.pin("kite", board, { by: "owner" }, place);
  assert.equal(again.created, true);
  assert.notEqual(again.pin.id, a.id);
  assert.deepEqual(titles(s), ["Plan", "team-map.html"], "pinned again: it goes last");
});

test("updated is read when the tab loads: a file's mtime now, a deliverable's latest revision, a link's pin time", () => {
  const s = setup();
  const p = file("projects/kite/live.md");
  utimesSync(p, new Date(NOW - 3 * 86_400_000), new Date(NOW - 3 * 86_400_000));
  s.e.pin("kite", p, { by: "owner" }, place);
  s.e.pin("kite", "https://example.com/x", { by: "owner" }, place);
  const v1 = s.e.pins("kite");
  assert.equal(v1[0]!.updatedAt, NOW - 3 * 86_400_000);
  assert.equal(v1[1]!.updatedAt, NOW, "a link changes where we can't see: its pin time");
  utimesSync(p, new Date(NOW - 60_000), new Date(NOW - 60_000));
  assert.equal(s.e.pins("kite")[0]!.updatedAt, NOW - 60_000, "an edit since shows without re-pinning: nothing is stored");
  rmSync(p);
  assert.deepEqual([s.e.pins("kite")[0]!.missing, s.e.pins("kite")[0]!.updatedAt], [true, null], "a file gone says so");

  const d1 = s.e.deliver(s.lead, { title: "Work map v1", summary: "First pass.", proof: [{ kind: "link", caption: "map", url: "https://example.com/m" }] }, { roots: [] });
  const dp = s.e.pin("kite", d1.id, { by: "owner" }, place).pin;
  assert.deepEqual([dp.kind, dp.icon, dp.title], ["deliverable", "box", "Work map v1"], "a deliverable pin takes its title");
  s.e.personRequestChanges(d1.id, d1.rev, "Add owners");
  s.advance(2 * 3_600_000);
  const d2 = s.e.deliver(s.lead, { title: "Work map v1", summary: "Owners added.", proof: [{ kind: "link", caption: "map", url: "https://example.com/m" }], revises: d1.id }, { roots: [] });
  const v = s.e.pins("kite").find((x) => x.id === dp.id)!;
  assert.equal(v.rev, d2.rev);
  assert.equal(v.updatedAt, NOW + 2 * 3_600_000, "the latest revision's time");
  assert.throws(() => s.e.pin("orchestrator", d1.id, { by: "owner" }, place), /belongs to kite/, "another project's deliverable");
});

test("a lead pins and unpins only in its own project; a thread doesn't pin", () => {
  const s = setup();
  const { pin } = s.e.pin("kite", notes, { by: s.lead }, place);
  assert.equal(pin.pinnedBy, "lead:kite");
  assert.throws(() => s.e.pin("kite", "https://example.com/a", { by: s.thread }, place), (e: Error & { kind?: string }) => e.kind === "forbidden");
  assert.throws(() => s.e.pin("kite", "https://example.com/a", { by: s.otherLead }, place), (e: Error & { kind?: string }) => e.kind === "forbidden");
  assert.throws(() => s.e.unpinDoc(pin.id, { by: s.otherLead }), (e: Error & { kind?: string }) => e.kind === "forbidden");
  // a lead names it by its path, as it pinned it
  s.e.unpinDoc(notes, { by: s.lead, project: "kite" });
  assert.deepEqual(s.e.pins("kite"), []);
});

test("the pins reach the page with the project's book: one read, refreshed on the same change signal", () => {
  const s = setup();
  s.e.pin("kite", "https://example.com/plan", { by: "owner", title: "Plan" }, place);
  assert.deepEqual(s.e.projectBook("kite").pins!.map((p) => p.title), ["Plan"]);
  assert.deepEqual(s.e.projectBook("orchestrator").pins, []);
});

test("project_pins, then 1.10.0's handed_off_prs, are appended last, so a database from before pins gains both and keeps its rows", () => {
  const last = MIGRATIONS.length - 1;
  const pins = MIGRATIONS.findIndex((m) => /^CREATE TABLE project_pins \(/.test(m));
  assert.match(MIGRATIONS[pins - 1]!, /^CREATE INDEX events_project_kind/, "appended after the book's indexes, never inserted before them");
  assert.match(MIGRATIONS[last]!, /^CREATE TABLE handed_off_prs \(/, "the next table goes after project_pins, never before it");
  assert.equal(last, pins + 1);
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE _migrations (id INTEGER PRIMARY KEY)`);
  MIGRATIONS.slice(0, pins).forEach((sql, i) => {
    db.exec(sql);
    db.prepare(`INSERT INTO _migrations (id) VALUES (?)`).run(i);
  });
  db.prepare(`INSERT INTO projects (slug, priority, created_at) VALUES ('kept', 'normal', 1)`).run();
  migrate(db);
  assert.ok((db.prepare(`SELECT name FROM sqlite_master WHERE name = 'project_pins'`).get() as { name: string } | undefined)?.name);
  assert.ok((db.prepare(`SELECT name FROM sqlite_master WHERE name = 'handed_off_prs'`).get() as { name: string } | undefined)?.name);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE slug = 'kept'`).get() as { n: number }).n, 1);
  assert.equal((db.prepare(`SELECT MAX(id) AS v FROM _migrations`).get() as { v: number }).v, last);
});

test("a pinned file that later resolves elsewhere (its folder swapped for a symlink out) counts as missing and is not opened", () => {
  const s = setup();
  const doc = file("projects/kite/swap/doc.md");
  const { pin } = s.e.pin("kite", doc, { by: "owner" }, place);
  assert.equal(s.e.pins("kite")[0]!.missing, false);
  // after the check: the folder goes, and a symlink to another project's folder takes its name
  const swap = join(leadEnv, "swap");
  rmSync(swap, { recursive: true });
  mkdirSync(join(swap, "..", "elsewhere"), { recursive: true });
  writeFileSync(join(swap, "..", "elsewhere", "doc.md"), "not this project's");
  symlinkSync(join(scratch, "projects", "orchestrator"), swap);
  writeFileSync(join(scratch, "projects", "orchestrator", "doc.md"), "another project's file");
  const v = s.e.pins("kite").find((x) => x.id === pin.id)!;
  assert.deepEqual([v.missing, v.updatedAt], [true, null], "the stored realpath no longer resolves to itself: the strip won't open it");
});

test("a file opens on the machine of the folder it is in, not always on the lead's", () => {
  const s = setup();
  const threadEnv = join(scratch, "worktrees", "tm-thread-1");
  const shot = file("worktrees/tm-thread-1/shot.png");
  const two = { roots: [leadEnv, threadEnv, state], hostId: "host-1", hosts: [{ path: leadEnv, hostId: "host-1" }, { path: threadEnv, hostId: "host-2" }, { path: state, hostId: "host-1" }] };
  assert.equal(s.e.pin("kite", shot, { by: "owner" }, two).pin.hostId, "host-2", "the thread's worktree is on host-2");
  assert.equal(s.e.pin("kite", notes, { by: "owner" }, two).pin.hostId, "host-1");
});

test("unpinning twice by id is a no-op from the CLI too (project-scoped), as from the page", () => {
  const s = setup();
  const { pin } = s.e.pin("kite", notes, { by: "owner" }, place);
  s.e.unpinDoc(pin.id, { by: "owner", project: "kite" });
  assert.doesNotThrow(() => s.e.unpinDoc(pin.id, { by: "owner", project: "kite" }));
  assert.throws(() => s.e.unpinDoc(pin.id, { by: "owner", project: "orchestrator" }), /no pin/, "still scoped to its project");
  assert.throws(() => s.e.unpinDoc(notes, { by: "owner", project: "kite" }), /no pin/, "by path only while live");
});

test("a valid link with a bad escape in its path still pins, titled as written", () => {
  const s = setup();
  assert.equal(s.e.pin("kite", "https://example.com/100%", { by: "owner" }, place).pin.title, "100%");
  assert.equal(s.e.pin("kite", "https://example.com/a%20plan", { by: "owner" }, place).pin.title, "a plan");
});

test("archiving a thread keeps a pinned output's pin: it follows the output to the kept copy", () => {
  const s = setup();
  const src = file("projects/kite/out/result.md");
  const { output } = s.e.addOutput(s.lead, { title: "Result", kind: "doc", path: src, url: null, note: null }, place);
  const { pin } = s.e.pin("kite", src, { by: s.lead }, place);
  // the kept copy reached through a symlinked folder (one place reached by two paths, as a home folder mounted twice)
  const kept = file("state/kept-real/result.md");
  symlinkSync(join(state, "kept-real"), join(state, "kept-link"));
  s.e.repointOutput(output.id, join(state, "kept-link", "result.md"));
  const v = s.e.pins("kite").find((x) => x.id === pin.id)!;
  assert.deepEqual([v.path, v.missing], [kept, false], "it follows to the copy's realpath, so it still opens");
});

test("an archive's repoint moves only its own project's pin on its own host: the same path elsewhere is another file", () => {
  const s = setup();
  const src = file("projects/kite/out/shared.md");
  // the output was recorded on host-2; a pin of the same path made on host-1, and one in another project
  const { output } = s.e.addOutput(s.lead, { title: "Shared", kind: "doc", path: src, url: null, note: null }, { ...place, hostId: "host-2" });
  const here = s.e.pin("kite", src, { by: "owner" }, place).pin;
  const there = s.e.pin("orchestrator", src, { by: "owner" }, place).pin;
  s.e.repointOutput(output.id, file("state/kept2/shared.md"));
  const path = (project: string, id: string) => s.e.pins(project).find((x) => x.id === id)!.path;
  assert.equal(path("kite", here.id), src, "same project, another host: untouched");
  assert.equal(path("orchestrator", there.id), src, "another project: untouched");
});

test("a file in a folder with no known host is refused, never opened on another folder's host", () => {
  const s = setup();
  const threadEnv = join(scratch, "worktrees", "tm-thread-nohost");
  const f = file("worktrees/tm-thread-nohost/x.md");
  const mixed = { roots: [leadEnv, threadEnv], hostId: "host-1", hosts: [{ path: leadEnv, hostId: "host-1" }, { path: threadEnv, hostId: null }] };
  assert.throws(() => s.e.pin("kite", f, { by: "owner" }, mixed), /no bb host/);
  assert.equal(s.e.pin("kite", notes, { by: "owner" }, mixed).pin.hostId, "host-1", "the lead's own folder still opens on its host");
});
