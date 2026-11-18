// The CodeRabbit review queue's server side (2026-11-18, ported from a contributor's public PR): its read RPC, the
// owner's actions (server.ts routes them through its page-only write), and its timer.
//
// The timer: armTimer() below is the only place a run is scheduled. It sets one timeout, and only while Schedule is on
// (config.enabled); Schedule off clears it. With the defaults (Schedule off) there is no timer, no lease and no read.
// The write: review-queue/host.ts post(), reached only from a run (QueueRunner) and returning before the write on
// dry-run (the reviewQueueDryRun setting, on by default).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Db } from "../core/db.ts";
import { orchHostContract } from "../host-contract.ts";
import { configSchema, outstanding, parsePrUrl, pick, QUEUE_MAX, spacingUntil, TRIGGER } from "../core/review-queue.ts";
import { chooseWithProvider } from "./picker.ts";
import { QUEUE_CHANNEL, queueContract, type QueueAction, type QueueView } from "./contract.ts";
import { QueueStore } from "./store.ts";
import { QueueRunner, type Confirmed, type RunKind } from "./runner.ts";

/** A run's deadline: past it the run is cancelled, never finished on stale facts. */
export const RUN_DEADLINE_MS = 5 * 60_000;
/** While a request waits on CodeRabbit's reply (Schedule on), the timer checks again this soon. */
export const RECONCILE_MS = 60_000;
const MAX_DELAY = 2 ** 31 - 1;

export interface QueueDeps {
  db: Db;
  /** The reviewQueueDryRun setting, read at each run. */
  dryRun: () => boolean;
  now?: () => number;
  timers?: { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };
}

