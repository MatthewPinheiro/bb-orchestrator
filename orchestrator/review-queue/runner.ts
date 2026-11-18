// One review-queue run (2026-11-18, ported from a contributor's public PR): reconcile the requests still waiting on
// CodeRabbit, re-read every queued PR, let Auto add the owner's green PRs when nothing queued is eligible, then ask for
// at most one review. The pick is deterministic (core/review-queue.ts pick) unless the owner set up the optional model
// picker (review-queue/picker.ts); the model only ranks PRs that already passed every check, and any failure, timeout or
// stale answer falls back to the deterministic pick. A pin or a confirmed live Run now never asks the model.
//
// What keeps it from asking twice: the durable lease (one run at a time, across reloads), the "posting" intent saved
// before the write, the global spacing, the per-PR hold, and a fresh read of the chosen PR right before it is asked.
// Dry-run (the reviewQueueDryRun setting, on by default) goes as far as the host's final recheck and records the PR it
// would have asked; it never reaches the write.
import { randomUUID } from "node:crypto";
import { assess, outstanding, pick, spacingUntil, TRIGGER, QUEUE_MAX, type Attempt, type Entry, type Facts, type Outcome, type QueueConfig, type QueueState } from "../core/review-queue.ts";
import type { QueueStore } from "./store.ts";

export interface QueuePorts {
  now(): number;
  dryRun(): boolean;
  identity(signal: AbortSignal): Promise<string>;
  inspect(url: string, signal: AbortSignal): Promise<Facts>;
  discover(signal: AbortSignal): Promise<string[]>;
  outcome(a: Attempt, signal: AbortSignal): Promise<{ outcome: Outcome | null; cooldownUntil: number | null }>;
  post(e: Entry, login: string, dryRun: boolean, signal: AbortSignal): Promise<{ outcome: Outcome; commentUrl: string | null; note: string }>;
  /** The optional model picker: called only when config.pickerProvider is set. */
  choose(eligible: Entry[], config: QueueConfig, signal: AbortSignal): Promise<{ url: string | null; note: string }>;
  changed(): void;
}

/** "refresh": read only. "tick": the timer's run (only when due). "now": the owner's Run now. */
export type RunKind = "refresh" | "tick" | "now";
/** What the owner confirmed for a live Run now: this PR at this head. */
export type Confirmed = { url: string; head: string };

const errText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 800);
const DETERMINISTIC = "Deterministic: pin, approval tier, then queue order";
const eligibleIn = (s: QueueState, login: string, now: number) => s.entries.filter((e) => assess(e, s.history[e.url] ?? null, login, now).eligible);

export class QueueRunner {
  private store: QueueStore;
  private ports: QueuePorts;
  constructor(store: QueueStore, ports: QueuePorts) {
    this.store = store;
    this.ports = ports;
  }

