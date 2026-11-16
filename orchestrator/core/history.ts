// The project page's history (2026-11-16): the append-only events log (db.ts), its one-time backfill from the older
// tables, and the pure builder that turns one project's rows into what the page draws: a Gantt row per address (its
// holders end to end, coloured by status, with PR, handoff and resolve marks and the owner's cards), the flow (who
// started it, its providers, its PRs) and what waits on what.
import { type Db, tx } from "./db.ts";

// lead-status: an orch_status publish (value = the status as JSON); the history builder doesn't draw it
export type EventKind = "spawn" | "status" | "pr" | "handoff" | "retire" | "resolve" | "lead-status";
export interface EventIn {
  at: number;
  kind: EventKind;
  project: string | null;
  address: string | null;
  threadId: string | null;
  value?: string | null;
  ref?: string | null;
  note?: string | null;
}
export interface EventRow {
  seq: number;
  at: number;
  kind: EventKind;
  project: string | null;
  address: string | null;
  thread_id: string | null;
  value: string | null;
  ref: string | null;
  note: string | null;
  backfill: number;
}

export function logEvent(db: Db, e: EventIn, backfill = false): void {
  db.prepare(`INSERT INTO events (at, kind, project, address, thread_id, value, ref, note, backfill) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    e.at,
    e.kind,
    e.project,
    e.address,
    e.threadId,
    e.value ?? null,
    e.ref ?? null,
    e.note ?? null,
    backfill ? 1 : 0,
  );
}

/** When the log started (the backfill's instant), or null before it ran. */
export function logSince(db: Db): number | null {
  return (db.prepare(`SELECT value FROM cursors WHERE name = 'events.since'`).get() as { value: number } | undefined)?.value ?? null;
}

const PR_TITLE = /^(\S+): PR(?: #(\d+))? (open|draft|merged|closed)\b/;
const HANDOFF_BODY = /^(\S+) → (\S+)\. ([^\s;]+)/;
const RESOLVED_TITLE = /^(\S+) resolved: (.*)$/;

/**
 * Once: what the older tables already say, as backfill rows. Each agent's start and retirement, each resolve and
 * handoff the Board recorded, and each PR state change from the Board's PR notices. Then one status row per live agent
 * at the log's start, so its bar has a colour from there. Status before the log isn't known: those bars show only
 * their start and end. Returns false when it had run already.
 */
export function backfillEvents(db: Db, now: number): boolean {
  return tx(db, () => {
    if (logSince(db) !== null) return false;
    const agents = db.prepare(`SELECT thread_id, address, role, project, parent_thread_id, status, created_at, retired_at FROM agents`).all() as {
      thread_id: string;
      address: string;
      role: string;
      project: string | null;
      parent_thread_id: string | null;
      status: string;
      created_at: number;
      retired_at: number | null;
    }[];
    for (const a of agents) {
      const base = { project: a.project, address: a.address, threadId: a.thread_id };
      logEvent(db, { ...base, at: a.created_at, kind: "spawn", value: a.role, ref: a.parent_thread_id }, true);
      if (a.retired_at !== null) logEvent(db, { ...base, at: a.retired_at, kind: "retire" }, true);
    }
    const board = db.prepare(`SELECT kind, from_address, project, title, body, ref, at FROM board WHERE kind IN ('resolved','notice','prstate') ORDER BY at, rowid`).all() as {
      kind: string;
      from_address: string | null;
      project: string | null;
      title: string;
      body: string;
      ref: string | null;
      at: number;
    }[];
    const lastPr = new Map<string, string>();
    for (const r of board) {
      if (r.kind === "resolved") {
        const m = RESOLVED_TITLE.exec(r.title);
        if (m && r.ref) logEvent(db, { at: r.at, kind: "resolve", project: r.project, address: m[1]!, threadId: r.ref, value: m[2]! }, true);
      } else if (r.kind === "notice" && r.title.endsWith(" handed over")) {
        const m = HANDOFF_BODY.exec(r.body);
        if (m) logEvent(db, { at: r.at, kind: "handoff", project: r.project, address: r.title.slice(0, -" handed over".length), threadId: m[2]!, ref: m[1]!, value: m[3]!, note: null }, true);
      } else if (r.kind === "prstate") {
        const m = PR_TITLE.exec(r.title);
        if (!m || !r.ref) continue;
        const key = `${m[1]}|${r.ref}`;
        if (lastPr.get(key) === m[3]) continue; // a checks or review change: not a state change
        lastPr.set(key, m[3]!);
        logEvent(db, { at: r.at, kind: "pr", project: r.project, address: m[1]!, threadId: null, value: m[3]!, ref: r.ref, note: m[2] ?? null }, true);
      }
    }
    for (const a of agents) if (a.retired_at === null) logEvent(db, { at: now, kind: "status", project: a.project, address: a.address, threadId: a.thread_id, value: a.status });
    db.prepare(`INSERT INTO cursors (name, value) VALUES ('events.since', ?)`).run(now);
    return true;
  });
}

// ---------------------------------------------------------------- the page's shape

export type SegState = "working" | "idle" | "blocked" | "released" | "unknown" | "nolog";
export type MarkKind = "pr-open" | "pr-draft" | "pr-merged" | "pr-closed" | "handoff" | "resolve";
export type DepKind = "card" | "held" | "deferred" | "hold" | "dead" | "reply" | "pr" | "ci" | "review";
export interface Holder {
  threadId: string;
  from: number;
  to: number | null;
  provider: string | null;
  segments: { from: number; to: number; state: SegState }[];
}
export interface HistoryRow {
  address: string;
  role: string;
  live: boolean;
  parent: string | null;
  holders: Holder[];
  marks: { at: number; kind: MarkKind; label: string; url: string | null }[];
  asks: { id: string; title: string; from: number; to: number | null }[];
  prs: { url: string; number: number | null; state: string }[];
}
export interface Dep {
  from: string; // an address, or the project's slug (a hold)
  on: string; // "owner", an address, or "pr" / "ci" / "review"
  kind: DepKind;
  label: string;
  since: number | null;
  ref: string | null; // a card id, PR url or item id
  block: boolean; // nothing moves until it is settled
}
export interface ProjectHistory {
  slug: string;
  now: number;
  start: number;
  logSince: number | null;
  rows: HistoryRow[];
  deps: Dep[];
}

export interface HistoryInput {
  slug: string;
  now: number;
  logSince: number | null;
  heldAt: number | null;
  agents: { thread_id: string; address: string; role: string; parent_thread_id: string | null; status: string; created_at: number; retired_at: number | null }[];
  /** The project's events; a thread that later took a new role (register deletes its old row) is known only here. */
  events: EventRow[];
  decisions: DecisionLite[];
  waits: { id: string; owner: string; pr_url: string; cond: string; created_at: number }[];
  items: { id: string; sender: string; recipient: string; kind: string; state: string; body: string; created_at: number }[];
  prs: { thread_id: string; url: string | null; number: number | null; state: string | null; checks: string | null; sig: string; attention: string | null }[];
  providers: Map<string, string | null>;
}
export interface DecisionLite {
  id: string;
  state: string;
  level: string;
  asker: string;
  origin: string;
  title: string;
  createdAt: number;
  askedAt: number;
  endedAt: number | null;
  deferred: boolean;
  heldBehind: string | null;
}

const BUSY = new Set(["active", "pending", "starting", "stopping"]);
export function segState(status: string | null): SegState {
  if (!status) return "unknown";
  if (BUSY.has(status)) return "working";
  if (status === "idle") return "idle";
  if (status === "error") return "blocked";
  if (status === "stopped" || status === "archived") return "released";
  return "unknown";
}

/** thread:<p>:<n> → n; a lead sorts first. */
const rank = (address: string) => (address.startsWith("lead:") ? -1 : Number(address.split(":")[2] ?? Number.MAX_SAFE_INTEGER));

function segments(threadId: string, from: number, to: number, since: number | null, events: EventRow[]): Holder["segments"] {
  const out: Holder["segments"] = [];
  const push = (a: number, b: number, state: SegState) => {
    if (b <= a) return;
    const last = out[out.length - 1];
    if (last && last.state === state && last.to === a) last.to = b;
    else out.push({ from: a, to: b, state });
  };
  let at = from;
  let state: SegState = "unknown";
  if (since === null || from < since) {
    const cut = since === null ? to : Math.min(since, to);
    push(from, cut, "nolog");
    at = cut;
  }
  for (const e of events) {
    if (e.kind !== "status" || e.thread_id !== threadId || e.at < at || e.at > to) continue;
    push(at, e.at, state);
    state = segState(e.value);
    at = e.at;
  }
  push(at, to, state);
  return out;
}

export function buildHistory(x: HistoryInput): ProjectHistory {
  const { now, logSince: since } = x;
  // holders by address: the agents rows, plus those only the events know (a thread that later took a new role)
  const holders = new Map<string, { threadId: string; role: string; parent: string | null; from: number; to: number | null; live: boolean }[]>();
  const add = (address: string, h: { threadId: string; role: string; parent: string | null; from: number; to: number | null; live: boolean }) => {
    const list = holders.get(address) ?? [];
    if (!list.some((y) => y.threadId === h.threadId)) list.push(h);
    holders.set(address, list);
  };
  for (const a of x.agents) add(a.address, { threadId: a.thread_id, role: a.role, parent: a.parent_thread_id, from: a.created_at, to: a.retired_at, live: a.retired_at === null });
  for (const e of x.events) {
    if (e.kind !== "spawn" || !e.address || !e.thread_id) continue;
    if ([...holders.values()].some((l) => l.some((h) => h.threadId === e.thread_id))) continue;
    const end = x.events.find((r) => r.kind === "retire" && r.thread_id === e.thread_id && r.at >= e.at);
    add(e.address, { threadId: e.thread_id, role: e.value ?? "thread", parent: e.ref, from: e.at, to: end?.at ?? e.at, live: false });
  }
  const addressOfThread = new Map<string, string>();
  for (const [address, list] of holders) for (const h of list) addressOfThread.set(h.threadId, address);
  // providers: bb's word for the thread, else what a handoff recorded (value: the successor's, note: the predecessor's)
  const provider = new Map<string, string | null>();
  for (const e of x.events) {
    if (e.kind !== "handoff") continue;
    if (e.thread_id && e.value) provider.set(e.thread_id, e.value);
    if (e.ref && e.note) provider.set(e.ref, e.note);
  }
  for (const [id, p] of x.providers) if (p) provider.set(id, p);

  const rows: HistoryRow[] = [];
  for (const [address, list] of holders) {
    list.sort((a, b) => a.from - b.from);
    const own = new Set(list.map((h) => h.threadId));
    const evs = x.events.filter((e) => e.address === address || (e.thread_id !== null && own.has(e.thread_id)));
    const marks: HistoryRow["marks"] = [];
    const prState = new Map<string, { number: number | null; state: string }>();
    for (const e of evs) {
      if (e.kind === "pr" && e.ref && e.value) {
        const prev = prState.get(e.ref);
        const number = e.note ? Number(e.note) || null : (prev?.number ?? null);
        prState.set(e.ref, { number, state: e.value });
        if (prev?.state === e.value) continue;
        const kind = (`pr-${e.value}` as MarkKind);
        if (!["pr-open", "pr-draft", "pr-merged", "pr-closed"].includes(kind)) continue;
        marks.push({ at: e.at, kind, label: `#${number ?? "?"} ${e.value}`, url: e.ref });
      } else if (e.kind === "handoff") {
        marks.push({ at: e.at, kind: "handoff", label: `→ ${providerWord(e.value)}`, url: null });
      } else if (e.kind === "resolve") {
        marks.push({ at: e.at, kind: "resolve", label: "resolved", url: null });
      }
    }
    // the current PR rows of its holders (a reading older than the log, or a draft that never changed)
    for (const p of x.prs) {
      if (!own.has(p.thread_id) || !p.url || !p.state) continue;
      prState.set(p.url, { number: p.number ?? prState.get(p.url)?.number ?? null, state: p.state });
    }
    marks.sort((a, b) => a.at - b.at);
    const asks = x.decisions
      .filter((d) => d.level === "person" && d.origin === address)
      .map((d) => ({ id: d.id, title: d.title, from: d.askedAt, to: d.endedAt }))
      .sort((a, b) => a.from - b.from);
    const first = list[0]!;
    rows.push({
      address,
      role: first.role,
      live: list.some((h) => h.live),
      parent: first.parent ? (addressOfThread.get(first.parent) ?? null) : null,
      holders: list.map((h) => ({
        threadId: h.threadId,
        from: h.from,
        to: h.to,
        provider: provider.get(h.threadId) ?? null,
        segments: segments(h.threadId, h.from, h.to ?? now, since, evs),
      })),
      marks,
      asks,
      prs: [...prState].map(([url, p]) => ({ url, number: p.number, state: p.state })),
    });
  }
  rows.sort((a, b) => rank(a.address) - rank(b.address) || a.address.localeCompare(b.address));
  const start = Math.min(now, ...rows.flatMap((r) => r.holders.map((h) => h.from)));
  return { slug: x.slug, now, start, logSince: since, rows, deps: buildDeps(x, rows) };
}

