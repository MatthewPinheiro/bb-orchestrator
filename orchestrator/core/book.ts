// The Projects tab as a source of truth (2026-11-16, layout B; the owner: "I'm trying not to get lost in all the work
// that is being done, so I need a source of truth to refer to"). What the row's summary (history.ts buildSummary) doesn't
// carry, read only for the project the owner opens, so the list's refresh and the minute tick never pay for it:
// - Decided: the owner's own answers on this project's cards (the decisions' project column), newest first;
// - Done: a short list of approved or in-review deliverables, merged PRs and the threads' reports;
// - merged: the project's latest merges, for "merged today" (the page knows where today starts, the plugin doesn't);
// - since: for each blocker of the lead's status, when the lead first said it, from the lead-status history.
// And across projects, a search over older answered cards. Every read is bounded and indexed (db.ts: the decisions'
// answer-time indexes, and events by project and kind).
import type { Db } from "./db.ts";
import type { LeadStatus } from "./status.ts";

export const BOOK_ROWS = 6;
/** How far back the lead-status history is read for a blocker's start: past it, the oldest status read is the start. */
export const SINCE_STATUSES = 100;
export const SEARCH_MIN = 3;
export const SEARCH_ROWS = 20;
/** The search reads the newest this many answers (through the answer time's index): bounded however long the history. */
export const SEARCH_WINDOW = 2000;
/** "Merged today" lists every merge of the page's day, up to this many (the count says how many there were). */
export const MERGED_TODAY_MAX = 100;
/** Merged today is counted up to this many. */
export const COUNT_CAP = 1000;
const DAY_MS = 24 * 3_600_000;

// The card reads, exported so the plan test explains these very statements (book.test.ts).
const TITLE = `COALESCE(json_extract(json, '$.ask.title'), json_extract(json, '$.request.title'))`;
export const DECIDED_SQL = `SELECT id, ${TITLE} AS title, json_extract(json, '$.answer.label') AS label, json_extract(json, '$.answer.text') AS text, json_extract(json, '$.answer.at') AS at
         FROM decisions WHERE project = ? AND +state IN ('answered','acked') AND json_extract(json, '$.answer.by') = 'person'
         ORDER BY json_extract(json, '$.answer.at') DESC LIMIT ?`;
export const SEARCH_SQL = `SELECT id, project, title, label, text, at FROM (
           SELECT id, project, json, ${TITLE} AS title, json_extract(json, '$.answer.label') AS label, json_extract(json, '$.answer.text') AS text, json_extract(json, '$.answer.at') AS at
           FROM decisions WHERE json_extract(json, '$.answer.at') IS NOT NULL AND +state IN ('answered','acked')
           ORDER BY json_extract(json, '$.answer.at') DESC LIMIT ?
         )
         WHERE title LIKE ? ESCAPE '\\' OR json_extract(json, '$.ask.question') LIKE ? ESCAPE '\\' OR json_extract(json, '$.request.question') LIKE ? ESCAPE '\\' OR label LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\' OR id = ?
         ORDER BY at DESC LIMIT ?`;
/**
 * A project's merges, one per PR: each environment holding a PR records its merge when it sees it, so the same PR can be
 * logged merged twice; its first sighting is when it merged. A merge row counts only when no earlier sighting of that PR
 * exists (seq breaks a same-millisecond tie), looked up through the merged-PR index; so a PR merged yesterday never
 * counts as merged today when another environment sees it today. The rows are read newest first through the project's
 * time index and stop at the LIMIT: a long merge history costs nothing (no grouping of the whole history). A row without
 * a URL counts on its own.
 */