  async run(kind: RunKind, signal: AbortSignal, confirmed: Confirmed | null = null): Promise<void> {
    const { store, ports: p } = this;
    const token = randomUUID();
    if (!store.claim(token, p.now())) return;
    const alive = () => {
      signal.throwIfAborted();
      if (!store.owns(token, p.now())) throw new Error("Queue run lease expired");
    };
    try {
      const config = store.get().config;
      const due = kind !== "tick" || (config.enabled && (store.get().nextAt ?? Infinity) <= p.now());
      const waiting = outstanding(store.get().history, p.now()).length > 0;
      if (!due && !waiting) return;
      const identity = await p.identity(signal);
      alive();
      store.mutate((s) => {
        s.login = identity;
        s.error = null;
      });
      // Reconcile pending requests, even for PRs since removed from the visible queue.
      for (const a of outstanding(store.get().history, p.now())) {
        const result = await p.outcome(a, signal);
        alive();
        store.mutate((s) => {
          const current = s.history[a.url];
          if (!current || current.at !== a.at) return;
          if (result.outcome) {
            current.outcome = result.outcome;
            if (result.outcome === "rate_limited") current.attempts = Math.max(0, current.attempts - 1);
          } else if (p.now() - a.at > 3 * 60_000 && a.outcome === "posted") current.outcome = "no_reply";
          if (result.cooldownUntil) s.cooldownUntil = Math.max(s.cooldownUntil ?? 0, result.cooldownUntil);
        });
      }
      if (!due) return;
      // Sequential reads of a bounded queue. A failed read leaves an error, never the last good facts, so stale
      // facts can't make a PR eligible.
      for (const e of store.get().entries) {
        try {
          const f = await p.inspect(e.url, signal);
          alive();
          store.mutate((s) => {
            const current = s.entries.find((x) => x.url === e.url);
            if (current) Object.assign(current, { facts: f, error: null, fetchedAt: p.now() });
          });
        } catch (err) {
          alive();
          store.mutate((s) => {
            const current = s.entries.find((x) => x.url === e.url);
            if (current) current.error = errText(err);
          });
        }
      }
      let s = store.get();
      if (kind !== "refresh" && s.config.auto && !pick(s.entries, s.history, identity, p.now())) {
        const urls = await p.discover(signal);
        alive();
        for (const url of urls) {
          s = store.get();
          if (s.entries.length >= QUEUE_MAX) break;
          if (s.entries.some((e) => e.url === url)) continue;
          try {
            const f = await p.inspect(url, signal);
            alive();
            const e: Entry = { url, auto: true, pinned: false, addedAt: p.now(), facts: f, error: null, fetchedAt: p.now() };
            if (assess(e, s.history[url] ?? null, identity, p.now()).eligible)
              store.mutate((state) => {
                if (!state.entries.some((x) => x.url === url)) state.entries.push(e);
              });
          } catch {
            alive();
          }
        }
      }
      alive();
      store.mutate((s) => {
        s.fetchedAt = p.now();
      });
      if (kind === "refresh") return;
      s = store.get();
      if (kind === "tick" && !s.config.enabled) return;
      const until = spacingUntil(s);
      if (until > p.now()) {
        store.mutate((s) => {
          s.lastMessage = "Waiting for cooldown / minimum 60-minute spacing";
          s.nextAt = Math.max(s.nextAt ?? 0, until);
        });
        return;
      }
      let chosen = pick(s.entries, s.history, identity, p.now());
      let picker = DETERMINISTIC;
      const eligible = eligibleIn(s, identity, p.now());
      // The model, when set up, ranks two or more eligible PRs. A pin wins without it, and a confirmed live Run now
      // posts the PR its confirm named, so neither asks the model.
      if (chosen && !chosen.pinned && !confirmed && s.config.pickerProvider && eligible.length > 1) {
        let answer: string | null = null;
        try {
          const r = await p.choose(eligible, s.config, signal);
          answer = r.url;
          picker = r.note;
        } catch (err) {
          picker = `Model picker unavailable (${errText(err).slice(0, 120)}); deterministic fallback`;
        }
        alive();
        // The queue may have changed while the model thought: its answer counts only if that PR is still eligible now.
        s = store.get();
        const fallback = pick(s.entries, s.history, identity, p.now());
        const hit = answer ? eligibleIn(s, identity, p.now()).find((e) => e.url === answer) : undefined;
        if (fallback?.pinned) {
          chosen = fallback; // pinned while the model ran: the pin wins
          picker = DETERMINISTIC;
        } else if (hit) chosen = hit;
        else {
          chosen = fallback;
          if (answer) picker = "Model chose a PR that is no longer eligible; deterministic fallback";
        }
      }
      store.mutate((s) => {
        s.lastPicker = picker;
      });
      if (chosen) {
        const url = chosen.url;
        const fresh = await p.inspect(url, signal);
        alive();
        store.mutate((s) => {
          const e = s.entries.find((e) => e.url === url);
          if (e) Object.assign(e, { facts: fresh, fetchedAt: p.now(), error: null });
        });
        s = store.get();
        const e = s.entries.find((e) => e.url === url);
        // The owner may pause, remove, reorder or pin while the reads run.
        if (!e || JSON.stringify(config) !== JSON.stringify(s.config) || !assess(e, s.history[e.url] ?? null, identity, p.now()).eligible)
          throw new Error("Selected PR changed or was removed; nothing posted");
        const dryRun = p.dryRun();
        // A live Run now posts only what the owner confirmed: this PR, at this head.
        if (kind === "now" && !dryRun && (!confirmed || confirmed.url !== e.url || confirmed.head !== fresh.head))
          throw new Error("The next PR changed since you confirmed; nothing posted");
        const at = p.now();
        const previous = s.history[e.url];
        // Durable intent before the only write: a crash or reload after this point still spends the spacing and a hold.
        if (!dryRun)
          store.mutate((s) => {
            s.history[e.url] = { url: e.url, head: fresh.head, at, outcome: "posting", attempts: previous?.head === fresh.head ? previous.attempts + 1 : 1, commentUrl: null };
          });
        let result: Awaited<ReturnType<QueuePorts["post"]>>;
        try {
          result = await p.post(e, identity, dryRun, signal);
        } catch {
          result = { outcome: "unknown", commentUrl: null, note: dryRun ? "Dry-run read interrupted; nothing posted" : "Uncertain post result; held for 3 hours to avoid duplicates" };
        }
        alive();
        store.mutate((s) => {
          if (!dryRun) {
            const a = s.history[e.url]!;
            a.outcome = result.outcome;
            a.commentUrl = result.commentUrl;
            if (["post_failed", "rate_limited"].includes(result.outcome)) a.attempts = Math.max(0, a.attempts - 1);
          } else if (result.outcome === "dry_run") s.wouldPost = { url: e.url, head: fresh.head, at, comment: TRIGGER };
          s.lastMessage = `${result.note}: ${e.url}`;
        });
      } else
        store.mutate((s) => {
          s.lastMessage = "No eligible PRs";
        });
      store.mutate((s) => {
        s.lastAt = p.now();
        s.nextAt = s.config.enabled ? p.now() + s.config.intervalMinutes * 60_000 : null;
      });
    } catch (e) {
      if (!signal.aborted || signal.reason?.name === "TimeoutError")
        store.mutate((s) => {
          s.error = errText(e);
          if (kind !== "refresh") {
            s.lastAt = p.now();
            s.lastMessage = "Run stopped; see error";
            s.nextAt = s.config.enabled ? p.now() + s.config.intervalMinutes * 60_000 : null;
          }
        });
    } finally {
      // Disposed (not timed out): the database may be closed already, so touch nothing; the lease lapses.
      if (!signal.aborted || signal.reason?.name === "TimeoutError") {
        store.release(token);
        p.changed();
      }
    }
  }
}
