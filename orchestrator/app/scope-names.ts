// The Scope tab's names (2026-11-17, the owner: "update the naming convention or add more of the avatars on the scoping
// page as well. it's kind of boring on the headliners and the spot sizes don't look unified. it's kind of confusing").
// One title format for every entry: the task's plain title. A slug in front of it ("trends-export: move the export…") moves
// to a muted line under the title; a task named only by a slug reads as words. The planner is one short name beside its
// avatar: "Lead", or the scoping thread's title ("Scoping thread" when that title only repeats the task's).
import { projectTitle } from "../core/model.ts";
import { plannerOf, type ScopeEntry } from "./kit.ts";

/** "trends-export: move it" — a kebab slug, a colon, then the words */
const SLUG_PREFIX = /^([a-z0-9]+(?:[-_][a-z0-9]+)+):\s+(\S[\s\S]*)$/;
/** "region-totals" — a slug and nothing else */
const BARE_SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;

const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** A task's name as its title, and the slug it carried in front, if any. Names that are already words stay as they are. */
export function taskTitle(name: string): { title: string; slug: string | null } {
  const n = name.trim();
  const m = SLUG_PREFIX.exec(n);
  if (m) return { title: cap(m[2]!.trim()), slug: m[1]! };
  if (BARE_SLUG.test(n)) return { title: projectTitle(n.replace(/_/g, "-")), slug: null };
  return { title: n, slug: null };
}

/** An entry's title (the whole project, or its task's plain title) and its slug line. */
export function entryTitle(e: ScopeEntry): { title: string; slug: string | null } {
  return e.task ? taskTitle(e.task.name) : { title: "Whole project", slug: null };
}

/** Who plans the entry, short, for the line beside its avatar; `address` picks the avatar (the lead's or the thread's). */
export function plannerName(e: ScopeEntry): { name: string; address: string; state: string | null } {
  const p = plannerOf(e);
  if (p.kind === "lead") return { name: "Lead", address: `lead:${e.slug}`, state: null };
  const own = taskTitle(p.name).title;
  return { name: e.task && own === entryTitle(e).title ? "Scoping thread" : own, address: p.address, state: p.state };
}
