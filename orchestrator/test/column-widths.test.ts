// Resizable Open PRs columns (2026-11-18, the owner: "the columns aren't individually adjustable in width"). Each rule of
// column-widths.ts on the Open PRs table's own columns. Each test fails if its rule goes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MAX_WIDTH, REF_BOX, clampWidth, freeze, loadShares, loadWidths, parseShares, parseWidths, resizeFrom, saveShares, saveWidths, scaleCols, tableLayout, toPx, toShares, type ColumnSpec, type Shares, type Widths } from "../app/column-widths.ts";
import { GROUPS_KEY, groupPrs, loadCollapsed, saveCollapsed } from "../app/pr-groups.ts";
import { sortPrs } from "../core/open-prs.ts";

const COLS: ColumnSpec[] = [
  { id: "title", label: "Title", width: null, min: 160 },
  { id: "pr", label: "PR", width: 128, min: 64 },
  { id: "state", label: "State", width: 176, min: 72 },
];

test("untouched, the table looks as before: Title fills what the others leave, and never goes below its minimum", () => {
  const l = tableLayout(COLS, {});
  assert.deepEqual(l.cols, [null, 128, 176]);
  assert.equal(l.filler, false);
  assert.equal(l.span, 3);
  assert.deepEqual(l.style, { width: "100%", minWidth: 160 + 128 + 176 });
});

test("dragging one column sizes that column alone: the others keep their widths", () => {
  const l = tableLayout(COLS, { pr: 300 });
  assert.deepEqual(l.cols, [null, 300, 176]);
});

test("once every column has a width, the table is their sum and a filler takes the rest, so no column stretches away from the pointer", () => {
  const l = tableLayout(COLS, { title: 200 });
  assert.deepEqual(l.cols, [200, 128, 176]);
  assert.equal(l.filler, true);
  // the expanded row's colSpan must cover the filler too, or it lays out one column short
  assert.equal(l.span, 4);
  assert.deepEqual(l.style, { width: 200 + 128 + 176, minWidth: "100%" });
});

test("a width never goes below the column's minimum or above the cap, and is whole pixels", () => {
  assert.equal(clampWidth(COLS[1]!, 10), 64);
  assert.equal(clampWidth(COLS[1]!, 99999), MAX_WIDTH);
  assert.equal(clampWidth(COLS[1]!, 100.6), 101);
});

test("stored widths: unknown columns, non-numbers and malformed text are dropped, never shown", () => {
  assert.deepEqual(parseWidths('{"pr":200,"gone":50,"state":"wide","title":null}', COLS), { pr: 200 });
  assert.deepEqual(parseWidths('{"pr":1}', COLS), { pr: 64 });
  assert.deepEqual(parseWidths("not json", COLS), {});
  assert.deepEqual(parseWidths("[1,2]", COLS), {});
  assert.deepEqual(parseWidths(null, COLS), {});
});

test("blocked storage gives the defaults and never throws; a save round-trips, and resetting every column removes the key", () => {
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.deepEqual(loadWidths("k", COLS, blocked), {});
  assert.doesNotThrow(() => saveWidths("k", { pr: 200 }, blocked));
  assert.deepEqual(loadWidths("k", COLS, null), {});

  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  saveWidths("k", { pr: 200, title: 300 }, store);
  assert.deepEqual(loadWidths("k", COLS, store), { pr: 200, title: 300 });
  saveWidths("k", {}, store);
  assert.equal(m.has("k"), false);
});

