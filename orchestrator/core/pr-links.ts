// A thread's PRs that bb's reading of its environment doesn't show (2026-11-19). bb reads only the PR of an environment's
// current branch. A thread that pushed its HEAD under another branch name had no PR on record at all, and an
// environment's earlier PR was overwritten by its next one. After bb's pass, each environment's other PRs are read by
// URL until they are merged or closed, and a PR a thread reported (orch_report pr) is linked to it once its head commit
// is the environment's HEAD. A report alone is no proof of ownership: a QA or review thread reports the PRs it checked,
// and a wrong link sends PR notices about a PR the thread never opened.
import type { Engine, PrResult } from "./engine.ts";

export interface PrLinkIo {
  /** Each environment's HEAD commit (bb git's status), null when unknown. */
  heads(environmentIds: string[]): Promise<Record<string, string | null>>;
  /** One PR by URL (gh pr view on a connected machine), with its head commit. Throws when no machine answers. */
  read(url: string): Promise<PrResult>;
}

export interface LinkPassResult {
  read: number;
  /** gh reads that threw or came back unavailable. */
  failed: number;
  linked: string[];
  /** bb git's status call failed, so no report was compared this pass. */
  headsError: string | null;
  /** Environments with a report to compare whose HEAD bb git didn't give (its machine is off, or no commit). */
  noHead: string[];
  /** PRs gh read without a head commit. They can't be compared, so they are read again next pass. */
  noHeadRef: string[];
  /** Reports compared and not linked: `<address> <url>: head <sha>, environment HEAD <sha>`. */
  unmatched: string[];
}

/**
 * One pass, after bb's. `bb`: this pass's bb readings, by environment. `covered`: the readings the PR waits' gh pass
 * treats as read; each gh reading is added to it, so that pass doesn't read the PR again. `checked`: the environment
 * HEAD at which each unlinked report was last compared, kept across passes, so a report is read again only once that
 * HEAD moves. A failed read writes nothing. Every way a report goes unlinked is in the result, for the log: a pass that
 * quietly linked nothing hid a host schema that dropped gh's head commit (2026-11-19).
 */
export async function readThreadPrs(engine: Engine, bb: ReadonlyMap<string, PrResult>, covered: PrResult[], io: PrLinkIo, checked: Map<string, string>, signal?: AbortSignal): Promise<LinkPassResult> {
  const out: LinkPassResult = { read: 0, failed: 0, linked: [], headsError: null, noHead: [], noHeadRef: [], unmatched: [] };
  const todo = engine.prsToRead(bb);
  const envs = [...new Set(todo.filter((t) => !t.linked).map((t) => t.agent.environmentId!))];
  const heads: Record<string, string | null> = envs.length
    ? await io.heads(envs).catch((e: unknown) => {
        out.headsError = e instanceof Error ? e.message : String(e);
        return {};
      })
    : {};
  if (!out.headsError) out.noHead = envs.filter((env) => !heads[env]);
  const readings = new Map<string, PrResult | null>(); // each URL at most once a pass
  for (const t of todo) {
    if (signal?.aborted) break;
    const env = t.agent.environmentId!;
    const head = heads[env] ?? null;
    if (!t.linked && (!head || checked.get(`${env} ${t.url}`) === head)) continue;
    let r = readings.get(t.url);
    if (r === undefined) {
      r = await io.read(t.url).catch(() => null);
      readings.set(t.url, r);
      if (r) covered.push(r);
      if (r && r.outcome !== "unavailable") out.read++;
      else out.failed++;
    }
    if (r?.outcome !== "available") continue;
    if (!t.linked) {
      const oid = r.pullRequest.headRefOid;
      if (!oid) {
        if (!out.noHeadRef.includes(t.url)) out.noHeadRef.push(t.url);
        continue;
      }
      checked.set(`${env} ${t.url}`, head!);
      if (oid !== head) {
        out.unmatched.push(`${t.agent.address} ${t.url}: head ${oid.slice(0, 11)}, environment HEAD ${head!.slice(0, 11)}`);
        continue;
      }
      out.linked.push(`${t.agent.address} ${r.pullRequest.url}`);
    }
    engine.prSeen(t.agent, env, r, "", !t.linked);
  }
  return out;
}