export function registerReviewQueue(bb: BbPluginApi, deps: QueueDeps) {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? { set: (f: () => void, ms: number) => setTimeout(f, ms), clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>) };
  const store = new QueueStore(deps.db);
  const host = bb.hosts.experimental_client({ contract: orchHostContract });
  const lifetime = new AbortController();
  let busy: Promise<void> | null = null;
  let running = false; // the background service is up
  let timer: unknown = null;
  const changed = () => bb.realtime.publish(QUEUE_CHANNEL, {});

  /** The machine whose gh login asks: the one chosen in settings, else the only connected one. Never a failover. */
  const hostId = async () => {
    const configured = store.get().config.hostId;
    const hosts = (await bb.sdk.hosts.list()).filter((h) => h.type === "persistent" && h.lifecycle.phase === "active" && h.status === "connected");
    if (configured) {
      if (!hosts.some((h) => h.id === configured)) throw new Error("The chosen GitHub machine is not connected");
      return configured;
    }
    if (hosts.length !== 1) throw new Error("Choose the GitHub machine in queue settings (exactly one must be chosen)");
    return hosts[0]!.id;
  };
  let runHost = "";
  const runner = new QueueRunner(store, {
    now,
    dryRun: () => deps.dryRun(),
    changed,
    identity: async (signal) => {
      runHost = await hostId();
      return host.call("reviewQueue.identity", null, { hostId: runHost, signal });
    },
    inspect: (url, signal) => host.call("reviewQueue.inspect", { url }, { hostId: runHost, signal }),
    discover: (signal) => host.call("reviewQueue.discover", null, { hostId: runHost, signal }),
    outcome: (a, signal) => host.call("reviewQueue.outcome", { url: a.url, at: a.at }, { hostId: runHost, signal }),
    // The dry-run flag is read again here, so a run can never post with the setting on.
    post: (e, login, dryRun, signal) => host.call("reviewQueue.post", { url: e.url, head: e.facts!.head, login, auto: e.auto, dryRun: dryRun || deps.dryRun() }, { hostId: runHost, signal }),
    // The optional model picker (off by default): a short thread in a personal folder on the same machine.
    choose: (eligible, config, signal) => chooseWithProvider(bb.sdk, eligible, config, runHost, signal),
  });

  function disarm() {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }
  /** THE TIMER: one timeout to the next run, only while Schedule is on. */
  function armTimer() {
    disarm();
    if (!running || lifetime.signal.aborted) return;
    const s = store.get();
    if (!s.config.enabled) return;
    let at = s.nextAt ?? now() + s.config.intervalMinutes * 60_000;
    if (outstanding(s.history, now()).length) at = Math.min(at, now() + RECONCILE_MS);
    timer = timers.set(
      () => {
        timer = null;
        kick("tick");
      },
      // at least a minute: a tick that found the lease held (a reload mid-run) leaves nextAt due, and must not spin
      Math.min(MAX_DELAY, Math.max(RECONCILE_MS, at - now())),
    );
  }

  function kick(kind: RunKind, confirmed: Confirmed | null = null): boolean {
    if (busy || lifetime.signal.aborted) return false;
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(RUN_DEADLINE_MS)]);
    busy = runner
      .run(kind, signal, confirmed)
      .catch((e) => bb.log.warn(`review-queue: ${String(e)}`))
      .finally(() => {
        busy = null;
        if (!lifetime.signal.aborted) {
          changed();
          armTimer();
        }
      });
    changed();
    return true;
  }

  bb.rpc.register(queueContract, {
    reviewQueue: async (): Promise<QueueView> => {
      const s = store.get();
      const hosts = await bb.sdk.hosts.list().catch(() => []);
      const providers = await bb.sdk.providers.catalog().catch(() => []);
      const next = pick(s.entries, s.history, s.login, now());
      return {
        ...s,
        dryRun: deps.dryRun(),
        busy: !!busy,
        spacingUntil: spacingUntil(s),
        hosts: hosts.filter((h) => h.type === "persistent").map((h) => ({ id: h.id, name: h.name })),
        providers: providers.filter((p) => p.enabled && p.available).map((p) => ({ id: p.id, name: p.displayName })),
        next: next?.facts ? { url: next.url, head: next.facts.head, title: next.facts.title, comment: TRIGGER } : null,
      };
    },
  });

  /** One owner action, from the page only (server.ts's write route). */
  function act(a: QueueAction): { ok: true } {
    if (a.action === "refresh" || a.action === "run") {
      // A live Run now needs the owner's confirm of the PR and the exact comment; the runner checks it still matches.
      if (a.action === "run" && !deps.dryRun() && !a.confirm) throw new Error("Confirm the PR and the comment before a live run");
      if (!kick(a.action === "refresh" ? "refresh" : "now", a.action === "run" ? (a.confirm ?? null) : null)) throw new Error("A queue run is already going");
      return { ok: true };
    }
    store.mutate((s) => {
      if (a.action === "configure") {
        const old = s.config;
        s.config = configSchema.parse({ ...old, ...a.config });
        if (!s.config.enabled) s.nextAt = null;
        else if (!old.enabled || old.intervalMinutes !== s.config.intervalMinutes) s.nextAt = now() + s.config.intervalMinutes * 60_000;
      }
      if (a.action === "add") {
        const { url } = parsePrUrl(a.url);
        if (s.entries.some((e) => e.url.toLowerCase() === url.toLowerCase())) throw new Error("This PR is already queued");
        if (s.entries.length >= QUEUE_MAX) throw new Error(`The queue is full (${QUEUE_MAX} PRs)`);
        s.entries.push({ url, auto: false, pinned: false, addedAt: now(), facts: null, error: null, fetchedAt: null });
      }
      // Removing a PR keeps its request history: a hold still holds if Auto finds it again.
      if (a.action === "remove") s.entries = s.entries.filter((e) => e.url !== a.url);
      if (a.action === "pin") {
        const e = s.entries.find((e) => e.url === a.url);
        if (!e) throw new Error("This PR is no longer queued");
        const pin = !e.pinned;
        for (const x of s.entries) x.pinned = x === e && pin;
      }
      if (a.action === "reorder") {
        if (a.urls.length !== s.entries.length || new Set(a.urls).size !== a.urls.length || a.urls.some((url) => !s.entries.some((e) => e.url === url)))
          throw new Error("The queue changed; refresh before reordering");
        s.entries = a.urls.map((url) => s.entries.find((e) => e.url === url)!);
      }
    });
    if (a.action === "configure") armTimer();
    // a new PR is read at once (reads only, never a post), so its row fills without a second write from the page
    if (a.action === "add") kick("refresh");
    changed();
    return { ok: true };
  }

  bb.background.service("review-queue", {
    async start(signal) {
      running = true;
      armTimer();
      await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));
      running = false;
      disarm();
    },
  });
  bb.onDispose(() => {
    lifetime.abort();
    disarm();
  });

  return { act, changed, armTimer, store };
}
