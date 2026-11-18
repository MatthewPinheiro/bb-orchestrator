// The review queue's optional model picker (2026-11-18, ported from a contributor's public PR). Off by default: it runs
// only when the queue's settings name a picker provider. It ranks, never decides: the runner gives it only PRs that
// already passed every check, and falls back to the deterministic pick when it fails, times out, or answers with a PR
// that is no longer eligible.
//
// What it sees: opaque indexes and a few numeric facts per PR, never a URL, title, author, head or credential.
// Where it runs: a short bb thread in a personal folder on the queue's machine, not a worktree or an existing
// environment. bb's spawn has no read-only permission mode and no tool-less option: "accept-edits" is the lowest
// permission mode, so the thread does have tools in that folder; the prompt tells it not to use them. It is stopped and
// archived once it has answered. Every SDK call races the picker's budget, so a call that hangs can't hold the queue.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Entry, QueueConfig } from "../core/review-queue.ts";
import { spawnSelection } from "../core/provider.ts";

/** The picker's whole budget: past it the run falls back to the deterministic pick. */
export const PICKER_MS = 90_000;
export const PICKER_TITLE = "CodeRabbit queue picker";

/** The only text the model sees: opaque indexes and bounded numeric facts. */
export function pickerPrompt(entries: Entry[]): string {
  const facts = entries.map((e, index) => ({
    index,
    approvals: e.facts!.approvals,
    ci: e.facts!.ci,
    unresolvedThreads: e.facts!.threads,
    hasOlderReview: !!e.facts!.lastReview,
  }));
  return `Choose one CodeRabbit review candidate. Do not use tools, read files, run commands, contact GitHub, or post anything. All needed facts follow, in queue order. Return ONLY JSON {"index":N}. Prefer exactly one human approval, then ready unreviewed work; use unresolved threads and queue order to break ties.\n${JSON.stringify(facts)}`;
}

/** The chosen entry's URL, or null for anything but a bare {"index":N} naming one of the entries. */
export function parseChoice(output: string, entries: Entry[]): string | null {
  const m = /^(?:```(?:json)?\s*)?(\{\s*"index"\s*:\s*\d{1,3}\s*\})(?:\s*```)?$/.exec(output.trim());
  if (!m) return null;
  const { index } = JSON.parse(m[1]!) as { index: number };
  return entries[index]?.url ?? null;
}

type Sdk = { threads: Pick<BbPluginApi["sdk"]["threads"], "spawn" | "wait" | "output" | "stop" | "archive">; providers: BbPluginApi["sdk"]["providers"] };

/**
 * One picker thread: check the provider and model on the machine (the orchestrator's own spawnSelection), spawn, wait
 * for its answer, read it, then stop and archive it whatever happened. A failed check spawns nothing.
 */
export async function chooseWithProvider(sdk: Sdk, entries: Entry[], config: QueueConfig, hostId: string, signal: AbortSignal): Promise<{ url: string | null; note: string }> {
  if (!config.pickerProvider || !config.pickerModel || !config.pickerProjectId) throw new Error("The model picker needs a provider, a model and a project");
  signal.throwIfAborted();
  const budget = AbortSignal.any([signal, AbortSignal.timeout(PICKER_MS)]);
  const bounded = <T>(p: Promise<T>) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) => {
        if (budget.aborted) reject(budget.reason);
        budget.addEventListener("abort", () => reject(budget.reason), { once: true });
      }),
    ]);
  const selection = await bounded(spawnSelection(sdk.providers, { hostId, projectId: config.pickerProjectId }, { provider: config.pickerProvider, model: config.pickerModel }));
  const { threads } = sdk;
  const close = async (threadId: string) => {
    await threads.stop({ threadId }).catch(() => {});
    await threads.archive({ threadId }).catch(() => {});
  };
  const spawning = threads.spawn({
    title: PICKER_TITLE,
    projectId: config.pickerProjectId,
    environment: { type: "host", hostId, workspace: { type: "personal" } },
    ...selection,
    permissionMode: "accept-edits",
    parentNotifications: "off",
    prompt: pickerPrompt(entries),
    pluginMetadata: { reviewQueuePicker: true },
  });
  const thread = await bounded(spawning).catch((e: unknown) => {
    void spawning.then((t) => close(t.id)).catch(() => {}); // a spawn that lands after the budget is still archived
    throw e;
  });
  try {
    await bounded(threads.wait({ threadId: thread.id, status: "idle", timeoutMs: PICKER_MS, signal: budget }));
    const { output } = await bounded(threads.output({ threadId: thread.id, signal: budget }));
    const url = parseChoice(output ?? "", entries);
    return { url, note: url ? `Model: ${config.pickerProvider} / ${config.pickerModel}` : "Model answer invalid; deterministic fallback" };
  } finally {
    await close(thread.id);
  }
}
