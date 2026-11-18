// Open PRs grouped by project (2026-11-18, the owner: easy to see which project each PR belongs to). One group per
// project, from the project each PR already carries (open-prs/server.ts: the agent its PR watch or a lead's branch
// matched), never a guess from its title, repo or author; PRs with none sit in Unassigned, last. Groups go by name, and
// inside one the PRs keep the sort the owner picked. Which groups are collapsed is kept per viewer in localStorage, like
// the column widths (column-widths.ts): every read and write is wrapped, and blocked storage means all open. The rules
// know nothing of the DOM, so node --test checks them.
import { useCallback, useState } from "react";
import { projectTitle } from "../core/model.ts";
import { storage } from "./column-widths.ts";

/** A group's key: its project's slug, or null for Unassigned (no slug can be null). */
export type GroupKey = string | null;
export type PrGroup<T> = { key: GroupKey; name: string; prs: T[] };

/** Where the viewer's collapsed groups are kept (per browser, never on the server). */
export const GROUPS_KEY = "orchestrator.open-prs.groups.v1";
export const UNASSIGNED = "Unassigned";

/** The PRs, already sorted, in one group per project by name, Unassigned last; each group keeps their order. */
export function groupPrs<T extends { project: string | null }>(sorted: readonly T[]): PrGroup<T>[] {
  const by = new Map<GroupKey, T[]>();
  for (const p of sorted) {
    const k = p.project || null;
    const g = by.get(k);
    if (g) g.push(p);
    else by.set(k, [p]);
  }
  const named = [...by].filter((e): e is [string, T[]] => e[0] !== null).map(([key, prs]) => ({ key, name: projectTitle(key), prs }));
  named.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  const none = by.get(null);
  return none ? [...named, { key: null, name: UNASSIGNED, prs: none }] : named;
}

/** The collapsed groups kept under `key`: an array of slugs and null. Empty for anything malformed or blocked. */
export function loadCollapsed(key: string, store: Pick<Storage, "getItem"> | null = storage()): Set<GroupKey> {
  try {
    const v = JSON.parse(store?.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(v)) return new Set();
    return new Set(v.filter((k): k is GroupKey => k === null || (typeof k === "string" && k !== "")));
  } catch {
    return new Set();
  }
}

/** Keep the collapsed groups; none removes the key. Blocked storage: this visit only. */
export function saveCollapsed(key: string, collapsed: Set<GroupKey>, store: Pick<Storage, "setItem" | "removeItem"> | null = storage()) {
  try {
    if (collapsed.size) store?.setItem(key, JSON.stringify([...collapsed]));
    else store?.removeItem(key);
  } catch {
    // blocked storage: this visit only
  }
}

/** The viewer's collapsed groups, and a toggle that keeps the change. A group with no PRs now keeps its state. */
export function useCollapsed(key: string) {
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(() => loadCollapsed(key));
  const toggle = useCallback(
    (k: GroupKey) =>
      setCollapsed((was) => {
        const next = new Set(was);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        saveCollapsed(key, next);
        return next;
      }),
    [key],
  );
  return { collapsed, toggle };
}
