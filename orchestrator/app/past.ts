// The Deliverables tab's model, as pure functions (no React), so its promises are tested in node. Requested 2026-11-16:
// "combine the deliverables and outputs tab into one so people can go look back and see past deliverables easily", then
// "organize the All subtab by project" and "it should have the folder style view and hierarchy".
// - What waits for the owner (in review) is always first, newest first, as cards; filters and search never touch it.
// - Below, a tree: project folders in the sidebar's section order (core/project-order.ts), each holding its past
//   deliverables (approved, changes requested, withdrawn), newest first, each holding the proof files of the revision it
//   shows; and a "Files" folder with the project's outputs that never became proof, newest first.
// - An output that is proof on a deliverable's shown revision (same project, same file or link) is that proof row; every
//   other output is in Files. No output is dropped, none is listed twice.
// - Filters and search prune the tree: an empty folder is not drawn, and the folders on the way to a match open.
import type { Deliverables, Outputs, ProjectOrder } from "../contract.ts";

type Deliverable = Deliverables[number];
type Output = Outputs[number];
type Proof = Deliverable["revisions"][number]["proof"][number];

export type Filter = "all" | "approved" | "changes" | "withdrawn" | "files";
export const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "approved", label: "Approved" },
  { id: "changes", label: "Changes requested" },
  { id: "withdrawn", label: "Withdrawn" },
  { id: "files", label: "Files" },
];
/** The project filter's "every project"; "" is the no-project group. */
export const ALL_PROJECTS = "*";
const projectKey = (p: string | null) => p ?? "";

export type ProofNode = { t: "proof"; key: string; p: Proof; output: Output | null };
export type DeliverableNode = { t: "deliverable"; key: string; d: Deliverable; children: ProofNode[] };
export type FileNode = { t: "file"; key: string; o: Output };
export type FilesNode = { t: "files"; key: string; project: string | null; children: FileNode[] };
export type ProjectNode = { t: "project"; key: string; project: string | null; monType: string | null; review: number; at: number; children: (DeliverableNode | FilesNode)[] };
export type Node = ProjectNode | DeliverableNode | FilesNode | ProofNode | FileNode;
export type Folder = ProjectNode | DeliverableNode | FilesNode;
export const isFolder = (n: Node): n is Folder => n.t === "project" || n.t === "deliverable" || n.t === "files";

/** The revision a deliverable shows: its current one, else its last. */
export const shownRevision = (d: Deliverable) => d.revisions.find((r) => r.rev === d.rev) ?? d.revisions[d.revisions.length - 1];

const byUpdated = (a: Deliverable, b: Deliverable) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1);
const byAt = (a: Output, b: Output) => b.at - a.at || (a.id < b.id ? 1 : -1);

/**
 * Each output either is a proof item on a deliverable's shown revision (same project, same file path or link) or is
 * loose. Paths are realpaths and links normalised on both sides (engine.ts), so equal strings are one file. An output
 * proving two deliverables goes to the newest.
 */
export function fold(ds: readonly Deliverable[], os: readonly Output[]): { byProof: Map<string, Output>; byDeliverable: Map<string, Output[]>; loose: Output[] } {
  const owner = new Map<string, { d: string; proof: string }>();
  for (const d of [...ds].sort(byUpdated)) {
    for (const p of shownRevision(d)?.proof ?? []) {
      const where = p.path ?? p.url;
      const k = `${projectKey(d.project)}\0${where}`;
      if (where && !owner.has(k)) owner.set(k, { d: d.id, proof: p.id });
    }
  }
  const byProof = new Map<string, Output>();
  const byDeliverable = new Map<string, Output[]>();
  const loose: Output[] = [];
  for (const o of os) {
    const where = o.path ?? o.url;
    const hit = where ? owner.get(`${projectKey(o.project)}\0${where}`) : undefined;
    if (hit && !byProof.has(hit.proof)) {
      byProof.set(hit.proof, o);
      byDeliverable.set(hit.d, [...(byDeliverable.get(hit.d) ?? []), o]);
    } else loose.push(o);
  }
  return { byProof, byDeliverable, loose };
}

