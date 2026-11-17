// The merged Deliverables tab's promises (2026-11-16: Deliverables and Outputs in one, "so people can go look back and see
// past deliverables easily", then "organize the All subtab by project" as "the folder style view and hierarchy"):
// - what waits for the owner is always first, and never in the tree below;
// - project folders follow the sidebar's order; inside one, newest first;
// - a proof file is a child of its deliverable; an output that is that proof is that row, never listed again;
// - an output that never became proof sits in its project's Files folder, never lost;
// - a filter or search drops nothing that matches it, and a project with no match has no folder;
// - the arrow keys walk the tree as a file explorer does.
// Made-up projects, leads and files only.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Deliverables, Outputs } from "../contract.ts";
import { ALL_PROJECTS, FILTERS, START, deliverablesTab, flatten, fold, folderKeys, openByDefault, treeKey, type Folder, type ProjectNode, type View } from "../app/past.ts";
import { RENAMED_VIEWS, panes, parse } from "../app/layout.ts";
import { manualSectionOrder, sidebarOrder } from "../core/project-order.ts";

type D = Deliverables[number];
type O = Outputs[number];

let n = 0;
function del(p: Partial<D> & { proof?: { path?: string; url?: string }[]; points?: string[] } = {}): D {
  const id = p.id ?? `v-${++n}`;
  const rev = p.rev ?? 1;
  const proof = (p.proof ?? [{ path: `/work/${id}/shot.png` }]).map((x, i) => ({ id: `${id}-p${i}`, kind: x.url ? ("link" as const) : ("image" as const), caption: "c", path: x.path ?? null, url: x.url ?? null, hostId: x.path ? "h1" : null, pr: null }));
  const points = (p.points ?? []).map((headline) => ({ kind: "finding" as const, headline, why: "because" }));
  return {
    id,
    project: p.project === undefined ? "alpha" : p.project,
    lead: p.lead ?? "lead:alpha",
    leadMon: null,
    title: p.title ?? `Deliverable ${id}`,
    summary: p.summary ?? "A summary",
    state: p.state ?? "approved",
    rev,
    createdAt: p.createdAt ?? 1,
    updatedAt: p.updatedAt ?? 1,
    revisions: p.revisions ?? [{ rev, summary: p.summary ?? "A summary", at: "2026-11-16T10:00:00Z", proof, blocks: [], points, prs: [] }],
    feedback: [],
    withdrawn: null,
    next: null,
  };
}
function out(p: Partial<O> = {}): O {
  const id = p.id ?? `o-${++n}`;
  return { id, title: p.title ?? `Output ${id}`, kind: p.kind ?? "image", path: p.path === undefined ? `/work/files/${id}.png` : p.path, url: p.url ?? null, hostId: "h1", note: p.note ?? null, project: p.project === undefined ? "alpha" : p.project, author: "thread:alpha:1", at: p.at ?? 1 };
}

const all: (n: Folder) => boolean = () => true;
/** Every node of the tree, with its parent's key: the tree fully open. */
const nodes = (tree: ProjectNode[]) => flatten(tree, all);
const delIds = (tree: ProjectNode[]) => nodes(tree).flatMap((r) => (r.node.t === "deliverable" ? [r.node.d.id] : []));
const fileIds = (tree: ProjectNode[]) => nodes(tree).flatMap((r) => (r.node.t === "file" ? [r.node.o.id] : []));
const order = (...slugs: string[]) => slugs.map((slug) => ({ slug, monType: null }));

test("what waits for the owner comes first, newest first, and is never repeated in the tree, under every filter and search", () => {
  const old = del({ id: "v-old-review", state: "review", updatedAt: 10 });
  const newer = del({ id: "v-new-review", state: "review", updatedAt: 20, project: "beta" });
  const past = del({ id: "v-past", state: "approved", updatedAt: 99 });
  for (const f of FILTERS) {
    for (const v of [{ ...START, filter: f.id }, { filter: f.id, project: "gamma", query: "nothing-matches-this" }] as View[]) {
      const tab = deliverablesTab([past, old, newer], [out({ at: 500 })], v);
      assert.deepEqual(tab.review.map((r) => r.d.id), ["v-new-review", "v-old-review"], `in review leads under ${JSON.stringify(v)}`);
      assert.ok(!delIds(tab.tree).some((id) => id.endsWith("-review")), "and is not drawn again below");
    }
  }
});

