// `bb orchestrator setup sidebar`: the sidebar layout the orchestrator is built for. Every change goes through bb's own
// CLI (settings, thread-list prefs, thread pin); the module only reads the current value first so a second run changes nothing.

/** Runs one bb CLI call and returns its stdout; rejects when bb exits non-zero. */
export type BbRun = (args: string[]) => Promise<string>;

export const SECTION_ORDER = ["pinned", "projects", "threads"];

export async function setupSidebar(run: BbRun, pinThreads: { label: string; threadId: string }[]): Promise<string[]> {
  const lines: string[] = [];
  const report = (changed: boolean, what: string) => lines.push(changed ? `set: ${what}` : `already set: ${what}`);
  const json = async (args: string[]) => JSON.parse(await run([...args, "--json"]));

  const settings = await json(["settings", "show"]);
  const exp = settings?.experiments?.threadRowMetadata === true;
  if (!exp) await run(["settings", "experiment", "threadRowMetadata", "true"]);
  report(!exp, "experiment threadRowMetadata = true");

  const prefs = await json(["thread-list", "prefs", "list"]);
  if (prefs.showRowMetadata !== true) await run(["thread-list", "prefs", "set", "showRowMetadata", "true"]);
  report(prefs.showRowMetadata !== true, "showRowMetadata = true");

  const order = JSON.stringify(prefs.sectionOrder) === JSON.stringify(SECTION_ORDER);
  if (!order) await run(["thread-list", "prefs", "set", "sectionOrder", JSON.stringify(SECTION_ORDER)]);
  report(!order, `sectionOrder = ${SECTION_ORDER.join(", ")}`);

  if (pinThreads.length) {
    const rows: { id: string; pinnedAt?: string | null }[] = await json(["thread", "list", ...pinThreads.flatMap((t) => ["--thread", t.threadId])]);
    for (const t of pinThreads) {
      const pinned = !!rows.find((r) => r.id === t.threadId)?.pinnedAt;
      if (!pinned) await run(["thread", "pin", t.threadId]);
      report(!pinned, `${t.label} thread ${t.threadId} pinned`);
    }
  }
  return lines;
}
