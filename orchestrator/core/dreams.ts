// The nightly dream batch and the daily memory check (docs/rebuild-inventory.md, "Nightly dream batch", gap 5). Off
// unless dreamsEnabled is on and a memory config is set. Once a day at dailyAt in the dream zone: the memory check (code, no model), then one
// `memory-dream-launch --auto` run, detached. When it ends: one approval card in Needs you if a page is ready, else
// the digest. On the owner's answer: `memory-dream-publish` per run, detached, then the digest on the Board. Every step is
// saved in the store before the next starts, so a restart neither launches twice nor files a second card. The tools,
// the clock and the systemd reads are ports: tests never run a memory tool.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { type Db, tx } from "./db.ts";
import type { Engine } from "./engine.ts";
import { ownerOnScreen } from "./owner.ts";

/** The caps: 5 projects, 100 minutes in all, 2 h for the launch, 10 min per publish. */
export const LIMITS = { batch: 5, totalMinutes: 100, launchSec: 2 * 3600, publishSec: 600 };
/** How long past its timeout a job with no exit file counts as lost: `timeout -k 30` has killed it by then. */
export const GRACE_SEC = 300;
/** The memory check: a vault with no commit for VAULT_STALE_H is stale (timers: the memoryTimers setting). */
export const VAULT_STALE_H = 48;

/**
 * The memoryTimers setting: `<unit>.timer=<minutes>` pairs, space- or comma-separated. A listed timer whose last run is
 * older than its minutes is stale. Malformed pairs are skipped.
 */
export function parseTimers(setting: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of (setting ?? "").split(/[\s,]+/).filter(Boolean)) {
    const m = /^([A-Za-z0-9@._-]+\.timer)=(\d+(?:\.\d+)?)$/.exec(pair);
    if (m) out[m[1]!] = Number(m[2]) * 60_000;
  }
  return out;
}

/** The memoryUnits setting: systemd unit patterns (`name-*`), space- or comma-separated, checked for failures. */
export const parseUnits = (setting: string | undefined): string[] =>
  (setting ?? "").split(/[\s,]+/).filter((u) => /^[A-Za-z0-9@._*][A-Za-z0-9@._*-]*$/.test(u));

export type Job = { name: string; startedAt: number; exit: number | null; finishedAt: number | null; timeoutSec: number; via: string | null; lost?: boolean };
export type Candidate = {
  run: string; slug: string; ready: boolean; why: string | null;
  added: number | null; removed: number | null; lines: string[]; diff: string | null; carried: boolean; promoted: boolean;
};
export type Published = { run: string; slug: string; status: string; commit?: string | null; why?: string };
export type Batch = {
  date: string; run: string; state: "launching" | "asked" | "publishing" | "done";
  note: string | null; skipped: string[]; carry: string[]; launch: Job | null; picked: string[] | null;
  candidates: Candidate[]; decision: string | null; answer: { option: string | null; text: string | null } | null;
  publish: Job[]; published: Published[]; digest: string | null;
};
export type RunResults = { picked: string[] | null; ran: boolean; candidates: Candidate[] };
export type MemFacts = { failed: string[]; timers: { unit: string; active: string | null; last: number | null }[]; vaultLastCommit: number | null; errors: string[] };

export interface DreamPorts {
  now(): number;
  /** Start `memory-dream-launch <args>` detached (systemd-run, else setsid); its exit lands in a file. */
  launch(b: Batch, job: Job, args: string[]): Promise<string>;
  /** Start `memory-dream-publish <args>` detached, the same way. */
  publish(b: Batch, job: Job, args: string[]): Promise<string>;
  /** A started job's exit code once its exit file exists, else null; and what it printed. */
  poll(b: Batch, job: Job): { exit: number | null; out: string };
  /** What a run left in the dream folder: pick.json's picks, whether run.json exists, its unpublished candidates. */
  results(run: string, carried: boolean): RunResults;
  /** The memory units and the vault, read-only. */
  memFacts(): Promise<MemFacts>;
  log(msg: string): void;
}