test("the Open PRs table: every column has a labelled handle, and the expanded row spans the drawn columns, not a fixed 6", () => {
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  assert.match(src, /<ColHandle \{\.\.\.handle\(c\)\} \/>/);
  assert.match(src, /PR_COLS\.map\(\(c\) => \(\s*<TableHead/);
  assert.match(src, /colSpan=\{span\}/);
  assert.doesNotMatch(src, /colSpan=\{6\}/);
  const hook = readFileSync(new URL("../app/column-widths.ts", import.meta.url), "utf8");
  assert.match(hook, /"aria-label": `Resize \$\{c\.label\} column`/);
  assert.match(hook, /onPointerDown/);
  assert.doesNotMatch(hook, /onMouse(Down|Move|Up)|onTouch/);
});

// The Open PRs columns (app/open-prs.tsx PR_COLS) and the tab's widest box.
const PR_COLS: ColumnSpec[] = [
  { id: "title", label: "Title", width: null, min: 160 },
  { id: "pr", label: "PR", width: 128, min: 64 },
  { id: "state", label: "State", width: 176, min: 72 },
  { id: "ci", label: "CI", width: 112, min: 56 },
  { id: "reviewers", label: "Reviewers", width: 160, min: 72 },
  { id: "updated", label: "Updated", width: 96, min: 64 },
];
const BOX = 1022;

/** Where each column's edges are drawn, as a browser lays out tableLayout's fixed table in a box BOX px wide. */
function draw(cols: ColumnSpec[], widths: Widths, box = BOX) {
  const l = tableLayout(cols, widths);
  const fixed = l.cols.reduce<number>((s, w) => s + (w ?? 0), 0);
  const fills = l.cols.filter((w) => w === null).length;
  const tableW = l.filler ? Math.max(box, fixed) : Math.max(box, l.style.minWidth as number);
  const fillW = fills ? (tableW - fixed) / fills : 0;
  const edges: Record<string, { left: number; right: number }> = {};
  let x = 0;
  cols.forEach((c, i) => {
    const w = l.cols[i] ?? fillW;
    edges[c.id] = { left: x, right: x + w };
    x += w;
  });
  return edges;
}
const widthsOf = (e: ReturnType<typeof draw>) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v.right - v.left]));

test("a drag's right edge follows the pointer: +N px moves the handle +N, and every column to its left stays put", () => {
  // the owner (2026-11-18): "if i drag, it opens up in the opposite direction versus following the direction that i'm
  // dragging". Widening PR took the width from Title on its left, so PR's handle stayed put and its left edge moved.
  for (const id of ["title", "pr", "state", "updated"])
    for (const dx of [60, -30]) {
      const before = draw(PR_COLS, {});
      const drawn = widthsOf(before);
      const after = draw(PR_COLS, resizeFrom(PR_COLS, {}, drawn, id, drawn[id]!, dx));
      assert.equal(after[id]!.right - before[id]!.right, dx, `${id} ${dx}: handle moved ${after[id]!.right - before[id]!.right}`);
      for (const c of PR_COLS.slice(0, PR_COLS.findIndex((x) => x.id === id) + 1).slice(0, -1)) assert.deepEqual(after[c.id], before[c.id], `${id} ${dx}: ${c.id} moved`);
      assert.equal(after[id]!.left, before[id]!.left, `${id} ${dx}: its own left edge moved`);
    }
});

test("drags compose: a second drag on another column moves only that column's right edge", () => {
  const d0 = widthsOf(draw(PR_COLS, {}));
  const w1 = resizeFrom(PR_COLS, {}, d0, "state", d0.state!, 40);
  const e1 = draw(PR_COLS, w1);
  const w2 = resizeFrom(PR_COLS, w1, widthsOf(e1), "pr", widthsOf(e1).pr!, -24);
  const e2 = draw(PR_COLS, w2);
  assert.equal(e2.pr!.right - e1.pr!.right, -24);
  assert.deepEqual(e2.title, e1.title);
  assert.equal(e2.state!.right - e2.state!.left, e1.state!.right - e1.state!.left);
});

test("freezing keeps the drawn layout: every column not set is pinned at its drawn width, a set one is left alone", () => {
  // every column, not only the filling one: a resized layout is then all shares of the box, so it scales as one at
  // another width (a default left unpinned grows on its own rule and would push the resized ones out of the box)
  const drawn = widthsOf(draw(PR_COLS, { pr: 200 }));
  const f = freeze(PR_COLS, { pr: 200 }, drawn);
  assert.deepEqual(f, { pr: 200, title: Math.round(drawn.title!), state: 176, ci: 112, reviewers: 160, updated: 96 });
  assert.deepEqual(widthsOf(draw(PR_COLS, f)), drawn);
});

test("a drag past a column's minimum stops at the minimum", () => {
  const drawn = widthsOf(draw(PR_COLS, {}));
  assert.equal(resizeFrom(PR_COLS, {}, drawn, "updated", 96, -80).updated, 64);
});

