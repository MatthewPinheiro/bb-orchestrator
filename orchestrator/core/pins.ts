// Pinned documents (2026-11-17, the owner picked "All five + pinned documents"): a few documents a project keeps at hand,
// shown as a strip under its message box. A pin names a target, never its content:
// - a file on a bb host (its realpath, checked as proof is: inside the caller's roots; engine.ts outputPath),
// - an http(s) URL (a claude.ai artifact, a doc; engine.ts outputUrl),
// - or one of the project's deliverables.
// "Updated" is read when the tab loads: a file's mtime, a deliverable's latest revision, a link's pin time.
// At most PINS_MAX live pins per project; unpinning keeps the row with its time.
import { realpathSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { type Db, tx } from "./db.ts";
import { EngineError } from "./model.ts";

export const PINS_MAX = 12;
export const PIN_KINDS = ["file", "link", "deliverable"] as const;
export type PinKind = (typeof PIN_KINDS)[number];
/** A neutral kind icon: a web page, a document, a link, a deliverable. */
export type PinIcon = "page" | "doc" | "link" | "box";

export interface Pin {
  id: string;
  project: string;
  kind: PinKind;
  path: string | null;
  hostId: string | null;
  url: string | null;
  deliverable: string | null;
  title: string;
  icon: PinIcon;
  pinnedBy: string;
  pinnedAt: number;
  position: number;
  unpinnedAt: number | null;
}

/** What the strip draws: the pin, and when its target last changed (null: a file that is gone). */
export interface PinView {
  id: string;
  kind: PinKind;
  title: string;
  icon: PinIcon;
  path: string | null;
  hostId: string | null;
  url: string | null;
  deliverable: string | null;
  /** ms epoch: a file's mtime, a deliverable's latest revision, a link's pin time; null when the file is gone */
  updatedAt: number | null;
  /** a deliverable's latest revision number */
  rev: number | null;
  missing: boolean;
}

/** A checked target: the caller has already run the path through outputPath or the URL through outputUrl. */
export type PinTarget = { kind: "file"; path: string; hostId: string } | { kind: "link"; url: string } | { kind: "deliverable"; id: string };

type Row = { id: string; project: string; kind: string; path: string | null; host_id: string | null; url: string | null; deliverable: string | null; title: string; icon: string; pinned_by: string; pinned_at: number; position: number; unpinned_at: number | null };
const toPin = (r: Row): Pin => ({
  id: r.id,
  project: r.project,
  kind: r.kind as PinKind,
  path: r.path,
  hostId: r.host_id,
  url: r.url,
  deliverable: r.deliverable,
  title: r.title,
  icon: r.icon as PinIcon,
  pinnedBy: r.pinned_by,
  pinnedAt: r.pinned_at,
  position: r.position,
  unpinnedAt: r.unpinned_at,
});

export const LIVE_PINS_SQL = `SELECT * FROM project_pins WHERE project = ? AND unpinned_at IS NULL ORDER BY position, pinned_at`;

export function iconFor(t: PinTarget): PinIcon {
  if (t.kind === "deliverable") return "box";
  if (t.kind === "link") return "link";
  return /^\.html?$/i.test(extname(t.path)) ? "page" : "doc";
}

/** A title when none is given: the file's name, the link's last path part (else its host), the deliverable's title. */
export function defaultTitle(t: PinTarget, deliverableTitle: string | null): string {
  if (t.kind === "file") return basename(t.path);
  if (t.kind === "deliverable") return deliverableTitle ?? t.id;
  const u = new URL(t.url);
  const last = u.pathname.split("/").filter(Boolean).pop();
  if (!last) return u.host;
  try {
    return decodeURIComponent(last);
  } catch {
    return last; // a valid URL can carry a bad escape ("100%"): keep it as written
  }
}

const one = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

/**
 * Pins a checked target to a project. The same target pinned and still live is that pin (created: false). The 13th
 * live pin is refused: the strip shows four, and a pile of pins is a folder, not a shortlist.
 */
export function addPin(db: Db, project: string, t: PinTarget, o: { title?: string | null; by: string; now: number; id: string }): { pin: Pin; created: boolean } {
  return tx(db, () => {
    const live = (db.prepare(LIVE_PINS_SQL).all(project) as Row[]).map(toPin);
    const same = live.find((p) => (t.kind === "file" ? p.kind === "file" && p.path === t.path && p.hostId === t.hostId : t.kind === "link" ? p.kind === "link" && p.url === t.url : p.kind === "deliverable" && p.deliverable === t.id));
    if (same) return { pin: same, created: false };
    if (live.length >= PINS_MAX) throw new EngineError("invalid", `${project} has ${PINS_MAX} pins already: unpin one first`);
    let dTitle: string | null = null;
    if (t.kind === "deliverable") {
      const d = db.prepare(`SELECT title, project FROM deliverables WHERE id = ?`).get(t.id) as { title: string; project: string | null } | undefined;
      if (!d) throw new EngineError("not_found", `no deliverable ${t.id}`);
      if (d.project !== project) throw new EngineError("invalid", `${t.id} belongs to ${d.project ?? "no project"}, not ${project}`);
      dTitle = d.title;
    }
    const title = one(o.title ?? "") || one(defaultTitle(t, dTitle)) || "Untitled";
    const position = (live.at(-1)?.position ?? -1) + 1;
    db.prepare(`INSERT INTO project_pins (id, project, kind, path, host_id, url, deliverable, title, icon, pinned_by, pinned_at, position, unpinned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
      o.id,
      project,
      t.kind,
      t.kind === "file" ? t.path : null,
      t.kind === "file" ? t.hostId : null,
      t.kind === "link" ? t.url : null,
      t.kind === "deliverable" ? t.id : null,
      title,
      iconFor(t),
      o.by,
      o.now,
      position,
    );
    return { pin: getPin(db, o.id)!, created: true };
  });
}

export function getPin(db: Db, id: string): Pin | null {
  const r = db.prepare(`SELECT * FROM project_pins WHERE id = ?`).get(id) as Row | undefined;
  return r ? toPin(r) : null;
}

/**
 * The pin in `project` named by `ref` (how a lead or the CLI names one), or null: by id even once unpinned (so unpinning
 * twice is a no-op from the CLI too), by path, URL or deliverable only while live.
 */
export function findPin(db: Db, project: string, ref: string): Pin | null {
  const r = db.prepare(`SELECT * FROM project_pins WHERE project = ? AND (id = ? OR (unpinned_at IS NULL AND (path = ? OR url = ? OR deliverable = ?))) ORDER BY unpinned_at IS NOT NULL LIMIT 1`).get(project, ref, ref, ref, ref) as Row | undefined;
  return r ? toPin(r) : null;
}

/** Unpins: the pin stays in the table with its time, and leaves the strip. Unpinning twice is a no-op. */
export function unpin(db: Db, id: string, now: number): Pin {
  const p = getPin(db, id);
  if (!p) throw new EngineError("not_found", `no pin ${id}`);
  if (p.unpinnedAt === null) db.prepare(`UPDATE project_pins SET unpinned_at = ? WHERE id = ?`).run(now, id);
  return getPin(db, id)!;
}

/**
 * A project's live pins as the strip draws them, with "updated" read now. A file pin's path was stored as its realpath,
 * checked inside the project's folders; if it no longer resolves to itself (it, or a folder above it, became a symlink
 * since), it counts as missing and the strip won't open it. `stat` and `real` are injectable for tests.
 */
export function pinViews(db: Db, project: string, stat: (p: string) => { mtimeMs: number } = statSync, real: (p: string) => string = realpathSync): PinView[] {
  const pins = (db.prepare(LIVE_PINS_SQL).all(project) as Row[]).map(toPin);
  return pins.map((p) => {
    let updatedAt: number | null = p.pinnedAt;
    let rev: number | null = null;
    let missing = false;
    if (p.kind === "file") {
      try {
        if (real(p.path!) !== p.path) throw new Error("moved");
        updatedAt = Math.round(stat(p.path!).mtimeMs);
      } catch {
        updatedAt = null;
        missing = true;
      }
    } else if (p.kind === "deliverable") {
      // the latest revision's time, not updated_at: an approval or a comment is not a new version of the document
      const d = db.prepare(`SELECT rev, updated_at, json_extract(json, '$.revisions[#-1].at') AS at FROM deliverables WHERE id = ?`).get(p.deliverable) as { rev: number; updated_at: number; at: string | null } | undefined;
      if (d) {
        updatedAt = (d.at && Date.parse(d.at)) || d.updated_at;
        rev = d.rev;
      } else missing = true;
    }
    return { id: p.id, kind: p.kind, title: p.title, icon: p.icon, path: p.path, hostId: p.hostId, url: p.url, deliverable: p.deliverable, updatedAt, rev, missing };
  });
}
