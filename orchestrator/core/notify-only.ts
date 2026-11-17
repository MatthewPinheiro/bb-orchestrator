// notifyOnlyOrchestrator: bb notifies the owner only for orchestrator events (README, "Orchestrator notifications only").
// On, it saves push-notifications' defaultLevel and childLevel, sets both to muted, and gives the CoS thread its own
// level (the one it resolved to before) so the owner's conversation with it still notifies. Cards and deliveries go out
// through notifications.send, which thread levels never touch. Off, it restores the saved levels and clears the CoS
// levels it set. The saved state lives in the plugin's kv, so a restart or reinstall neither loses it nor applies twice.

export type Level = "all" | "input-only" | "muted";
export type ChildLevel = Level | "inherit";
const LEVELS: readonly string[] = ["all", "input-only", "muted"];
const CHILD_LEVELS: readonly string[] = [...LEVELS, "inherit"];

export interface PushLevels {
  defaultLevel: Level;
  childLevel: ChildLevel;
}

/** What turning it on saved: the prior levels, and each thread given its own level with the level it was given. */
export interface NotifySaved {
  defaultLevel: Level;
  childLevel: ChildLevel;
  threads: Record<string, { set: Level }>;
}

export interface NotifyPorts {
  /** push-notifications' current levels; throws while it is not running. */
  levels(): Promise<{ defaultLevel: unknown; childLevel: unknown }>;
  setLevels(v: PushLevels): Promise<void>;
  /** A thread's own level ("inherit" when unset). */
  ownLevel(threadId: string): Promise<ChildLevel>;
  setOwnLevel(threadId: string, level: ChildLevel): Promise<void>;
  /** The thread's parent in bb (its push-notifications child level applies when it has one). */
  parentOf(threadId: string): Promise<string | null>;
  /** The live CoS's thread, or null. */
  cosThread(): string | null;
  load(): Promise<NotifySaved | null>;
  save(s: NotifySaved | null): Promise<void>;
}

export const SAVED_KEY = "notifyOnlySaved";

const isLevel = (v: unknown): v is Level => typeof v === "string" && LEVELS.includes(v);
const isChildLevel = (v: unknown): v is ChildLevel => typeof v === "string" && CHILD_LEVELS.includes(v);

/** The level a thread with no own level resolved to under the saved (pre-mute) defaults. */
function resolvedBefore(saved: NotifySaved, hasParent: boolean): Level {
  return hasParent && saved.childLevel !== "inherit" ? saved.childLevel : saved.defaultLevel;
}

/**
 * Bring push-notifications in line with the setting. Idempotent: run it at start, on every change and each minute.
 * Order keeps a crash safe: save before muting, restore before forgetting.
 */
export async function reconcileNotifyOnly(on: boolean, p: NotifyPorts): Promise<string> {
  let saved = await p.load();
  if (!on) {
    if (!saved) return "off";
    for (const [threadId, { set }] of Object.entries(saved.threads)) {
      try {
        // clear only what is still ours: a level the owner set since then stays
        if ((await p.ownLevel(threadId)) === set) await p.setOwnLevel(threadId, "inherit");
      } catch {
        // a deleted thread has no level left to clear
      }
    }
    await p.setLevels({ defaultLevel: saved.defaultLevel, childLevel: saved.childLevel });
    await p.save(null);
    return `off: restored defaultLevel=${saved.defaultLevel} childLevel=${saved.childLevel}`;
  }
  const now = await p.levels();
  if (!saved) {
    if (!isLevel(now.defaultLevel) || !isChildLevel(now.childLevel)) throw new Error(`unexpected push-notifications levels ${JSON.stringify(now)}`);
    saved = { defaultLevel: now.defaultLevel, childLevel: now.childLevel, threads: {} };
    await p.save(saved);
  }
  if (now.defaultLevel !== "muted" || now.childLevel !== "muted") await p.setLevels({ defaultLevel: "muted", childLevel: "muted" });
  const cos = p.cosThread();
  if (cos) {
    const mine = saved.threads[cos];
    const own = await p.ownLevel(cos);
    if (!mine && own === "inherit") {
      const level = resolvedBefore(saved, (await p.parentOf(cos)) !== null);
      if (level !== "muted") {
        saved = { ...saved, threads: { ...saved.threads, [cos]: { set: level } } };
        await p.save(saved);
        await p.setOwnLevel(cos, level);
      }
    } else if (mine && own === "inherit") {
      await p.setOwnLevel(cos, mine.set); // saved but not yet set (a crash in between)
    }
  }
  return `on: muted (saved defaultLevel=${saved.defaultLevel} childLevel=${saved.childLevel})${cos && saved.threads[cos] ? `; CoS ${cos} at ${saved.threads[cos].set}` : ""}`;
}

/** Runs reconciles one at a time, each reading the setting when it starts, so a quick on-off-on cannot interleave. */
export function serialReconcile(desired: () => boolean, ports: NotifyPorts, log: (m: string) => void): () => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  let last = "";
  return () => {
    chain = chain.then(async () => {
      try {
        const r = await reconcileNotifyOnly(desired(), ports);
        if (r !== last) log(`notify-only: ${r}`);
        last = r;
      } catch (e) {
        last = "";
        log(`notify-only: ${e instanceof Error ? e.message : String(e)} (tried again in a minute)`);
      }
    });
    return chain;
  };
}