test("a drag that starts scrolled holds the table at the scrolled view's width, so narrowing a column never pulls the scroll back", () => {
  // Updated widened past the box and scrolled into view (scrollLeft 60 in a 1022 px box): narrowing it by 60 would make
  // the table 1022 px, the browser would clamp the scroll to 0, and the table would slide 60 px right under the pointer.
  const w = { title: 350, updated: 96 };
  const sum = 350 + 128 + 176 + 112 + 160 + 96;
  assert.equal(tableLayout(PR_COLS, w).style.width, sum);
  assert.equal(tableLayout(PR_COLS, w, 60 + BOX).style.width, 60 + BOX);
  // never narrower than the columns: a hold below their sum changes nothing
  assert.equal(tableLayout(PR_COLS, { ...w, updated: 300 }, 60 + BOX).style.width, sum - 96 + 300);
});

// ---------------------------------------------------------------- the table fills the tab (2026-11-18, the owner)
// "make the table respond to screen width: on a wider screen it fills more of the space, so the columns get more room.
// Column widths should still work when resized at any width and on a narrow screen." Today's box (the tab capped at
// 1024 px, less the border) is REF_BOX: there every column is as before. Wider, every default grows in proportion;
// a resized layout is kept as shares of the box, so it scales as one, both ways.

/** The layout drawn in a box `box` px wide, from stored shares, as the hook draws it: each column's edges and the table's width. */
function drawAt(box: number, shares: Shares = {}) {
  const specs = scaleCols(PR_COLS, box);
  const px = toPx(PR_COLS, shares, box);
  const l = tableLayout(specs, px);
  const fixed = l.cols.reduce<number>((s, w) => s + (w ?? 0), 0);
  const fills = l.cols.filter((w) => w === null).length;
  const tableW = l.filler ? Math.max(box, fixed) : Math.max(box, l.style.minWidth as number);
  const fillW = fills ? (tableW - fixed) / fills : 0;
  const edges: Record<string, { left: number; right: number }> = {};
  let x = 0;
  PR_COLS.forEach((c, i) => {
    const w = l.cols[i] ?? fillW;
    edges[c.id] = { left: x, right: x + w };
    x += w;
  });
  return { edges, tableW, px, specs, layout: l };
}
/** A drag of `dx` on `id` in a box `box` px wide, from `shares`, through the hook's own steps; the shares it keeps. */
function dragAt(box: number, shares: Shares, id: string, dx: number): Shares {
  const { edges, specs, px } = drawAt(box, shares);
  const drawn = widthsOf(edges);
  return toShares(resizeFrom(specs, px, drawn, id, drawn[id]!, dx), box);
}
const BOXES = [878, 900, 1022, 1180, 1330, 1680, 2200, 2400];

test("untouched, every column grows with the tab past today's box, in proportion, and the table fills the tab", () => {
  assert.equal(REF_BOX, 1022, "today's box: the tab's old 1024 px cap less its border");
  const today = drawAt(REF_BOX);
  assert.deepEqual(widthsOf(today.edges), { title: 350, pr: 128, state: 176, ci: 112, reviewers: 160, updated: 96 }, "at today's box, as before");
  const wide = drawAt(1400);
  assert.equal(wide.tableW, 1400, "the table is the tab's whole width");
  for (const c of PR_COLS) {
    const was = today.edges[c.id]!.right - today.edges[c.id]!.left;
    const now = wide.edges[c.id]!.right - wide.edges[c.id]!.left;
    assert.ok(now > was, `${c.id} gets more room (${was} → ${now}), not only Title`);
    assert.ok(Math.abs(now / was - 1400 / REF_BOX) < 0.01, `${c.id} grows in proportion (${(now / was).toFixed(3)})`);
  }
  // below today's box (down to the cards' cutoff) nothing changes but Title, as before
  assert.deepEqual(drawAt(900).layout.cols, [null, 128, 176, 112, 160, 96]);
  for (const box of BOXES) assert.equal(drawAt(box).tableW, box, `${box}: fills the box, no sideways scroll`);
});

