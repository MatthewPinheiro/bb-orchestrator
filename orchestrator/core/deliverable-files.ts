// Requested 2026-11-17: every deliverable keeps its own files. The owner found the Deliverables tree hard to navigate and
// wanted "just a file", and 12% of proof had gone: it lived in thread worktrees that bb removed once the thread was
// archived. So filing a deliverable copies each proof file into one flat folder of its own,
// <dir>/<project>/<YYYY-MM-DD>-<title-slug>-<id>/, sorted into images/, videos/ and artifacts/, with a README.md to open
// first. The copy is what is shown and opened; the original path stays on the proof as provenance (`source`).
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { FILE_KINDS, fileKind, type FileKind } from "./file-kind.ts";
import type { Deliverable, Proof } from "./model.ts";

export { FILE_KINDS, fileKind, type FileKind };

/** Files over this stay where they are: the proof keeps its reference and the README says so. */
export const COPY_MAX = 200 * 1024 * 1024;

/** A folder-name slug: lowercase letters, digits and single dashes, never empty, never a path. */
export function slugOf(s: string, max = 40): string {
  const v = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return v || "untitled";
}

/** <dir>/<project>/<YYYY-MM-DD>-<title-slug>-<id>: the day it was first filed, so the folder never moves with a retitle. */
export function folderFor(dir: string, d: Pick<Deliverable, "id" | "project" | "title" | "createdAt">): string {
  const day = new Date(d.createdAt).toISOString().slice(0, 10);
  return join(dir, d.project ? slugOf(d.project, 60) : "no-project", `${day}-${slugOf(d.title)}-${slugOf(d.id, 20)}`);
}

export type Kept =
  | { stored: "copied"; path: string; bytes: number; reused: boolean }
  | { stored: "too_big"; bytes: number }
  | { stored: "missing" }
  | { stored: "failed"; why: string };

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Copy one file into its kind's folder under `folder`. A file already there with the same bytes is reused, so a
 * revision that shows the same screenshot again adds nothing; another file with the same name gets -2, -3 and so on
 * rather than overwriting it. A folder (an output can be one) is copied whole, under a free name. Never throws.
 */
export function keepFile(folder: string, src: string, maxBytes = COPY_MAX): Kept {
  try {
    if (!existsSync(src)) return { stored: "missing" };
    const st = statSync(src);
    const kind = st.isDirectory() ? "artifacts" : fileKind(src);
    const into = join(folder, kind);
    mkdirSync(into, { recursive: true });
    if (st.isDirectory()) {
      const to = freeName(into, basename(src));
      cpSync(src, to, { recursive: true });
      return { stored: "copied", path: realpathSync(to), bytes: 0, reused: false };
    }
    if (st.size > maxBytes) return { stored: "too_big", bytes: st.size };
    let hash: string | null = null;
    for (const e of readdirSync(into, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const there = join(into, e.name);
      if (statSync(there).size !== st.size) continue;
      hash ??= sha(src);
      if (sha(there) === hash) return { stored: "copied", path: realpathSync(there), bytes: st.size, reused: true };
    }
    const to = freeName(into, basename(src));
    copyFileSync(src, to);
    return { stored: "copied", path: realpathSync(to), bytes: st.size, reused: false };
  } catch (e) {
    return { stored: "failed", why: e instanceof Error ? e.message : String(e) };
  }
}

/** `name` in `dir`, or name-2.ext, name-3.ext… when it is taken. */
function freeName(dir: string, name: string): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length) || "file";
  let to = join(dir, name);
  for (let n = 2; existsSync(to); n++) to = join(dir, `${stem}-${n}${ext}`);
  return to;
}

/**
 * Where the archive kept a worktree file before 2026-11-17: <threads>/<thread id>/outputs/<path in the worktree>, for an
 * output recorded inside bb's worktree folder …/worktrees/thr_<id>-<n>/<repo>/. Null when nothing is kept there.
 */
export function keptCopy(threadsDir: string, path: string): string | null {
  const m = /^.*\/worktrees\/(thr_[a-z0-9]+)-\d+\/[^/]+\/(.+)$/.exec(path);
  if (!m || m[2]!.split("/").includes("..")) return null;
  const at = join(threadsDir, m[1]!, "outputs", m[2]!);
  try {
    return statSync(at).isFile() && realpathSync(at) === at ? at : null;
  } catch {
    return null;
  }
}

/** Apply a keepFile result to a proof item: a copy becomes its path and the original its source. */
export function fileProof(p: Proof, k: Kept): void {
  p.stored = k.stored;
  if (k.stored === "copied") {
    if (p.path !== k.path) p.source ??= p.path;
    p.path = k.path;
    p.bytes = k.bytes;
  } else if (k.stored === "too_big") p.bytes = k.bytes;
}

const STATE: Record<Deliverable["state"], string> = { review: "in review", approved: "approved", changes: "changes requested", withdrawn: "withdrawn" };

export function sizeText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const inside = (folder: string, path: string) => path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
const link = (rel: string) => `<${rel.split(sep).join("/")}>`;
const oneLineText = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The README.md at the top of a deliverable's folder: the title, the summary, the points and the state, then its files
 * by kind (captions from the newest revision that shows them), the links it gives, and what could not be copied.
 */
