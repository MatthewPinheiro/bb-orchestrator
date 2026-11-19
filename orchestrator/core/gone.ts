// Agents whose bb thread is gone (2026-11-19). A stopped agent stayed live for days after bb had deleted its thread: bb
// sends no archive event for a thread it no longer has, and the startup reconcile skipped stopped agents and read any
// failed lookup as "no answer". Now every live agent's thread is looked up at startup and every GONE_CHECK_MS, and bb's
// clear not-found, seen twice and apart (Engine.threadNotFound), retires the agent as an archived thread is. Anything
// else, such as a network error, a timeout or a restarting bb, counts for nothing.
import type { Engine } from "./engine.ts";
import type { Agent } from "./model.ts";

/** How often the clock looks up every live agent's thread, so a second not-found can come. */
export const GONE_CHECK_MS = 10 * 60_000;

/** bb's own "no such thread": its SDK error's code, or HTTP 404. Nothing else is a not-found. */
export function isThreadGone(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const r = e as { code?: unknown; status?: unknown };
  return r.code === "thread_not_found" || r.status === 404;
}

/**
 * Look up each agent's bb thread; returns the threads bb gave, by thread id. A found thread clears an earlier
 * not-found. A not-found counts only in a pass where bb found at least one thread: a bb that comes up answering
 * not-found for every thread retires nobody.
 */
export async function lookThreads<T>(engine: Engine, agents: Agent[], get: (threadId: string) => Promise<T>, signal?: AbortSignal): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  const missing: string[] = [];
  for (const a of agents) {
    if (signal?.aborted) return found;
    try {
      found.set(a.threadId, await get(a.threadId));
      engine.threadFound(a.threadId);
    } catch (e) {
      if (isThreadGone(e)) missing.push(a.threadId);
    }
  }
  if (found.size > 0) for (const id of missing) engine.threadNotFound(id);
  return found;
}