const FIRST_SIGHTING = `NOT EXISTS (SELECT 1 FROM events f WHERE f.kind = 'pr' AND f.value = 'merged' AND f.ref = e.ref AND f.project = e.project AND (f.at < e.at OR (f.at = e.at AND f.seq < e.seq)))`;
const MERGE_ROWS = `FROM events e WHERE e.project = ? AND e.kind = 'pr' AND e.value = 'merged' AND ${FIRST_SIGHTING}`;
export const MERGED_SQL = `SELECT e.ref, e.note, e.at ${MERGE_ROWS} ORDER BY e.at DESC LIMIT ?`;
export const MERGED_SINCE_SQL = `SELECT e.ref, e.note, e.at ${MERGE_ROWS} AND e.at >= ? ORDER BY e.at DESC LIMIT ?`;
export const MERGED_SINCE_COUNT_SQL = `SELECT COUNT(*) AS n FROM (SELECT 1 ${MERGE_ROWS} AND e.at >= ? LIMIT ?)`;
export const DONE_DELIVERABLES_SQL = `SELECT id, title, state, updated_at FROM deliverables WHERE project = ? AND state IN ('approved','review') ORDER BY updated_at DESC LIMIT ?`;
export const DONE_REPORTS_SQL = `SELECT title, at FROM board WHERE project = ? AND kind IN ('report','pr') AND from_address LIKE 'thread:%' ORDER BY at DESC LIMIT ?`;
export const STATUS_HISTORY_SQL = `SELECT at, value FROM events WHERE project = ? AND kind = 'lead-status' ORDER BY at DESC LIMIT ?`;

/** The row summaries' answers after the oldest live status with a blocker (engine projectSummaries). */
export const SUMMARY_ANSWERED_SQL = `SELECT id, project, asker, origin, json_extract(json, '$.request.title') AS title, COALESCE(json_extract(json, '$.ask.question'), json_extract(json, '$.request.question')) AS question, json_extract(json, '$.answer.at') AS at
   FROM decisions WHERE +state IN ('answered','acked') AND json_extract(json, '$.answer.at') > ?`;

export interface BookDecided {
  id: string;
  title: string;
  answer: string;
  at: number;
}
export interface BookDone {
  kind: "deliverable" | "merged" | "report";
  text: string;
  at: number;
  /** A deliverable's id, a merged PR's URL; a report has none. */
  ref: string | null;
  /** A deliverable's state: approved or review. */
  state: string | null;
}
export interface ProjectBook {
  decided: BookDecided[];
  done: BookDone[];
  /** Every merge since the page's day start (or the last day), one per PR, newest first, up to MERGED_TODAY_MAX. */
  merged: { number: number | null; url: string | null; at: number }[];
  /** How many merges there were since then, past MERGED_TODAY_MAX too (counted up to COUNT_CAP). */
  mergedTotal: number;
  /**
   * When each blocker started, where the lead-status history says: the first saying of it in an unbroken run, or, when
   * the run goes past the history read (SINCE_STATUSES), a lower bound (bound: true). A blocker the history doesn't name
   * has no entry: the page then shows the status's time as "lead said", never as a start.
   */
  since: { text: string; since: number; bound: boolean }[];
}

const answerWords = (label: string | null, text: string | null) => [label, text].filter((x) => x && x.trim()).join(": ") || "answered";
const prNumber = (note: string | null) => (note && /^\d+$/.test(note) ? Number(note) : null);

/**
 * One project's Decided, Done, merges since `dayStart` and blockers' start. `dayStart` is the page's (the plugin can't
 * know the viewer's day); it is clamped to the last two days, and without it the last day is read.
 */