test("a layout resized at one width stays valid at a narrower and a wider one: same shares, no overlap, every handle reachable", () => {
  // the owner resizes at 1680 (a 1330 px box), then the window goes to 1280 and to 2560
  const at = 1330;
  // narrowed: the filler takes the rest, and every handle stays in the box at any width
  // widened: the table was wider than the box there (no other column moves), so it is wider by the same share at any
  // width, and scrolls inside its box, never the page
  for (const [id, dx] of [["title", -120], ["pr", 120]] as const) {
    const s = dragAt(at, {}, id, dx);
    assert.deepEqual(Object.keys(s).sort(), PR_COLS.map((c) => c.id).sort(), "the first resize pins every column");
    const there = drawAt(at, s);
    const sum = (d: ReturnType<typeof drawAt>) => Object.values(d.px).reduce((a, b) => a + b, 0);
    for (const box of [900, 2200]) {
      const d = drawAt(box, s);
      let right = 0;
      for (const c of PR_COLS) {
        const e = d.edges[c.id]!;
        assert.ok(e.left >= right - 1e-9, `${id} ${dx} at ${box}: ${c.id} overlaps the column before it`);
        assert.ok(e.right - e.left >= c.min, `${id} ${dx} at ${box}: ${c.id} under its minimum`);
        assert.ok(e.right <= d.tableW, `${id} ${dx} at ${box}: ${c.id}'s handle is off the table`);
        if (dx < 0) assert.ok(e.right <= box, `${id} ${dx} at ${box}: ${c.id}'s handle is out of the box (${e.right})`);
        right = e.right;
        // the owner's resize keeps its meaning: each column is the same share of the box it had
        const share = (there.edges[c.id]!.right - there.edges[c.id]!.left) / at;
        assert.ok(Math.abs((e.right - e.left) / box - share) < 1.5 / box, `${id} ${dx} at ${box}: ${c.id} kept its share`);
      }
      assert.ok(Math.abs(sum(d) / box - sum(there) / at) < 6 / box, `${id} ${dx} at ${box}: the table is the same share of the box`);
      assert.equal(d.layout.filler, true);
      assert.equal(d.tableW, Math.max(box, sum(d)), `${id} ${dx} at ${box}: the table is the columns' sum, at least the box`);
      if (dx < 0) assert.equal(d.tableW, box, `${id} ${dx} at ${box}: fits the box`);
    }
  }
});

test("shares never round past the box, and a drag's right edge follows the pointer at any width", () => {
  // six rounded widths could add up to a few px more than the box: a sideways scroll from nothing
  const full: Shares = { title: 0.3, pr: 0.15, state: 0.17, ci: 0.11, reviewers: 0.16, updated: 0.11 };
  for (let box = 878; box <= 2400; box += 7) {
    const px = toPx(PR_COLS, full, box);
    assert.ok(Object.values(px).reduce((a, b) => a + b, 0) <= box, `${box}: the widths overflow the box`);
  }
  for (const box of [REF_BOX, 1680, 2200])
    for (const id of ["title", "pr", "reviewers", "updated"])
      for (const dx of [48, -24]) {
        const before = drawAt(box).edges;
        const after = drawAt(box, dragAt(box, {}, id, dx)).edges;
        assert.equal(after[id]!.right - before[id]!.right, dx, `${box} ${id} ${dx}: the handle moved ${after[id]!.right - before[id]!.right}`);
        for (const c of PR_COLS.slice(0, PR_COLS.findIndex((x) => x.id === id))) assert.deepEqual(after[c.id], before[c.id], `${box} ${id} ${dx}: ${c.id} moved`);
      }
});

test("minimums hold at every width: a column narrowed to its minimum on a wide screen stays at it on a narrow one", () => {
  const s = dragAt(2200, {}, "updated", -1000);
  assert.equal(drawAt(2200, s).px.updated, 64);
  for (const box of BOXES) for (const c of PR_COLS) assert.ok(drawAt(box, s).px[c.id]! >= c.min, `${box}: ${c.id} under its minimum`);
  assert.equal(toPx(PR_COLS, { title: 0.0001 }, 900).title, 160, "a tiny share is drawn at the minimum");
});

test("in a 900 px box, and the 878 px narrowest table, no column drops below its minimum and nothing overlaps, resized or not", () => {
  // below today's box the untouched table is as before (Title gives way, down to its minimum); a resized one scales
  // down as shares. Either way every column keeps its minimum and its left edge is the column before's right edge.
  const layouts: [string, Shares][] = [
    ["untouched", {}],
    ["PR widened at 1680", dragAt(1330, {}, "pr", 120)],
    ["Title narrowed at 1680", dragAt(1330, {}, "title", -120)],
    ["Updated at its minimum on a 2560 window", dragAt(2200, {}, "updated", -1000)],
    ["every column dragged to its minimum", PR_COLS.reduce<Shares>((s, c) => dragAt(2200, s, c.id, -2000), {})],
    ["Title dragged past its minimum here", dragAt(900, {}, "title", -400)],
  ];
  for (const box of [900, 878])
    for (const [name, s] of layouts) {
      const d = drawAt(box, s);
      let right = 0;
      for (const c of PR_COLS) {
        const e = d.edges[c.id]!;
        assert.ok(Math.abs(e.left - right) < 1e-6, `${box} ${name}: ${c.id} overlaps or leaves a gap (${e.left} after ${right})`);
        assert.ok(e.right - e.left >= c.min, `${box} ${name}: ${c.id} ${e.right - e.left} under its minimum ${c.min}`);
        right = e.right;
      }
      assert.ok(right <= d.tableW + 1e-6, `${box} ${name}: the last handle is off the table`);
    }
  assert.equal(widthsOf(drawAt(900).edges).title, 900 - (128 + 176 + 112 + 160 + 96), "untouched at 900: Title gives way, the rest as today");
});