/** "claude-code" → "Claude", "codex" → "Codex"; anything else as it is. */
export function providerWord(p: string | null): string {
  if (!p) return "?";
  const s = p.toLowerCase();
  if (s.includes("codex")) return "Codex";
  if (s.includes("claude")) return "Claude";
  return p;
}

const DEP_RANK: Record<DepKind, number> = { hold: 0, card: 1, held: 1, dead: 1, deferred: 2, reply: 3, review: 4, ci: 4, pr: 5 };
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const who = (address: string) => (address === "person" ? "owner" : address);

function buildDeps(x: HistoryInput, rows: HistoryRow[]): Dep[] {
  const live = new Set(rows.filter((r) => r.live).map((r) => r.address));
  const ours = new Set(rows.map((r) => r.address));
  const out: Dep[] = [];
  if (x.heldAt !== null) out.push({ from: x.slug, on: "owner", kind: "hold", label: "on hold", since: x.heldAt, ref: null, block: true });
  for (const d of x.decisions) {
    if (d.state !== "open" && d.state !== "asked") continue;
    if (!ours.has(d.origin) && !ours.has(d.asker)) continue;
    const from = ours.has(d.origin) ? d.origin : d.asker;
    if (d.level === "person") {
      const kind: DepKind = d.heldBehind ? "held" : d.deferred ? "deferred" : "card";
      out.push({ from, on: "owner", kind, label: short(d.title), since: d.askedAt, ref: d.id, block: kind !== "deferred" });
    } else {
      out.push({ from, on: d.level === "cos" ? "cos" : `lead:${x.slug}`, kind: "card", label: short(d.title), since: d.createdAt, ref: d.id, block: true });
    }
  }
  for (const it of x.items) {
    const from = who(it.sender);
    const on = who(it.recipient);
    if (!ours.has(it.sender) && !ours.has(it.recipient)) continue;
    // a reply owed by an agent that has since retired never comes: only the dead letters say so
    if (it.state !== "dead" && ours.has(it.recipient) && !live.has(it.recipient)) continue;
    if (it.state === "dead") out.push({ from, on, kind: "dead", label: `undelivered ${it.kind}`, since: it.created_at, ref: it.id, block: true });
    else out.push({ from, on, kind: "reply", label: short(it.body.split("\n")[0] ?? it.kind, 50), since: it.created_at, ref: it.id, block: false });
  }
  for (const w of x.waits) {
    if (!ours.has(w.owner)) continue;
    const n = x.prs.find((p) => p.url === w.pr_url)?.number ?? null;
    out.push({ from: w.owner, on: "pr", kind: "pr", label: `#${n ?? "?"} ${w.cond}`, since: w.created_at, ref: w.pr_url, block: false });
  }
  for (const r of rows) {
    if (!live.has(r.address)) continue;
    const ids = new Set(r.holders.filter((h) => h.to === null).map((h) => h.threadId));
    for (const p of x.prs) {
      if (!ids.has(p.thread_id) || !p.url || (p.state !== "open" && p.state !== "draft")) continue;
      const review = p.sig.startsWith("v2|") ? p.sig.split("|")[4] || null : null;
      if (p.checks === "pending") out.push({ from: r.address, on: "ci", kind: "ci", label: `PR #${p.number ?? "?"}`, since: null, ref: p.url, block: false });
      else if (p.state === "open" && (review === "review_required" || review === "review_requested" || p.attention === "review_requested"))
        out.push({ from: r.address, on: "review", kind: "review", label: `PR #${p.number ?? "?"}`, since: null, ref: p.url, block: false });
    }
  }
  return out.sort((a, b) => Number(b.block) - Number(a.block) || DEP_RANK[a.kind] - DEP_RANK[b.kind] || (a.since ?? Infinity) - (b.since ?? Infinity));
}
