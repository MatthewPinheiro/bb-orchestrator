// Every proof item opens inside bb (2026-11-16: "make sure any links open it up as a pane within BB"): a file on a host
// (image, video, text, doc) in bb's file preview pane, a URL (a PR, a claude.ai link) through bb's link handling, which is
// the in-app browser pane on desktop (bb's "open links in app browser" preference, on by default) and the system browser
// where bb has no browser pane (web, phone). One helper for every kind, so no card decides on its own.
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { requestDeliverable } from "./reveal.ts";

/**
 * What a proof item, an output, a PR link or a reference in the command center's text (refs.ts) carries that says where
 * it lives: a file on a host, a URL, a bb thread, or one of this plugin's own views (its sub-path, then the element to
 * scroll into sight).
 */
export type Openable = { hostId?: string | null; path?: string | null; url?: string | null; threadId?: string | null; panel?: { subPath: string; selector?: string; deliverable?: string } | null };

/** The plugin's own panel (app.tsx). */
export const PANEL_PATH = "home";

type Nav = Pick<BbNavigate, "openUrl" | "experimental_openFilePreview"> & Partial<Pick<BbNavigate, "toThread" | "toPluginPanel">>;

const HTTP = /^https?:\/\//i;

/** Open it in bb: true when bb took it (a pane, or bb's own link handling); false leaves the caller's fallback to run. */
export function openInBb(nav: Nav, o: Openable): boolean {
  if (o.hostId && o.path && nav.experimental_openFilePreview({ target: { kind: "host", hostId: o.hostId, path: o.path }, location: null })) return true;
  if (o.threadId && nav.toThread) {
    nav.toThread(o.threadId);
    return true;
  }
  if (o.panel && nav.toPluginPanel) {
    nav.toPluginPanel(PANEL_PATH, { subPath: o.panel.subPath });
    if (o.panel.deliverable) requestDeliverable(o.panel.deliverable); // its folder opens first (reveal.ts)
    if (o.panel.selector) reveal(o.panel.selector);
    return true;
  }
  return !!o.url && HTTP.test(o.url) && nav.openUrl(o.url);
}

/** Scrolls the element into sight once the view draws it (up to 4 s). */
export function reveal(selector: string) {
  if (typeof document === "undefined") return;
  let tries = 0;
  const find = () => {
    const el = document.querySelector<HTMLElement>(`[data-orch] ${selector.split(",").join(", [data-orch] ")}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    else if (++tries < 40) setTimeout(find, 100);
  };
  setTimeout(find, 0);
}

/** A plain left click, the only one bb takes over; a modifier or middle click keeps the browser's own behaviour. */
export const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }) =>
  !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