/** `owner`: the ownerName setting, for the digest the owner reads on the Board ("" = "you"). */
export type DreamOptions = { enabled: boolean; dailyAt: string; zone: string; carry: string[]; held: string[]; owner?: string; timers?: Record<string, number> };

// ---- dates in the dream zone

const validZone = (z: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return "UTC";
  }
};
const partsIn = (zone: string, ms: number) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** The date (YYYY-MM-DD) at `ms` in `zone`. */
export function dateIn(zone: string, ms: number): string {
  const p = partsIn(validZone(zone), ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The instant of `hhmm` on `date` in `zone` (the first one, on a DST change). */
export function wallTime(zone: string, date: string, hhmm: string): number {
  const z = validZone(zone);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const asZone = (ms: number) => {
    const q = partsIn(z, ms);
    return Date.UTC(Number(q.year), Number(q.month) - 1, Number(q.day), Number(q.hour) % 24, Number(q.minute));
  };
  let t = guess - (asZone(guess) - guess);
  t = guess - (asZone(t) - t);
  return t;
}

// ---- the dream config (the memory config's memory block, which the memory tools read too)

export type DreamConfig = { dreamDir: string; dailyAt: string; carry: string[] };

/** memory.dreamDir, memory.dailyAt and memory.carry from the memory config, or null with the reason. */
export function loadDreamConfig(path: string, home = homedir()): { config: DreamConfig | null; why: string } {
  let raw: { memory?: Record<string, unknown> };
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { config: null, why: `${path}: ${String(e)}` };
  }
  const m = raw?.memory ?? {};
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  let dreamDir = s(m.dreamDir);
  if (dreamDir === "~" || dreamDir.startsWith("~/")) dreamDir = join(home, dreamDir.slice(1));
  if (!dreamDir || !isAbsolute(dreamDir)) return { config: null, why: `${path} has no absolute memory.dreamDir` };
  const carry = Array.isArray(m.carry) ? m.carry.filter((r): r is string => typeof r === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(r)) : [];
  return { config: { dreamDir, dailyAt: s(m.dailyAt), carry }, why: "" };
}

/** The folder of the memory tools: memory-search's real folder (memory.search, a path or a name on PATH). */
export function toolsDir(search: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = search.includes("/") ? [search] : (env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => join(d, search));
  for (const c of candidates) {
    try {
      if (existsSync(c)) return dirname(realpathSync(c));
    } catch {
      // next
    }
  }
  return null;
}

// ---- command lines (the tools' own contracts: memory-dream-launch and memory-dream-publish docstrings)

/** The run id: `dream-<date>-o`, apart from a `dream-<date>` another scheduler may run, and of the shape the publisher's trailer allows. */
export const runId = (date: string) => `dream-${date}-o`;

export function launchArgs(run: string, sitOut: string[]): string[] {
  return ["--run", run, "--auto", String(LIMITS.batch), "--total-minutes", String(LIMITS.totalMinutes), ...(sitOut.length ? ["--skip", sitOut.join(",")] : [])];
}

export function publishArgs(run: string, decision: string | null, slugs: string[]): string[] {
  return ["--run", run, ...(decision ? ["--decision", decision] : []), ...slugs];
}

/** memory-dream-publish prints one JSON line per slug. */
export function parsePublished(run: string, out: string): Published[] {
  const rows: Published[] = [];
  for (const l of out.split("\n")) {
    if (!l.startsWith("{")) continue;
    try {
      rows.push({ run, ...JSON.parse(l) });
    } catch {
      // not a result line
    }
  }
  return rows;
}

const done = (p: Published) => p.status === "published" || p.status === "already";
/** base's records, each replaced by incoming's for the same page, except that a failure never replaces a publish. */
function mergePublished(base: Published[], incoming: Published[]): Published[] {
  const out = [...base];
  for (const p of incoming) {
    const i = out.findIndex((x) => x.run === p.run && x.slug === p.slug);
    if (i < 0) out.push(p);
    else if (done(p) || !done(out[i]!)) out[i] = p;
  }
  return out;
}

// ---- the card and the digest (code, not a model)

export function card(b: Batch) {
  const ready = b.candidates.filter((c) => c.ready);
  const refused = b.candidates.filter((c) => !c.ready);
  const n = ready.length;
  const pages = `${n} memory page${n === 1 ? "" : "s"}`;
  const L: string[] = [];
  if (b.note) L.push(`Run ${b.run}: ${b.note}.`, "");
  else if (b.picked) L.push(`Run ${b.run}: ${b.picked.length} project${b.picked.length === 1 ? "" : "s"} with new sources ran${b.skipped.length ? ` (on hold, skipped: ${b.skipped.join(", ")})` : ""}.`, "");
  L.push("**Ready to publish**");
  for (const c of ready) {
    L.push(`- **${c.slug}** (${c.run}): +${c.added ?? "?"} −${c.removed ?? "?"} lines.`);
    for (const l of c.lines) L.push(`  ${l}`);
    if (c.diff) L.push(`  Full diff: \`${c.diff}\``);
  }
  if (refused.length) {
    L.push("", "**Refused (can't be published as they are)**");
    for (const c of refused) L.push(`- **${c.slug}** (${c.run}): ${c.why}.${c.diff ? ` Diff: \`${c.diff}\`` : ""}`);
  }
  for (const run of b.carry) {
    const promoted = b.candidates.filter((c) => c.run === run && c.promoted).map((c) => c.slug);
    L.push("", `**Carried from run ${run}** (never published).` + (promoted.length ? ` Its checkpoint for ${promoted.join(", ")} already moved when it ran, so rejecting it won't make the next run read those sources again.` : ""));
  }
  L.push("", "Publishing makes one vault commit per page.");
  let context = L.join("\n");
  if (Buffer.byteLength(context) > 8000) context = Buffer.from(context).subarray(0, 7800).toString().replace(/�$/, "") + "\n\n[cut to fit the card: see the run folders]";
  return {
    title: `Publish ${pages}?`,
    question: `The nightly memory batch (${b.date}) has ${pages} ready for the vault${refused.length ? ` and ${refused.length} refused` : ""}. Publish them?`,
    context,
    options: [
      { label: `Publish the ${n} ready page${n === 1 ? "" : "s"}`, detail: ready.map((c) => c.slug).join(", ").slice(0, 300) },
      { label: "Publish none", detail: "Nothing changes in the vault; their checkpoints stay, so the next run reads those sources again." },
    ],
  };
}

export function digestText(b: Batch, ownerName = ""): string {
  const who = ownerOnScreen(ownerName).Name;
  const ready = b.candidates.filter((c) => c.ready).length;
  const refused = b.candidates.filter((c) => !c.ready);
  const ok = b.published.filter(done);
  const bad = b.published.filter((p) => !done(p));
  let text: string;
  if (!b.candidates.length) text = `${b.note ?? "no project had new sources"}; nothing to approve.`;
  else if (!ready) text = `no page ready; refused: ${refused.map((c) => `${c.slug} (${c.why})`).join("; ")}. Nothing to approve.`;
  else {
    const said = b.answer?.option === "1" ? `${who} approved` : b.answer?.option === "2" ? `${who} chose to publish none` : b.answer ? `${who} answered in words; nothing published` : "the card was closed";
    text =
      `card ${b.decision}: ${ready} ready, ${refused.length} refused; ${said}` +
      (ok.length ? `; published ${ok.map((p) => p.slug).join(", ")}` : "") +
      (bad.length ? `; not published: ${bad.map((p) => `${p.slug} (${p.why ?? p.status})`).join("; ")}` : "") +
      ".";
  }
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text;
}

// ---- the memory check

/** What is wrong with memory, from read-only facts; [] when all is well. */
export function memProblems(f: MemFacts, now: number, timers: Record<string, number> = {}): string[] {
  const out: string[] = [...f.errors];
  for (const u of f.failed) out.push(`${u} has failed`);
  for (const [unit, limit] of Object.entries(timers)) {
    const t = f.timers.find((x) => x.unit === unit);
    if (!t) out.push(`${unit} isn't loaded`);
    else if (t.active !== "active") out.push(`${unit} is ${t.active ?? "not active"}`);
    else if (t.last === null) out.push(`${unit} has never run`);
    else if (now - t.last > limit) out.push(`${unit} last ran ${Math.round((now - t.last) / 60_000)} min ago`);
  }
  if (f.vaultLastCommit === null) out.push("the vault's last commit couldn't be read");
  else if (now - f.vaultLastCommit > VAULT_STALE_H * 3600_000) out.push(`the vault's last commit is ${Math.round((now - f.vaultLastCommit) / 3600_000)} h old`);
  return out;
}

// ---- the service

export class Dreams {
  private db: Db;
  private engine: Engine;
  private ports: DreamPorts;
  private opts: () => DreamOptions;
  private stepping: Promise<void> | null = null;
  private failing = new Map<string, string>();

  constructor(db: Db, engine: Engine, ports: DreamPorts, opts: () => DreamOptions) {
    this.db = db;
    this.engine = engine;
    this.ports = ports;
    this.opts = opts;
  }

  batch(date: string): Batch | null {
    const r = this.db.prepare(`SELECT json FROM dream_batches WHERE date = ?`).get(date) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as Batch) : null;
  }

  batches(limit = 1000): Batch[] {
    return (this.db.prepare(`SELECT json FROM dream_batches ORDER BY date DESC LIMIT ?`).all(limit) as { json: string }[]).map((r) => JSON.parse(r.json) as Batch);
  }

  private save(b: Batch): void {
    this.db
      .prepare(
        `INSERT INTO dream_batches (date, run, state, decision_id, json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET run = excluded.run, state = excluded.state, decision_id = excluded.decision_id, json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(b.date, b.run, b.state, b.decision, JSON.stringify(b), this.ports.now());
  }

  /** Today's date and due time in the dream zone. */
  due(): { date: string; at: number | null } {
    const o = this.opts();
    const now = this.ports.now();
    const date = dateIn(o.zone, now);
    return { date, at: /^\d{2}:\d{2}$/.test(o.dailyAt) ? wallTime(o.zone, date, o.dailyAt) : null };
  }

  /** One pass: advance batches under way; once a day at dailyAt, the memory check and then tonight's batch. */
  step(): Promise<void> {
    this.stepping ??= this.pass().finally(() => {
      this.stepping = null;
    });
    return this.stepping;
  }

  private async pass(): Promise<void> {
    for (const b of this.batches()) {
      if (b.state === "done") continue;
      try {
        await this.advance(b);
        this.failing.delete(b.date);
      } catch (e) {
        const why = String((e as Error)?.message ?? e).slice(0, 300);
        if (this.failing.get(b.date) !== why) this.ports.log(`dreams ${b.date}: ${why}`);
        this.failing.set(b.date, why);
      }
    }
    const o = this.opts();
    if (!o.enabled) return;
    const { date, at } = this.due();
    if (at === null || this.ports.now() < at) return;
    // the check first; a check that can't run never holds up the batch
    await this.memcheck(date).catch((e) => this.ports.log(`memcheck ${date}: ${String((e as Error)?.message ?? e)}`));
    if (!this.batch(date)) await this.start(date);
  }

  /** The command lines tonight's batch would run, for `dreams run-now --dry-run`. */
  plan(date: string): { run: string; skipped: string[]; carry: string[]; args: string[] } {
    const o = this.opts();
    const carried = new Set(this.batches().flatMap((x) => x.carry));
    const carry = o.carry.filter((r) => !carried.has(r));
    const skipped = [...o.held].sort();
    // A carried page's project sits out tonight's run too: a fresh page, published first, would leave the carried one
    // stale, and its run already moved the checkpoint, so what it read would never be read again.
    const sitOut = [...new Set([...skipped, ...carry.flatMap((r) => this.ports.results(r, true).candidates.map((c) => c.slug))])].sort();
    const run = runId(date);
    return { run, skipped, carry, args: launchArgs(run, sitOut) };
  }

  /** Start the batch for `date`: saved first, then launched, so a restart finds it and never launches it again. */
  async start(date: string): Promise<Batch> {
    const existing = this.batch(date);
    if (existing) return existing;
    const now = this.ports.now();
    const p = this.plan(date);
    const b: Batch = {
      date, run: p.run, state: "launching", note: null, skipped: p.skipped, carry: p.carry, launch: null, picked: null,
      candidates: [], decision: null, answer: null, publish: [], published: [], digest: null,
    };
    const running = this.batches().find((x) => x.state === "launching" || x.state === "publishing");
    if (running) {
      b.note = `the batch of ${running.date} was still ${running.state}`;
      b.carry = []; // a night that never ran carries nothing: the runs stay for the next one
      this.finish(b);
      return b;
    }
    b.launch = { name: "launch", startedAt: now, exit: null, finishedAt: null, timeoutSec: LIMITS.launchSec, via: null };
    this.save(b);
    try {
      b.launch.via = await this.ports.launch(b, b.launch, p.args);
      this.save(b);
    } catch (e) {
      b.launch.exit = -1;
      b.launch.finishedAt = this.ports.now();
      b.note = `the launcher didn't start: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
      b.carry = [];
      this.finish(b);
    }
    return b;
  }

  /** The job's exit code once it has finished; a job with no exit file past its timeout plus GRACE_SEC was lost (124). */
  private finished(b: Batch, j: Job): number | null {
    if (j.exit !== null) return j.exit;
    const now = this.ports.now();
    const { exit } = this.ports.poll(b, j);
    if (exit === null) {
      if (now - j.startedAt < (j.timeoutSec + GRACE_SEC) * 1000) return null;
      j.lost = true;
      j.exit = 124;
    } else j.exit = exit;
    j.finishedAt = now;
    return j.exit;
  }

  private async advance(b: Batch): Promise<void> {
    if (b.state === "launching") {
      if (!b.launch || this.finished(b, b.launch) === null) return;
      const r = this.ports.results(b.run, false);
      b.picked = r.picked;
      b.candidates = [...r.candidates, ...b.carry.flatMap((run) => this.ports.results(run, true).candidates)];
      if (b.launch.exit !== 0 && !r.ran) b.note = b.launch.lost ? "the launch was lost (no exit after its timeout)" : `the batch didn't run (launcher exit ${b.launch.exit})`;
      if (!b.candidates.some((c) => c.ready)) return this.finish(b);
      const c = card(b);
      tx(this.db, () => {
        const d = this.engine.orchestratorAsk({ ...c, key: `memory:dream-${b.date}`, allowText: false });
        b.decision = d.id;
        b.state = "asked";
        this.save(b);
      });
      this.ports.log(`dreams ${b.date}: card ${b.decision}`);
    } else if (b.state === "asked") {
      const d = this.engine.decision(b.decision!);
      if (!d) return this.finish(b);
      if (d.state === "answered" || d.state === "acked") {
        b.answer = { option: d.answer?.option ?? null, text: d.answer?.text ?? null };
        if (b.answer.option === "1") {
          b.state = "publishing";
          this.save(b);
          await this.advancePublish(b);
        } else this.finish(b);
      } else if (d.state === "withdrawn" || d.state === "merged") this.finish(b);
    } else if (b.state === "publishing") await this.advancePublish(b);
  }

  /** The ready candidates the approval covers, by run, in card order. */
  private groups(b: Batch): [string, string[]][] {
    const out = new Map<string, string[]>();
    for (const c of b.candidates) if (c.ready) out.set(c.run, [...(out.get(c.run) ?? []), c.slug]);
    return [...out.entries()];
  }

  /** One publish job per run, one after the other; each saved before it starts. Then the digest. */
  private async advancePublish(b: Batch): Promise<void> {
    for (const [i, [run, slugs]] of this.groups(b).entries()) {
      const name = `publish-${i + 1}`;
      let j = b.publish.find((x) => x.name === name);
      if (!j) {
        j = { name, startedAt: this.ports.now(), exit: null, finishedAt: null, timeoutSec: LIMITS.publishSec, via: null };
        b.publish.push(j);
        this.save(b);
        try {
          j.via = await this.ports.publish(b, j, publishArgs(run, b.decision, slugs));
        } catch (e) {
          j.exit = -1;
          j.finishedAt = this.ports.now();
          b.published = mergePublished(b.published, slugs.map((s) => ({ run, slug: s, status: "error", why: `publish didn't start: ${String((e as Error)?.message ?? e).slice(0, 200)}` })));
        }
        this.save(b);
        if (j.exit === null) return;
        continue;
      }
      const code = this.finished(b, j);
      if (code === null) {
        this.save(b);
        return;
      }
      if (j.exit === -1) continue; // never started: recorded above
      const got = parsePublished(run, this.ports.poll(b, j).out);
      const why = j.lost ? "publish job lost (no exit after its timeout)" : `publish exit ${code}`;
      b.published = mergePublished(b.published, slugs.map((s) => got.find((p) => p.slug === s) ?? { run, slug: s, status: "error", why }));
      this.save(b);
    }
    this.finish(b);
  }

  /** The digest on the Board, the card closed, the batch done: one transaction. */
  private finish(b: Batch): void {
    const text = digestText(b, this.opts().owner);
    tx(this.db, () => {
      const d = b.decision ? this.engine.decision(b.decision) : null;
      if (d?.state === "answered") this.engine.orchestratorAck(d.id, "done", text.slice(0, 300));
      this.engine.boardAdd("dream", "orchestrator", null, `Dream batch ${b.date}`, text, b.decision);
      b.digest = text;
      b.state = "done";
      this.save(b);
    });
    this.ports.log(`dreams ${b.date}: done`);
  }

  // ---- the daily memory check

  lastMemcheck(): { date: string; problems: string[]; posted: boolean; at: number } | null {
    const r = this.db.prepare(`SELECT * FROM memchecks ORDER BY date DESC LIMIT 1`).get() as { date: string; problems: string; posted: number; at: number } | undefined;
    return r ? { date: r.date, problems: JSON.parse(r.problems), posted: r.posted === 1, at: r.at } : null;
  }

  /** Once per date: read the facts; on the Board only when something is wrong, or on the very first check. */
  async memcheck(date: string): Promise<string[] | null> {
    if (this.db.prepare(`SELECT 1 FROM memchecks WHERE date = ?`).get(date)) return null;
    const facts = await this.ports.memFacts();
    const now = this.ports.now();
    const problems = memProblems(facts, now, this.opts().timers ?? {});
    tx(this.db, () => {
      if (this.db.prepare(`SELECT 1 FROM memchecks WHERE date = ?`).get(date)) return;
      const first = !this.db.prepare(`SELECT 1 FROM memchecks LIMIT 1`).get();
      const post = problems.length > 0 || first;
      this.db.prepare(`INSERT INTO memchecks (date, problems, posted, at) VALUES (?, ?, ?, ?)`).run(date, JSON.stringify(problems), post ? 1 : 0, now);
      if (post)
        this.engine.boardAdd(
          "memcheck",
          "orchestrator",
          null,
          problems.length ? `Memory check ${date}: ${problems.length} problem${problems.length === 1 ? "" : "s"}` : `Memory check ${date}: all well`,
          problems.length ? problems.map((p) => `- ${p}`).join("\n") : "Memory units and timers are healthy and the vault is current. From now on this shows only when something is wrong.",
          null,
        );
    });
    return problems;
  }

  // ---- CLI text

  status(): string {
    const o = this.opts();
    const { date, at } = this.due();
    const lines = [
      `dreams: ${o.enabled ? "on" : "off (dreamsEnabled)"}; daily at ${o.dailyAt || "(unset)"} ${o.zone}; today ${date}${at !== null ? `, due ${new Date(at).toISOString()}` : ""}`,
    ];
    const m = this.lastMemcheck();
    lines.push(m ? `memory check ${m.date}: ${m.problems.length ? m.problems.join("; ") : "all well"}` : "memory check: never run");
    const bs = this.batches(7);
    if (!bs.length) lines.push("no batches");
    for (const b of bs)
      lines.push(`${b.date} ${b.run} ${b.state}${b.decision ? ` card ${b.decision}` : ""}: ${b.candidates.filter((c) => c.ready).length} ready, ${b.candidates.filter((c) => !c.ready).length} refused${b.digest ? `; ${b.digest}` : b.note ? `; ${b.note}` : ""}`);
    return lines.join("\n");
  }
}