export function projectBook(db: Db, slug: string, status: LeadStatus | null, now: number, dayStart?: number): ProjectBook {
  // the owner's answers only (by 'person'): a rule's or the CoS's settle is theirs, not his. A merged card carries a
  // copy of its parent's answer (via 'merged'); its state is 'merged', so the parent shows once. "+state" keeps SQLite on
  // the answer time's indexes (db.ts decisions_project_answer, decisions_answer_at): by the state alone it would read nearly every card.
  const decided = (db.prepare(DECIDED_SQL).all(slug, BOOK_ROWS) as { id: string; title: string; label: string | null; text: string | null; at: string }[]).map((d) => ({
    id: d.id,
    title: d.title,
    answer: answerWords(d.label, d.text),
    at: Date.parse(d.at),
  }));
  const latest = (db.prepare(MERGED_SQL).all(slug, BOOK_ROWS) as { at: number; ref: string | null; note: string | null }[]).map((m) => ({ number: prNumber(m.note), url: m.ref, at: m.at }));
  const from = Math.min(now, Math.max(now - 2 * DAY_MS, dayStart ?? now - DAY_MS));
  const since = db.prepare(MERGED_SINCE_SQL).all(slug, from, MERGED_TODAY_MAX) as { at: number; ref: string | null; note: string | null }[];
  const mergedTotal = (db.prepare(MERGED_SINCE_COUNT_SQL).get(slug, from, COUNT_CAP) as { n: number }).n;
  const delivered = db.prepare(DONE_DELIVERABLES_SQL).all(slug, BOOK_ROWS) as { id: string; title: string; state: string; updated_at: number }[];
  const reports = db.prepare(DONE_REPORTS_SQL).all(slug, BOOK_ROWS) as { title: string; at: number }[];
  const done: BookDone[] = [
    ...delivered.map((d) => ({ kind: "deliverable" as const, text: d.title, at: d.updated_at, ref: d.id, state: d.state })),
    ...latest.map((m) => ({ kind: "merged" as const, text: `PR ${m.number ? `#${m.number} ` : ""}merged`, at: m.at, ref: m.url, state: null })),
    ...reports.map((r) => ({ kind: "report" as const, text: r.title, at: r.at, ref: null, state: null })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, BOOK_ROWS);
  return {
    decided,
    done,
    merged: since.map((m) => ({ number: prNumber(m.note), url: m.ref, at: m.at })),
    mergedTotal,
    since: blockersSince(db, slug, status),
  };
}

/**
 * When each blocker of the current status was first said: walking the lead's published statuses back from the newest,
 * the oldest one in an unbroken run that still names it. A status that dropped it and a later one that named it again
 * start a new run. A run that reaches the SINCE_STATUSES-th status read is only known to be at least that old (bound).
 * A blocker no status in the history names (a status from before the log) gets no entry.
 */
export function blockersSince(db: Db, slug: string, status: LeadStatus | null): ProjectBook["since"] {
  if (!status?.blockers.length) return [];
  const rows = db.prepare(STATUS_HISTORY_SQL).all(slug, SINCE_STATUSES) as { at: number; value: string | null }[];
  const out: ProjectBook["since"] = [];
  for (const text of status.blockers) {
    let since: number | null = null;
    let broke = false;
    for (const r of rows) {
      if (r.at > status.updatedAt) continue; // a row newer than the status read (a race): not this status's history
      let blockers: string[] = [];
      try {
        blockers = (JSON.parse(r.value ?? "{}") as Partial<LeadStatus>).blockers ?? [];
      } catch {
        broke = true;
        break;
      }
      if (!blockers.includes(text)) {
        broke = true;
        break;
      }
      since = r.at;
    }
    if (since !== null) out.push({ text, since, bound: !broke && rows.length >= SINCE_STATUSES });
  }
  return out;
}

export interface CardHit {
  id: string;
  project: string | null;
  title: string;
  answer: string;
  at: number;
}

/**
 * Answered cards whose title, question or answer has the words, or whose id it is, newest first: the search's older
 * cards. It reads the newest SEARCH_WINDOW answers only (2000 take a few ms; a full table of 100k took over a second,
 * on the plugin's one thread), and the page says so.
 */
export function searchAnswered(db: Db, q: string): CardHit[] {
  const term = q.trim();
  if (term.length < SEARCH_MIN) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return (
    db
      .prepare(
        SEARCH_SQL,
      )
      .all(SEARCH_WINDOW, like, like, like, like, like, term, SEARCH_ROWS) as { id: string; project: string | null; title: string; label: string | null; text: string | null; at: string }[]
  ).map((d) => ({ id: d.id, project: d.project, title: d.title, answer: answerWords(d.label, d.text), at: Date.parse(d.at) }));
}
