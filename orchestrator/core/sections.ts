// The sidebar's per-project sections (server.ts placeSections creates them). When a project is archived its section goes:
// bb's section delete only unsections the threads in it (they fall back to the loose "Threads" bucket, none is lost), so
// a section is deleted only when no live thread is still in it. Starting the project's lead again brings the project back
// and placeSections makes the section anew.
import { sectionTitle } from "./model.ts";

export interface SectionsApi {
  list(): Promise<{ id: string; name: string }[]>;
  /** The ids of the threads in the section that aren't archived. */
  liveThreadsIn(sectionId: string): Promise<string[]>;
  remove(sectionId: string): Promise<unknown>;
}

/**
 * Deletes the sections of archived projects. A project's section is its title (sectionTitle), so a section is a candidate
 * only when its name is an archived project's title and no unarchived project (or the CoS's "Orchestrator") shares that title. Returns what it did.
 */
export async function pruneSections(api: SectionsApi, projects: { slug: string; archivedAt: number | null }[]): Promise<{ removed: string[]; kept: string[] }> {
  // the CoS and the Steward always sit in "Orchestrator", even when a project of that name is archived
  const liveNames = new Set([sectionTitle(null), ...projects.filter((p) => !p.archivedAt).map((p) => sectionTitle(p.slug))]);
  const archivedNames = new Set(projects.filter((p) => p.archivedAt).map((p) => sectionTitle(p.slug)));
  const removed: string[] = [];
  const kept: string[] = [];
  for (const s of await api.list()) {
    if (!archivedNames.has(s.name) || liveNames.has(s.name)) continue;
    const live = await api.liveThreadsIn(s.id);
    if (live.length) {
      kept.push(`${s.name} (${live.length} live thread${live.length === 1 ? "" : "s"})`);
      continue;
    }
    await api.remove(s.id);
    removed.push(s.name);
  }
  return { removed, kept };
}

/** The agents placeSections may put in a section: not placed yet, not archived, and not of an archived project (its section was removed; placing it would make the section again). */
export function placeable<A extends { threadId: string; status: string; project: string | null }>(agents: A[], placed: Set<string>, projects: { slug: string; archivedAt: number | null }[]): A[] {
  const archived = new Set(projects.filter((p) => p.archivedAt).map((p) => p.slug));
  return agents.filter((a) => !placed.has(a.threadId) && a.status !== "archived" && !(a.project && archived.has(a.project)));
}