/** Every word of the query, in any order and case, somewhere in the text. */
function matches(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** What search reads on a deliverable: its title, every revision's summary, and its points (headline and why). */
export const deliverableText = (d: Deliverable) =>
  [d.title, d.summary, ...d.revisions.flatMap((r) => [r.summary, ...r.points.flatMap((p) => [p.headline, p.why])])].join("\n");
/** What search reads on a file: its title, note and file name or link. */
export const fileText = (o: Output) => [o.title, o.note ?? "", o.path ?? "", o.url ?? ""].join("\n");

export type View = { filter: Filter; project: string; query: string };
export const START: View = { filter: "all", project: ALL_PROJECTS, query: "" };
/** A filter or a search narrows the tree: its folders then open on the way to what matches. */
export const narrowed = (v: View) => v.filter !== "all" || v.project !== ALL_PROJECTS || v.query.trim() !== "";

export type Tab = {
  /** In review, newest first, with the outputs that are their proof: the cards on top. */
  review: { d: Deliverable; outputs: Output[] }[];
  tree: ProjectNode[];
  /** Per filter, how many match the project and search. */
  counts: Record<Filter, number>;
  /** Every project with something in the tree, in tree order; null is "No project". */
  projects: (string | null)[];
};

/**
 * The tab: the review cards, then the tree. `order`: the sidebar's project order with each accent type; a project it
 * doesn't name (a deleted one) comes after, by name, and "No project" last.
 */
export function deliverablesTab(ds: readonly Deliverable[], os: readonly Output[], v: View, order: ProjectOrder = []): Tab {
  const { byProof, byDeliverable, loose } = fold(ds, os);
  const sorted = [...ds].sort(byUpdated);
  const review = sorted.filter((d) => d.state === "review").map((d) => ({ d, outputs: byDeliverable.get(d.id) ?? [] }));
  const inProject = (p: string | null) => v.project === ALL_PROJECTS || projectKey(p) === v.project;
  const past = sorted.filter((d) => d.state !== "review" && inProject(d.project) && matches(deliverableText(d), v.query));
  const files = [...loose].sort(byAt).filter((o) => inProject(o.project) && matches(fileText(o), v.query));
  const counts: Record<Filter, number> = {
    all: past.length,
    approved: past.filter((d) => d.state === "approved").length,
    changes: past.filter((d) => d.state === "changes").length,
    withdrawn: past.filter((d) => d.state === "withdrawn").length,
    files: files.length,
  };
  const shownPast = v.filter === "files" ? [] : past.filter((d) => v.filter === "all" || d.state === v.filter);
  const shownFiles = v.filter === "all" || v.filter === "files" ? files : [];

  const rank = new Map(order.map((p, i) => [p.slug, i] as const));
  const typeOf = new Map(order.map((p) => [p.slug, p.monType] as const));
  const reviewIn = new Map<string, number>();
  for (const r of review) reviewIn.set(projectKey(r.d.project), (reviewIn.get(projectKey(r.d.project)) ?? 0) + 1);
  const folders = new Map<string, ProjectNode>();
  const folder = (project: string | null) => {
    const k = projectKey(project);
    let f = folders.get(k);
    if (!f) folders.set(k, (f = { t: "project", key: `p:${k}`, project, monType: project ? (typeOf.get(project) ?? null) : null, review: reviewIn.get(k) ?? 0, at: 0, children: [] }));
    return f;
  };
  for (const d of shownPast) {
    const f = folder(d.project);
    f.at = Math.max(f.at, d.updatedAt);
    const proof = (shownRevision(d)?.proof ?? []).map((p): ProofNode => ({ t: "proof", key: `f:${d.id}:${p.id}`, p, output: byProof.get(p.id) ?? null }));
    f.children.push({ t: "deliverable", key: `d:${d.id}`, d, children: proof });
  }
  for (const o of shownFiles) {
    const f = folder(o.project);
    f.at = Math.max(f.at, o.at);
    let box = f.children.find((c): c is FilesNode => c.t === "files");
    if (!box) f.children.push((box = { t: "files", key: `F:${projectKey(o.project)}`, project: o.project, children: [] }));
    box.children.push({ t: "file", key: `o:${o.id}`, o });
  }
  const place = (p: ProjectNode) => (p.project === null ? [2, 0, ""] : rank.has(p.project) ? [0, rank.get(p.project)!, ""] : [1, 0, p.project]) as [number, number, string];
  const tree = [...folders.values()].sort((a, b) => {
    const [x, y] = [place(a), place(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
  });
  return { review, tree, counts, projects: tree.map((p) => p.project) };
}

/** Closed unless: a project with something in review, or any project or Files folder while the tree is narrowed. */
export function openByDefault(n: Folder, narrow: boolean): boolean {
  if (n.t === "project") return narrow || n.review > 0;
  if (n.t === "files") return narrow;
  return false;
}

export type Row = { node: Node; level: number; parent: string | null; open: boolean | null };

/** The rows drawn, top to bottom: a folder's children only when it is open. `open` is null on a file. */
export function flatten(tree: readonly ProjectNode[], isOpen: (n: Folder) => boolean): Row[] {
  const rows: Row[] = [];
  const walk = (n: Node, level: number, parent: string | null) => {
    const open = isFolder(n) ? isOpen(n) : null;
    rows.push({ node: n, level, parent, open });
    if (open && isFolder(n)) for (const c of n.children) walk(c, level + 1, n.key);
  };
  for (const p of tree) walk(p, 0, null);
  return rows;
}

/** Every folder's key, for Expand all and Collapse all. */
export function folderKeys(tree: readonly ProjectNode[]): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (!isFolder(n)) return;
    out.push(n.key);
    for (const c of n.children) walk(c);
  };
  for (const p of tree) walk(p);
  return out;
}

export type TreeMove = { focus?: string; toggle?: string; activate?: string };

/**
 * A key on the tree, as a file explorer reads it: Down and Up move; Right opens a closed folder, else goes to its first
 * child; Left closes an open folder, else goes to the parent; Home and End go to the ends; Enter opens a file and opens or
 * closes a folder. Null: not the tree's key.
 */
export function treeKey(rows: readonly Row[], focus: string | null, key: string): TreeMove | null {
  if (rows.length === 0) return null;
  const at = Math.max(0, rows.findIndex((r) => r.node.key === focus));
  const row = rows[at]!;
  switch (key) {
    case "ArrowDown":
      return { focus: rows[Math.min(at + 1, rows.length - 1)]!.node.key };
    case "ArrowUp":
      return { focus: rows[Math.max(at - 1, 0)]!.node.key };
    case "Home":
      return { focus: rows[0]!.node.key };
    case "End":
      return { focus: rows[rows.length - 1]!.node.key };
    case "ArrowRight":
      if (row.open === false) return { toggle: row.node.key };
      if (row.open === true && rows[at + 1]?.parent === row.node.key) return { focus: rows[at + 1]!.node.key };
      return {};
    case "ArrowLeft":
      if (row.open === true) return { toggle: row.node.key };
      return row.parent ? { focus: row.parent } : {};
    case "Enter":
      return row.open === null ? { activate: row.node.key } : { toggle: row.node.key };
    default:
      return null;
  }
}
