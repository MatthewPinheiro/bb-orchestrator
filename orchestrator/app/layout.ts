// The Orchestrator page's own layout (2026-11-13: "we need to be able to split tabs ... I want it to be a
// dynamic layout for the plugin"; panes inside the page, since bb opens only threads as its own panes). A tree: a pane
// shows one view; a split lays its children side by side (row) or stacked (col) at their shares. Pure functions, so
// every change is a new tree and the tests cover the rules. Saved per viewer in the browser, never shared.

export type Pane = { kind: "pane"; id: string; view: string };
export type Split = { kind: "split"; id: string; dir: "row" | "col"; sizes: number[]; children: Node[] };
export type Node = Pane | Split;
export type Layout = { root: Node; focus: string };

/** Enough for a wide screen; more panes would each be too narrow to read. */
export const MAX_PANES = 4;
/** No pane shrinks below this share of its split. */
export const MIN_SHARE = 0.2;

let seq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const single = (view: string, id = "p0"): Layout => ({ root: { kind: "pane", id, view }, focus: id });

export function panes(n: Node): Pane[] {
  return n.kind === "pane" ? [n] : n.children.flatMap(panes);
}

export function findPane(l: Layout, id: string): Pane | null {
  return panes(l.root).find((p) => p.id === id) ?? null;
}

function map(n: Node, f: (n: Node) => Node): Node {
  const m = f(n);
  return m.kind === "split" ? { ...m, children: m.children.map((c) => map(c, f)) } : m;
}

export function setView(l: Layout, paneId: string, view: string): Layout {
  return { root: map(l.root, (n) => (n.kind === "pane" && n.id === paneId ? { ...n, view } : n)), focus: paneId };
}

/**
 * A new pane beside `paneId` (row: to its right; col: below it) showing `view`. Inside a split of the same direction it
 * becomes a sibling and the two share the old pane's room; otherwise the pane becomes a two-way split. At MAX_PANES
 * nothing changes. The new pane takes the focus.
 */
export function split(l: Layout, paneId: string, dir: "row" | "col", view: string): Layout {
  if (panes(l.root).length >= MAX_PANES || !findPane(l, paneId)) return l;
  const fresh: Pane = { kind: "pane", id: newId("p"), view };
  const walk = (n: Node): Node => {
    if (n.kind === "pane") return n.id === paneId ? { kind: "split", id: newId("s"), dir, sizes: [0.5, 0.5], children: [n, fresh] } : n;
    const i = n.children.findIndex((c) => c.kind === "pane" && c.id === paneId);
    if (i >= 0 && n.dir === dir) {
      const half = n.sizes[i]! / 2;
      const sizes = [...n.sizes.slice(0, i), half, half, ...n.sizes.slice(i + 1)];
      const children = [...n.children.slice(0, i + 1), fresh, ...n.children.slice(i + 1)];
      return { ...n, sizes, children };
    }
    return { ...n, children: n.children.map(walk) };
  };
  return { root: walk(l.root), focus: fresh.id };
}

/** Close a pane: its room goes to its neighbours, and a split left with one child gives way to it. The last pane stays. */
export function close(l: Layout, paneId: string): Layout {
  const all = panes(l.root);
  if (all.length <= 1 || !all.some((p) => p.id === paneId)) return l;
  const walk = (n: Node): Node | null => {
    if (n.kind === "pane") return n.id === paneId ? null : n;
    const kept: { c: Node; s: number }[] = [];
    n.children.forEach((c, i) => {
      const w = walk(c);
      if (w) kept.push({ c: w, s: n.sizes[i]! });
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0]!.c;
    const total = kept.reduce((a, k) => a + k.s, 0);
    return { ...n, children: kept.map((k) => k.c), sizes: kept.map((k) => k.s / total) };
  };
  const root = walk(l.root)!;
  const left = panes(root);
  const focus = left.some((p) => p.id === l.focus) ? l.focus : left[0]!.id;
  return { root, focus };
}

/** Move the divider after child `index` of split `splitId` by `delta` (a share of the split), keeping MIN_SHARE each side. */
export function resize(l: Layout, splitId: string, index: number, delta: number): Layout {
  return {
    ...l,
    root: map(l.root, (n) => {
      if (n.kind !== "split" || n.id !== splitId || index < 0 || index >= n.sizes.length - 1) return n;
      const a = n.sizes[index]!;
      const b = n.sizes[index + 1]!;
      const d = Math.max(MIN_SHARE - a, Math.min(b - MIN_SHARE, delta));
      const sizes = [...n.sizes];
      sizes[index] = a + d;
      sizes[index + 1] = b - d;
      return { ...n, sizes };
    }),
  };
}

/** A saved layout read back: anything malformed, or naming a view that no longer exists, gives null. */
/** projects/<slug> → the slug of the project page it opens; null for any other sub-path (or a bad escape). */
export function detailOf(subPath: string): string | null {
  const [view, slug] = subPath.split("/");
  if (view !== "projects" || !slug) return null;
  try {
    return decodeURIComponent(slug) || null;
  } catch {
    return null;
  }
}

/** The sub-path a pane on `view` puts in the URL: a project's page stays open as projects/<slug>. */
export function pathFor(viewSubPath: string, view: string, detail: string | null): string {
  return view === "projects" && detail ? `projects/${encodeURIComponent(detail)}` : viewSubPath;
}

/** `renamed`: views that went or moved (old id → new id), so a saved pane on one keeps its place. */
/** Tabs that went into another, by old id (links, saved layouts): Agents into Projects, Outputs into Deliverables (2026-11-16). */
export const RENAMED_VIEWS: Record<string, string> = { agents: "projects", outputs: "deliverables" };

export function parse(raw: unknown, views: readonly string[], renamed: Record<string, string> = {}): Layout | null {
  const ids = new Set<string>();
  const node = (n: unknown, depth: number): Node | null => {
    if (!n || typeof n !== "object" || depth > 6) return null;
    const o = n as Record<string, unknown>;
    if (typeof o.id !== "string" || ids.has(o.id)) return null;
    ids.add(o.id);
    if (o.kind === "pane") {
      const view = typeof o.view === "string" ? (Object.hasOwn(renamed, o.view) ? renamed[o.view]! : o.view) : null;
      return view !== null && views.includes(view) ? { kind: "pane", id: o.id, view } : null;
    }
    if (o.kind !== "split" || (o.dir !== "row" && o.dir !== "col") || !Array.isArray(o.children) || !Array.isArray(o.sizes)) return null;
    if (o.children.length < 2 || o.children.length !== o.sizes.length) return null;
    if (!o.sizes.every((s) => typeof s === "number" && s > 0 && Number.isFinite(s))) return null;
    const children = o.children.map((c) => node(c, depth + 1));
    if (children.some((c) => c === null)) return null;
    const total = (o.sizes as number[]).reduce((a, s) => a + s, 0);
    return { kind: "split", id: o.id, dir: o.dir, sizes: (o.sizes as number[]).map((s) => s / total), children: children as Node[] };
  };
  const r = raw as { root?: unknown; focus?: unknown } | null;
  const root = r ? node(r.root, 0) : null;
  if (!root || panes(root).length > MAX_PANES) return null;
  const focus = typeof r!.focus === "string" && ids.has(r!.focus) && panes(root).some((p) => p.id === r!.focus) ? r!.focus : panes(root)[0]!.id;
  return { root, focus };
}