// ---- the real ports (not used by tests)

/**
 * What a systemd-run job gets with --setenv. Argv is world-readable (/proc/<pid>/cmdline), so only these non-secret
 * names go there; the unit inherits the rest of a timer's environment from the user manager, as memory-dream-launch
 * expects (it drops the session's CLAUDE* variables itself).
 */
export const UNIT_ENV = ["PATH", "HOME", "LANG", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "CLAUDE_CONFIG_DIR"];
export const unitSetenv = (env: NodeJS.ProcessEnv, configEnv: string | null = null): string[] =>
  [...(configEnv ? [configEnv] : []), ...UNIT_ENV].filter((k) => env[k] !== undefined && !env[k]!.includes("\n")).map((k) => `--setenv=${k}=${env[k]}`);
const run = (cmd: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv = process.env) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 << 20, env }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err ? err.message : "") });
    });
  });

/**
 * The ports over the real memory tools. Each job runs `python3 -I <tools>/<tool> <args>` under `timeout -k 30`, with
 * the memory config's path in `configEnv` (when set), and writes its exit code to <jobsDir>/<date>-<job>.exit when it ends. When this process runs
 * under systemd, a job is its own transient user unit (bb-orch-dream-<date>-<job>), so a bb restart doesn't kill it;
 * otherwise, or if systemd-run fails, it runs in its own session.
 */