test("project folders follow the sidebar's order; a project it doesn't name comes after, by name, and No project last", () => {
  const ds = [del({ project: "zeta" }), del({ project: null }), del({ project: "alpha" }), del({ project: "omega" }), del({ project: "beta" })];
  const tree = deliverablesTab(ds, [], START, order("omega", "alpha", "zeta")).tree;
  assert.deepEqual(tree.map((p) => p.project), ["omega", "alpha", "zeta", "beta", null]);
});

test("inside a project, deliverables are newest first, and its Files folder is newest first", () => {
  const ds = [del({ id: "v-mid", updatedAt: 5 }), del({ id: "v-new", updatedAt: 9 }), del({ id: "v-old", updatedAt: 1 })];
  const os = [out({ id: "o-b", at: 5 }), out({ id: "o-c", at: 9 }), out({ id: "o-a", at: 1 })];
  const tree = deliverablesTab(ds, os, START).tree;
  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0]!.children.map((c) => (c.t === "deliverable" ? c.d.id : "Files")), ["v-new", "v-mid", "v-old", "Files"]);
  const files = tree[0]!.children.find((c) => c.t === "files");
  assert.deepEqual(files?.t === "files" ? files.children.map((f) => f.o.id) : [], ["o-c", "o-b", "o-a"]);
});

test("a proof file is a child of its deliverable, and an output that is that proof is that row, never in Files", () => {
  const shot = "/work/alpha/after.png";
  const link = "https://example.test/report";
  const d = del({ id: "v-shown", proof: [{ path: shot }, { url: link }] });
  const os = [out({ id: "o-shot", path: shot }), out({ id: "o-link", kind: "link", path: null, url: link }), out({ id: "o-loose" })];
  const rows = nodes(deliverablesTab([d], os, START).tree);
  const proofs = rows.filter((r) => r.node.t === "proof");
  assert.deepEqual(proofs.map((r) => r.parent), ["d:v-shown", "d:v-shown"], "proof rows hang under the deliverable");
  assert.deepEqual(proofs.map((r) => (r.node.t === "proof" ? r.node.output?.id : null)), ["o-shot", "o-link"]);
  assert.deepEqual(fileIds(deliverablesTab([d], os, START).tree), ["o-loose"], "the proof outputs are not listed again");
  // an in-review card also takes its proof outputs, so Files doesn't show them while the owner decides
  const tab = deliverablesTab([{ ...d, state: "review" }], os, START);
  assert.deepEqual(tab.review[0]!.outputs.map((o) => o.id).sort(), ["o-link", "o-shot"]);
  assert.deepEqual(fileIds(tab.tree), ["o-loose"]);
});

test("a loose output sits under its own project's Files folder", () => {
  const tree = deliverablesTab([del({ project: "alpha" })], [out({ id: "o-beta", project: "beta" }), out({ id: "o-none", project: null })], START, order("alpha", "beta")).tree;
  const rows = nodes(tree);
  const parentOf = (id: string) => rows.find((r) => r.node.t === "file" && r.node.o.id === id)!.parent;
  assert.equal(parentOf("o-beta"), "F:beta");
  assert.equal(rows.find((r) => r.node.key === "F:beta")!.parent, "p:beta");
  assert.equal(parentOf("o-none"), "F:");
  assert.equal(rows.find((r) => r.node.key === "F:")!.parent, "p:");
});

test("no output is lost: each lands exactly once, as a proof row or under Files, withdrawn deliverables and older revisions included", () => {
  const ds = [
    del({ id: "v-a", proof: [{ path: "/work/a.png" }] }),
    // only an older revision used this file: the tree shows rev 2's proof, so the file stays a visible File
    del({
      id: "v-b",
      rev: 2,
      revisions: [
        { rev: 1, summary: "s", at: "x", proof: [{ id: "b1", kind: "image", caption: "", path: "/work/b-old.png", url: null, hostId: "h1", pr: null }], blocks: [], points: [], prs: [] },
        { rev: 2, summary: "s", at: "y", proof: [{ id: "b2", kind: "image", caption: "", path: "/work/b-new.png", url: null, hostId: "h1", pr: null }], blocks: [], points: [], prs: [] },
      ],
    }),
    del({ id: "v-w", state: "withdrawn", proof: [{ path: "/work/w.png" }] }),
  ];
  const os = [
    out({ id: "o-a", path: "/work/a.png" }),
    out({ id: "o-b-old", path: "/work/b-old.png" }),
    out({ id: "o-b-new", path: "/work/b-new.png" }),
    out({ id: "o-w", path: "/work/w.png" }),
    out({ id: "o-other-project", path: "/work/a.png", project: "beta" }), // same file, another project: not v-a's
    out({ id: "o-no-project", project: null }),
    out({ id: "o-deleted-project", project: "retired" }), // a project the sidebar no longer names
  ];
  const { byProof, loose } = fold(ds, os);
  assert.deepEqual([...byProof.values(), ...loose].map((o) => o.id).sort(), os.map((o) => o.id).sort(), "every output exactly once");
  const rows = nodes(deliverablesTab(ds, os, START, order("alpha")).tree);
  const onScreen = rows.flatMap((r) => (r.node.t === "file" ? [r.node.o.id] : r.node.t === "proof" && r.node.output ? [r.node.output.id] : []));
  assert.deepEqual(onScreen.sort(), os.map((o) => o.id).sort(), "and every one is drawn once in the tree");
});