test("stored widths: the v1 px value is read once as shares of today's box, and junk never crashes", () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  // what the first version of this change kept: px, in a box that was never wider than today's
  m.set("v1", JSON.stringify({ title: 300, pr: 200 }));
  const s = loadShares("v2", PR_COLS, "v1", store);
  assert.deepEqual(toPx(PR_COLS, s, REF_BOX), { title: 300, pr: 200 }, "at today's box, exactly the old widths");
  saveShares("v2", s, "v1", store);
  assert.equal(m.has("v1"), false, "the old key goes on the first save, so a later reset can't bring it back");
  assert.deepEqual(loadShares("v2", PR_COLS, "v1", store), s);
  saveShares("v2", {}, "v1", store);
  assert.equal(m.has("v2"), false);
  assert.deepEqual(loadShares("v2", PR_COLS, "v1", store), {}, "every column reset: the defaults");
  for (const junk of ["not json", "[0.2]", "null", '"x"', '{"pr":"wide","state":-1,"ci":null,"title":1e308,"gone":0.2}', '{"pr":0.2}']) {
    m.clear();
    m.set("v2", junk);
    assert.doesNotThrow(() => drawAt(1330, loadShares("v2", PR_COLS, "v1", store)), junk);
  }
  assert.deepEqual(parseShares('{"pr":0.2,"state":-1,"ci":"x","title":9,"gone":0.1}', PR_COLS), { pr: 0.2 });
  m.clear();
  m.set("v1", "{oops");
  assert.deepEqual(loadShares("v2", PR_COLS, "v1", store), {});
  const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }, removeItem: () => { throw new Error("SecurityError"); } };
  assert.deepEqual(loadShares("v2", PR_COLS, "v1", blocked), {});
  assert.doesNotThrow(() => saveShares("v2", { pr: 0.2 }, "v1", blocked));
});

test("the Open PRs tab is no longer capped at today's width, and its widths are kept under a new key", () => {
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  const view = src.slice(src.indexOf("export function OpenPrsView("), src.indexOf("function OpenPrsBody("));
  assert.ok(view.length > 100, "the view is found");
  assert.doesNotMatch(view, /max-w-5xl/, "a wider screen gets a wider table");
  assert.match(src, /const COLS_KEY = "orchestrator\.open-prs\.columns\.v2"/);
  assert.match(src, /const OLD_COLS_KEY = "orchestrator\.open-prs\.columns\.v1"/);
  // the box the shares are of is measured: the table box itself
  assert.match(src, /ref=\{boxRef\}[^>]*data-prs-table=""/);
});

// ---------------------------------------------------------------- PRs grouped by project (2026-11-18, the owner)
// "easy to see which project each PR belongs to and what it's for": one group per project, from the project each PR
// already carries (the agent its PR watch or a lead's branch matched, open-prs/server.ts), never a guess.

const ago = (h: number) => new Date(Date.UTC(2026, 10, 18, 12) - h * 3600_000).toISOString();
const pr = (n: number, project: string | null, o: Partial<{ ci: "pass" | "pending" | "fail" | "none"; h: number; title: string; repo: string }> = {}) => ({
  url: `https://github.com/acme-co/widgets/pull/${n}`,
  number: n,
  title: o.title ?? `PR ${n}`,
  repo: o.repo ?? "acme-co/widgets",
  project,
  approved: false,
  review: "review required",
  ci: o.ci ?? "pass",
  updatedAt: ago(o.h ?? n),
});

