// The Orchestrator page's pane layout (app/layout.ts). What matters to the owner: splitting never loses a view they had open,
// closing never leaves a blank or orphaned area, a divider can't squeeze a pane to nothing, and a stale or broken
// saved layout falls back instead of breaking the page.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PANES, MIN_SHARE, close, detailOf, panes, parse, pathFor, resize, setView, single, split, type Split } from "../app/layout.ts";

const VIEWS = ["needs-you", "projects", "agents", "chat"];

test("split right puts the new view beside the old one and focuses it; the old pane keeps its view", () => {
  const l = split(single("needs-you"), "p0", "row", "projects");
  const root = l.root as Split;
  assert.equal(root.dir, "row");
  assert.deepEqual(panes(l.root).map((p) => p.view), ["needs-you", "projects"]);
  assert.equal(l.focus, panes(l.root)[1]!.id);
  assert.deepEqual(root.sizes, [0.5, 0.5]);
});

test("splitting the same way again shares the pane's room instead of nesting; the other way nests", () => {
  let l = split(single("needs-you"), "p0", "row", "projects");
  l = split(l, "p0", "row", "agents");
  const root = l.root as Split;
  assert.equal(root.children.length, 3, "a row inside a row is just a wider row");
  assert.deepEqual(root.sizes, [0.25, 0.25, 0.5]);
  const down = split(l, panes(l.root)[2]!.id, "col", "chat");
  assert.equal(((down.root as Split).children[2] as Split).dir, "col");
});

test("no more than MAX_PANES panes", () => {
  let l = single("needs-you");
  for (let i = 0; i < 6; i++) l = split(l, l.focus, i % 2 ? "row" : "col", "agents");
  assert.equal(panes(l.root).length, MAX_PANES);
});

test("closing gives the room back, collapses a one-child split, moves focus, and never closes the last pane", () => {
  let l = split(single("needs-you"), "p0", "row", "projects");
  const other = panes(l.root)[1]!.id;
  l = close(l, other);
  assert.equal(l.root.kind, "pane", "no split around a single pane");
  assert.equal(l.focus, "p0");
  assert.deepEqual(close(l, "p0"), l, "the last pane stays");
  let three = split(split(single("a"), "p0", "row", "b"), "p0", "row", "c");
  three = close(three, "p0");
  assert.deepEqual((three.root as Split).sizes.map((s) => Math.round(s * 100)), [33, 67], "the rest share the whole");
});

test("a divider stops at MIN_SHARE on either side", () => {
  const l = split(single("needs-you"), "p0", "row", "projects");
  const id = (l.root as Split).id;
  assert.deepEqual((resize(l, id, 0, 0.9).root as Split).sizes, [1 - MIN_SHARE, MIN_SHARE]);
  assert.deepEqual((resize(l, id, 0, -0.9).root as Split).sizes, [MIN_SHARE, 1 - MIN_SHARE]);
  assert.deepEqual(resize(l, id, 5, 0.1), l, "a divider that isn't there moves nothing");
});

test("setView changes one pane and focuses it", () => {
  const l = split(single("needs-you"), "p0", "row", "projects");
  const v = setView(l, "p0", "chat");
  assert.deepEqual(panes(v.root).map((p) => p.view), ["chat", "projects"]);
  assert.equal(v.focus, "p0");
});

test("a saved layout round-trips; a broken or stale one is refused so the page falls back to one pane", () => {
  const l = split(split(single("needs-you"), "p0", "row", "projects"), "p0", "col", "chat");
  assert.deepEqual(parse(JSON.parse(JSON.stringify(l)), VIEWS), l);
  assert.equal(parse({ root: { kind: "pane", id: "x", view: "gone-view" }, focus: "x" }, VIEWS), null, "a view removed since");
  assert.equal(parse({ root: { kind: "split", id: "s", dir: "row", sizes: [1], children: [{ kind: "pane", id: "a", view: "chat" }] } }, VIEWS), null);
  assert.equal(parse({ root: { kind: "split", id: "s", dir: "row", sizes: [0.5, 0.5], children: [{ kind: "pane", id: "a", view: "chat" }, { kind: "pane", id: "a", view: "chat" }] } }, VIEWS), null, "duplicate ids");
  assert.equal(parse("garbage", VIEWS), null);
  assert.equal(parse({ root: { kind: "pane", id: "a", view: "chat" }, focus: "nope" }, VIEWS)!.focus, "a", "an unknown focus falls to the first pane");
});

test("a saved pane on a view that went (the Agents tab, 2026-11-16) opens its successor rather than losing the layout", () => {
  const saved = { root: { kind: "split", id: "s1", dir: "row", sizes: [0.5, 0.5], children: [{ kind: "pane", id: "a", view: "agents" }, { kind: "pane", id: "b", view: "board" }] }, focus: "a" };
  const views = ["projects", "board"];
  assert.equal(parse(saved, views), null, "without the rename the owner's split would be thrown away");
  const l = parse(saved, views, { agents: "projects" })!;
  assert.deepEqual(panes(l.root).map((p) => p.view), ["projects", "board"]);
  assert.equal(l.focus, "a");
});

test("a project's page survives the URL following pane focus: projects/<slug> is written back, other views drop it", () => {
  assert.equal(detailOf("projects/agent-v2"), "agent-v2");
  assert.equal(detailOf("projects"), null);
  assert.equal(detailOf("board/agent-v2"), null);
  assert.equal(detailOf("projects/%E0%A4%A"), null, "a broken escape opens the list, not an error");
  // the owner clicks another pane (the URL says board), then comes back to the projects pane
  assert.equal(pathFor("board", "board", "agent-v2"), "board");
  assert.equal(pathFor("projects", "projects", "agent-v2"), "projects/agent-v2");
  assert.equal(detailOf(pathFor("projects", "projects", "agent-v2")), "agent-v2", "back on Projects, the same page is open");
  assert.equal(pathFor("projects", "projects", null), "projects");
});
