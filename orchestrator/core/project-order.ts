// The projects in the order the owner's sidebar shows their sections (2026-11-16, for the Deliverables tree: "the same
// order as the sidebar's project sections"). The sidebar is bb's Thread list plugin; it keeps that order in its own
// manualSectionOrder preference (its listPreferences rpc), as section ids the owner can drag. bb's sidebar.* UI preference
// is only the seed it copied once on first load, then drifts, so it is not read. A project's section is the one named
// sectionTitle(slug). Projects with no section there
// (archived, never placed) follow in the order the sidebar places new sections in (engine.projects(): priority, then
// slug), so every project has one stable place.
import { sectionTitle } from "./model.ts";

export function sidebarOrder(placeOrder: readonly string[], sections: readonly { id: string; name: string }[], manual: readonly string[]): string[] {
  const slugByTitle = new Map(placeOrder.map((s) => [sectionTitle(s), s] as const));
  const nameById = new Map(sections.map((s) => [s.id, s.name] as const));
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (slug: string | undefined) => {
    if (slug !== undefined && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  };
  for (const entry of manual) if (entry.startsWith("section:")) add(slugByTitle.get(nameById.get(entry.slice(8)) ?? ""));
  for (const s of sections) add(slugByTitle.get(s.name)); // a section bb lists but the preference doesn't name yet
  for (const s of placeOrder) add(s);
  return out;
}

/** manualSectionOrder from the Thread list plugin's listPreferences answer ({ preferences: { manualSectionOrder } }); []
 * when absent. */
export function manualSectionOrder(answer: unknown): string[] {
  const v = (answer as { preferences?: Record<string, unknown> } | null)?.preferences?.manualSectionOrder;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