export function readmeText(d: Deliverable, folder: string): string {
  const latest = d.revisions.find((r) => r.rev === d.rev) ?? d.revisions.at(-1);
  const out: string[] = [`# ${d.title}`, "", (latest?.summary ?? d.summary).trim(), ""];
  const fb = d.feedback.at(-1);
  out.push(
    `- State: ${STATE[d.state]}${d.rev > 1 ? ` (rev ${d.rev})` : ""}${fb?.text ? `: ${oneLineText(fb.text)}` : ""}${d.withdrawn?.reason ? `: ${oneLineText(d.withdrawn.reason)}` : ""}`,
    `- Project: ${d.project ?? "none"}`,
    `- Lead: ${d.lead}`,
    `- Delivered: ${new Date(d.createdAt).toISOString()}; updated ${new Date(d.updatedAt).toISOString()}`,
    `- Id: ${d.id}`,
    "",
  );
  if (latest?.points?.length) {
    out.push("## Points", "");
    for (const p of latest.points) out.push(`- **${oneLineText(p.headline)}**${p.why ? `: ${oneLineText(p.why)}` : ""}`);
    out.push("");
  }
  const captions = new Map<string, string>();
  const links = new Map<string, string>();
  const notCopied: string[] = [];
  const missing: string[] = [];
  for (const r of [...d.revisions].sort((a, b) => b.rev - a.rev)) {
    for (const p of r.proof) {
      if (p.url) {
        if (!links.has(p.url)) links.set(p.url, p.caption);
        continue;
      }
      if (!p.path) continue;
      if (p.stored === "copied" && inside(folder, p.path)) {
        if (!captions.has(p.path)) captions.set(p.path, p.caption);
      } else if (p.stored === "missing") missing.push(`- ${oneLineText(p.caption)} (rev ${r.rev}): ${p.source ?? p.path}`);
      else if (p.stored === "too_big") notCopied.push(`- ${oneLineText(p.caption)} (rev ${r.rev}, ${sizeText(p.bytes ?? 0)}, over the ${sizeText(COPY_MAX)} copy cap): ${p.source ?? p.path}`);
      else notCopied.push(`- ${oneLineText(p.caption)} (rev ${r.rev}, not copied): ${p.source ?? p.path}`);
    }
  }
  const heads: Record<FileKind, string> = { images: "Images", videos: "Videos", artifacts: "Artifacts" };
  for (const kind of FILE_KINDS) {
    const files = listKind(folder, kind);
    if (!files.length) continue;
    out.push(`## ${heads[kind]}`, "");
    for (const f of files) {
      const rel = relative(folder, f.path);
      const cap = captions.get(f.path);
      out.push(`- [${cap ? oneLineText(cap) : basename(f.path)}](${link(rel)})${cap ? ` ${basename(f.path)}` : ""}, ${f.dir ? "folder" : sizeText(f.bytes)}`);
    }
    out.push("");
  }
  if (links.size) {
    out.push("## Links", "");
    for (const [url, caption] of links) out.push(`- [${oneLineText(caption)}](${url})`);
    out.push("");
  }
  if (notCopied.length) out.push("## Kept as a reference", "", ...notCopied, "");
  if (missing.length) out.push("## Missing", "", "These files were gone before they could be copied (most lived in a thread worktree bb has removed) and can't be recovered.", "", ...missing, "");
  return out.join("\n");
}

/** The files and folders directly in one kind's folder, by name. */
export function listKind(folder: string, kind: FileKind): { path: string; bytes: number; dir: boolean }[] {
  const into = join(folder, kind);
  if (!existsSync(into)) return [];
  return readdirSync(into, { withFileTypes: true })
    .filter((e) => e.isFile() || e.isDirectory())
    .map((e) => {
      const path = join(into, e.name);
      return { path, bytes: e.isFile() ? statSync(path).size : 0, dir: e.isDirectory() };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** A folder as the page lists it (2026-11-17): every file by kind with its size and time, and its README. Gone: null. */
export function listFolder(folder: string): { folder: string; readme: string | null; files: { path: string; name: string; kind: FileKind; bytes: number; at: number; dir: boolean }[] } | null {
  if (!existsSync(folder)) return null;
  const files = FILE_KINDS.flatMap((kind) =>
    listKind(folder, kind).map((f) => ({ path: f.path, name: basename(f.path), kind, bytes: f.bytes, at: Math.round(statSync(f.path).mtimeMs), dir: f.dir })),
  );
  const readme = join(folder, "README.md");
  return { folder, readme: existsSync(readme) ? readme : null, files };
}

/** Write the README atomically (a temp file, then a rename), so a reader never sees half of it. */
export function writeReadme(d: Deliverable, folder: string): void {
  mkdirSync(folder, { recursive: true });
  const to = join(folder, "README.md");
  const tmp = `${to}.tmp`;
  writeFileSync(tmp, readmeText(d, folder));
  renameSync(tmp, to);
}