export function realDreamPorts(p: { jobsDir: string; tools: () => string | null; memoryConfig: () => string | null; configEnv: () => string | null; dreamDir: () => string | null; vault: () => string | null; units: () => string[]; log: (m: string) => void }): DreamPorts {
  const path = (b: Batch, j: Job, ext: "out" | "exit") => join(p.jobsDir, `${b.date}-${j.name}.${ext}`);
  async function startJob(b: Batch, j: Job, tool: string, args: string[]): Promise<string> {
    const tools = p.tools();
    const config = p.memoryConfig();
    if (!tools || !config) throw new Error("memory tools or memory config not found");
    mkdirSync(p.jobsDir, { recursive: true });
    const script = 'out=$1; ex=$2; t=$3; shift 3; timeout -k 30 "$t" "$@" > "$out" 2>&1; echo $? > "$ex.tmp"; mv "$ex.tmp" "$ex"';
    const cmd = ["sh", "-c", script, "sh", path(b, j, "out"), path(b, j, "exit"), String(j.timeoutSec), "python3", "-I", join(tools, tool), ...args];
    const configEnv = p.configEnv();
    const env: NodeJS.ProcessEnv = configEnv ? { ...process.env, [configEnv]: config } : { ...process.env };
    if (process.env.INVOCATION_ID) {
      const sets = unitSetenv(env, configEnv);
      const r = await run("systemd-run", ["--user", "--collect", "--quiet", "--same-dir", `--unit=bb-orch-dream-${b.date}-${j.name}`, ...sets, "--", ...cmd], 30_000, env);
      if (r.code === 0) return "systemd-run";
      p.log(`dreams ${b.date} ${j.name}: systemd-run exit ${r.code}: ${r.stderr.trim().slice(-200)}; using setsid`);
    }
    const child = spawn(cmd[0]!, cmd.slice(1), { detached: true, stdio: "ignore", env });
    child.unref();
    return "setsid";
  }
  const readJson = (f: string): any => {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      return null;
    }
  };
  return {
    now: () => Date.now(),
    launch: (b, j, args) => startJob(b, j, "memory-dream-launch", args),
    publish: (b, j, args) => startJob(b, j, "memory-dream-publish", args),
    poll(b, j) {
      let exit: number | null = null;
      try {
        const n = parseInt(readFileSync(path(b, j, "exit"), "utf8").trim(), 10);
        exit = Number.isFinite(n) ? n : -1;
      } catch {
        // no exit file yet
      }
      let out = "";
      try {
        out = readFileSync(path(b, j, "out"), "utf8");
      } catch {
        // none
      }
      return { exit, out };
    },
    results(runName, carried) {
      const dream = p.dreamDir();
      if (!dream) return { picked: null, ran: false, candidates: [] };
      const rdir = join(dream, "runs", runName);
      const rj = readJson(join(rdir, "run.json"));
      const candidates: Candidate[] = [];
      for (const r of rj?.results ?? []) {
        if (String(r.status ?? "").startsWith("refused")) continue; // never started
        const wdir = join(rdir, r.slug);
        if (existsSync(join(wdir, "published.json"))) continue;
        const m = readJson(join(wdir, "metrics.json")) ?? r;
        const diffPath = join(wdir, "candidate.diff");
        const diff = existsSync(diffPath) ? readFileSync(diffPath, "utf8") : null;
        const man = readJson(join(dream, "manifests", `${r.slug}.json`));
        const why = whyNot(m);
        candidates.push({
          run: runName, slug: r.slug, ready: why === null, why, added: m.diff_lines?.added ?? null, removed: m.diff_lines?.removed ?? null,
          lines: gist(diff), diff: diff === null ? null : diffPath, carried, promoted: man?.run === runName,
        });
      }
      return { picked: readJson(join(rdir, "pick.json"))?.picked ?? null, ran: rj !== null, candidates };
    },
    async memFacts() {
      const errors: string[] = [];
      const failed: string[] = [];
      const timers: MemFacts["timers"] = [];
      const patterns = p.units();
      const units = patterns.length ? await run("systemctl", ["--user", "list-units", "--all", "--output=json", ...patterns], 30_000) : { code: 0, stdout: "[]", stderr: "" };
      if (units.code !== 0) errors.push(`systemctl list-units: ${units.stderr.trim().slice(-200)}`);
      else
        for (const u of (JSON.parse(units.stdout || "[]") as { unit: string; active: string }[])) {
          if (u.active === "failed") failed.push(u.unit);
          if (u.unit.endsWith(".timer")) timers.push({ unit: u.unit, active: u.active, last: null });
        }
      const lt = await run("systemctl", ["--user", "list-timers", "--all", "--output=json"], 30_000);
      if (lt.code === 0)
        for (const t of JSON.parse(lt.stdout || "[]") as { unit: string; last: number | null }[]) {
          const row = timers.find((x) => x.unit === t.unit);
          if (row && t.last) row.last = Math.round(t.last / 1000);
        }
      else errors.push(`systemctl list-timers: ${lt.stderr.trim().slice(-200)}`);
      let vaultLastCommit: number | null = null;
      const vault = p.vault();
      if (vault) {
        const g = await run("git", ["-C", vault, "log", "-1", "--format=%ct"], 30_000);
        const s = parseInt(g.stdout.trim(), 10);
        if (g.code === 0 && Number.isFinite(s)) vaultLastCommit = s * 1000;
      }
      return { failed, timers, vaultLastCommit, errors };
    },
    log: p.log,
  };
}

/** Why a launcher result isn't publishable, or null when it is (the publisher checks it all again). */
function whyNot(m: any): string | null {
  if (!m || m.status !== "ok") return `the worker ended ${m?.status ?? "without a record"}`;
  if (m.missing_out_files?.length || m.unexpected_out_files?.length) return "its out/ isn't the two expected files";
  if (m.scan_findings) return `secret scan: ${m.scan_findings} finding(s)`;
  if (m.files_outside_out?.length) return "it wrote outside out/";
  if (m.page_problems?.length) return m.page_problems.join("; ");
  return null;
}

/** A few lines of what the page would change: the first added bullets of the candidate's diff. */
function gist(diff: string | null): string[] {
  if (!diff) return [];
  return diff.split("\n").filter((l) => l.startsWith("+- ")).slice(0, 2).map((l) => (l.length > 160 ? l.slice(1, 158) + "…" : l.slice(1)));
}