test("every past deliverable is in the tree, uncapped, withdrawn too", () => {
  const ds = Array.from({ length: 45 }, (_, i) => del({ id: `v-${String(i).padStart(2, "0")}`, state: (["approved", "changes", "withdrawn"] as const)[i % 3], updatedAt: i }));
  assert.deepEqual(delIds(deliverablesTab([...ds].reverse(), [], START).tree), ds.map((d) => d.id).reverse());
});

test("no filter or search drops an item that matches it, and a project with no match has no folder", () => {
  const ds = [
    del({ id: "v-1", project: "alpha", state: "approved", title: "Harbour lights rollout" }),
    del({ id: "v-2", project: "beta", state: "changes", summary: "The Lantern route needs a second pass" }),
    del({ id: "v-3", project: null, state: "withdrawn", points: ["Kite festival cache was cold"] }),
    del({ id: "v-4", project: "beta", state: "approved", title: "Kite festival map", updatedAt: 3 }),
  ];
  const os = [out({ id: "o-1", title: "Harbour photo", project: "alpha" }), out({ id: "o-2", title: "Map export", note: "kite festival draft", project: "beta" }), out({ id: "o-3", title: "Loose sketch", project: "gamma" })];
  const text = (d: D) => [d.title, d.summary, ...d.revisions.flatMap((r) => [r.summary, ...r.points.flatMap((p) => [p.headline, p.why])])].join(" ").toLowerCase();
  const otext = (o: O) => [o.title, o.note ?? "", o.path ?? ""].join(" ").toLowerCase();
  const hit = (t: string, q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
  for (const f of FILTERS) {
    for (const project of [ALL_PROJECTS, "alpha", "beta", "gamma", ""]) {
      for (const query of ["", "kite", "FESTIVAL kite", "lantern", "harbour", "second pass", "sketch", "zzz"]) {
        const tree = deliverablesTab(ds, os, { filter: f.id, project, query }, order("alpha", "beta", "gamma")).tree;
        const inP = (p: string | null) => project === ALL_PROJECTS || (p ?? "") === project;
        const wantDs = f.id === "files" ? [] : ds.filter((d) => (f.id === "all" || d.state === f.id) && inP(d.project) && hit(text(d), query));
        const wantOs = f.id === "all" || f.id === "files" ? os.filter((o) => inP(o.project) && hit(otext(o), query)) : [];
        const why = JSON.stringify({ filter: f.id, project, query });
        assert.deepEqual(delIds(tree).sort(), wantDs.map((d) => d.id).sort(), why);
        assert.deepEqual(fileIds(tree).sort(), wantOs.map((o) => o.id).sort(), why);
        const wantFolders = new Set([...wantDs.map((d) => d.project), ...wantOs.map((o) => o.project)]);
        assert.deepEqual(new Set(tree.map((p) => p.project)), wantFolders, `${why}: a folder for each project with a match, none other`);
        assert.ok(nodes(tree).every((r) => r.node.t !== "files" || r.node.children.length > 0), `${why}: no empty Files folder`);
      }
    }
  }
});

test("search reads the points a lead wrote, not only the title", () => {
  const d = del({ id: "v-pt", title: "Weekly sweep", points: ["Tidepool index rebuilt"] });
  assert.deepEqual(delIds(deliverablesTab([d], [], { ...START, query: "tidepool" }).tree), ["v-pt"]);
});

test("folders start closed, except a project with something in review; a filter or search opens the way to its matches", () => {
  const tab = deliverablesTab([del({ project: "alpha" }), del({ project: "beta" }), del({ project: "beta", state: "review" })], [out({ project: "alpha" })], START, order("alpha", "beta"));
  const [alpha, beta] = tab.tree;
  assert.equal(openByDefault(alpha!, false), false);
  assert.equal(openByDefault(beta!, false), true, "beta has an item in review");
  const files = alpha!.children.find((c) => c.t === "files")!;
  const d = alpha!.children.find((c) => c.t === "deliverable")!;
  assert.equal(openByDefault(files as Folder, false), false);
  assert.equal(openByDefault(alpha!, true) && openByDefault(files as Folder, true), true, "narrowed: projects and Files open");
  assert.equal(openByDefault(d as Folder, true), false, "a deliverable stays closed until asked");
  // with the defaults, only beta's children are drawn
  const rows = flatten(tab.tree, (f) => openByDefault(f, false));
  assert.deepEqual(rows.map((r) => r.node.key), ["p:alpha", "p:beta", ...beta!.children.map((c) => c.key)]);
  assert.ok(folderKeys(tab.tree).includes(files.key), "Expand all reaches the Files folder too");
});

test("the arrow keys walk the tree as a file explorer does; Enter opens a file or a folder", () => {
  const tab = deliverablesTab([del({ id: "v-x", proof: [{ path: "/w/a.png" }, { path: "/w/b.png" }] })], [], START);
  const closed = flatten(tab.tree, () => false);
  assert.deepEqual(treeKey(closed, "p:alpha", "ArrowRight"), { toggle: "p:alpha" }, "Right opens a closed folder");
  const open = flatten(tab.tree, () => true);
  const keys = open.map((r) => r.node.key); // p:alpha, d:v-x, f:v-x:v-x-p0, f:v-x:v-x-p1
  assert.deepEqual(treeKey(open, "p:alpha", "ArrowRight"), { focus: keys[1] }, "Right on an open folder goes to its first child");
  assert.deepEqual(treeKey(open, keys[2]!, "ArrowLeft"), { focus: "d:v-x" }, "Left on a file goes to its folder");
  assert.deepEqual(treeKey(open, "d:v-x", "ArrowLeft"), { toggle: "d:v-x" }, "Left on an open folder closes it");
  assert.deepEqual(treeKey(open, keys[3]!, "ArrowDown"), { focus: keys[3] }, "the end holds");
  assert.deepEqual(treeKey(open, "p:alpha", "ArrowUp"), { focus: "p:alpha" });
  assert.deepEqual(treeKey(open, keys[2]!, "Enter"), { activate: keys[2] }, "Enter opens a file");
  assert.deepEqual(treeKey(open, "d:v-x", "Enter"), { toggle: "d:v-x" });
  assert.equal(treeKey(open, "d:v-x", "j"), null, "J and K stay the page's keys");
});

test("the sidebar order is bb's section order, mapped to projects; unsectioned projects follow in placing order", () => {
  const sections = [
    { id: "s1", name: "Orchestrator" },
    { id: "s2", name: "Harbour Lights" },
    { id: "s3", name: "Kite Festival" },
  ];
  const place = ["kite-festival", "harbour-lights", "tidepool"]; // priority, then slug
  assert.deepEqual(sidebarOrder(place, sections, ["pinned", "section:s2", "section:s1", "section:s3", "threads"]), ["harbour-lights", "kite-festival", "tidepool"]);
  assert.deepEqual(sidebarOrder(place, sections, []), ["harbour-lights", "kite-festival", "tidepool"], "no preference: bb's listing order");
  // The Thread list plugin's answer is what the sidebar draws; bb's sidebar.* copy is a stale seed (live, 2026-11-16, it
  // still said "pinned, sections, threads" while the sidebar showed the owner's dragged order), so it must not be read.
  assert.deepEqual(manualSectionOrder({ preferences: { manualSectionOrder: ["pinned", "section:a", 3, "threads"] } }), ["pinned", "section:a", "threads"]);
  assert.deepEqual(manualSectionOrder({ preferences: { "sidebar.manualSectionOrder": ["section:b"] } }), [], "the stale bb copy is ignored");
  assert.deepEqual(manualSectionOrder(null), []);
});

test("a saved pane on the old Outputs tab opens Deliverables instead of throwing the owner's layout away", () => {
  const saved = { root: { kind: "split", id: "s", dir: "row", sizes: [0.5, 0.5], children: [{ kind: "pane", id: "a", view: "outputs" }, { kind: "pane", id: "b", view: "board" }] }, focus: "a" };
  const views = ["deliverables", "projects", "board"];
  assert.equal(parse(saved, views), null, "without the rename the split is lost");
  assert.deepEqual(panes(parse(saved, views, RENAMED_VIEWS)!.root).map((p) => p.view), ["deliverables", "board"]);
  assert.equal(RENAMED_VIEWS.agents, "projects", "the earlier rename still holds");
});