test("grouping: each PR lands in its project's group by its project alone, no-project PRs in Unassigned, last", () => {
  const prs = [
    pr(1, "vm-storage"),
    pr(2, null, { title: "edge-cli: fix the flag", repo: "acme-co/edge-cli" }), // names a project, but carries none
    pr(3, "edge-cli"),
    pr(4, "qa-suite"),
    pr(5, "edge-cli"),
    pr(6, null),
  ];
  const g = groupPrs(prs);
  assert.deepEqual(g.map((x) => x.key), ["edge-cli", "qa-suite", "vm-storage", null], "by name, Unassigned last");
  assert.deepEqual(g.map((x) => x.name), ["Edge Cli", "QA Suite", "Vm Storage", "Unassigned"]);
  assert.deepEqual(g.map((x) => x.prs.map((p) => p.number)), [[3, 5], [4], [1], [2, 6]], "no matching by title or repo");
  assert.deepEqual(g.map((x) => x.prs.length), [2, 1, 1, 2], "the counts");
  assert.equal(g.reduce((s, x) => s + x.prs.length, 0), prs.length, "every PR once");
  assert.deepEqual(groupPrs([pr(1, "edge-cli")]).map((x) => x.key), ["edge-cli"], "no empty Unassigned group");
  assert.deepEqual(groupPrs([pr(1, "")]).map((x) => x.key), [null], "an empty project is no project");
});

test("grouping: inside each group the PRs keep the sort the owner picked", () => {
  const prs = [pr(1, "edge-cli", { ci: "pass", h: 1 }), pr(2, "vm-storage", { ci: "fail", h: 2 }), pr(3, "edge-cli", { ci: "fail", h: 3 }), pr(4, "edge-cli", { ci: "pending", h: 4 }), pr(5, "vm-storage", { ci: "pass", h: 5 })];
  for (const [key, desc] of [["updated", true], ["updated", false], ["ci", false], ["project", false]] as const) {
    const sorted = sortPrs(prs, key, desc);
    for (const g of groupPrs(sorted)) {
      const order = sorted.filter((p) => p.project === g.key).map((p) => p.number);
      assert.deepEqual(g.prs.map((p) => p.number), order, `${key} ${desc ? "desc" : "asc"}: ${g.key}`);
    }
  }
  assert.deepEqual(groupPrs(sortPrs(prs, "ci", false))[0]!.prs.map((p) => p.number), [3, 4, 1], "CI failing first, within edge-cli");
});

test("grouping: collapsed groups are kept per viewer and survive a reload; blocked storage means all open", () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  assert.deepEqual([...loadCollapsed(GROUPS_KEY, store)], [], "all open at first");
  saveCollapsed(GROUPS_KEY, new Set(["edge-cli", null]), store);
  // a reload: a fresh read of the same storage
  const back = loadCollapsed(GROUPS_KEY, store);
  assert.equal(back.has("edge-cli"), true);
  assert.equal(back.has(null), true, "Unassigned is its own key, never a project's slug");
  assert.equal(back.has("unassigned"), false);
  assert.equal(back.size, 2);
  assert.equal(GROUPS_KEY, "orchestrator.open-prs.groups.v1");
  for (const junk of ["{oops", "{}", '"edge-cli"', "[1,{},true]"]) {
    m.set(GROUPS_KEY, junk);
    assert.deepEqual([...loadCollapsed(GROUPS_KEY, store)], [], junk);
  }
  const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }, removeItem: () => { throw new Error("SecurityError"); } };
  assert.deepEqual([...loadCollapsed(GROUPS_KEY, blocked)], []);
  assert.doesNotThrow(() => saveCollapsed(GROUPS_KEY, new Set(["edge-cli"]), blocked));
});

test("grouping in the page: group rows sit in the one table and span its drawn columns; the cards are grouped too", () => {
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  const list = src.slice(src.indexOf("function PrList("), src.indexOf("async function copy("));
  assert.ok(list.length > 200, "the list is found");
  assert.equal(list.match(/<Table /g)?.length, 1, "one table: the columns and handles line up across the groups");
  assert.match(src, /function GroupRow\([\s\S]*?colSpan=\{span\}/, "a group's header row spans the drawn columns");
  assert.match(list, /groupPrs\(rows\)/, "the groups come from the sorted rows");
  assert.match(list, /<GroupRow [\s\S]*<PrRow [\s\S]*<GroupHead [\s\S]*<PrCard /, "rows and cards both");
  assert.match(src, /aria-expanded=\{open\}[^>]*data-group-toggle=""/, "a group's toggle says whether it is open");
});
