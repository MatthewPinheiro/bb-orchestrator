// The page's tab strip under the owner's hiddenTabs setting (2026-11-17), as data, so node --test checks it.

/**
 * The tabs the page shows: every tab but those the setting names, by id or lower-cased label (the server lower-cases
 * the setting). A setting that names every tab shows them all, judged on the setting alone, so no other tab changes
 * with Scope. `onPanes`: the views the page's panes are on.
 */
export function shownTabs<V extends { id: string; label: string }>(views: readonly V[], hidden: ReadonlySet<string>, scopeWaiting: number, onPanes: ReadonlySet<string>): readonly V[] {
  const named = (v: V) => hidden.has(v.id) || hidden.has(v.label.toLowerCase());
  if (views.every(named)) return views;
  // 2026-11-17: a hidden Scope tab still shows while something waits in it (it waits nowhere else) or a pane is on it (a link, the last answer)
  return views.filter((v) => !named(v) || (v.id === "scope" && (scopeWaiting > 0 || onPanes.has("scope"))));
}
