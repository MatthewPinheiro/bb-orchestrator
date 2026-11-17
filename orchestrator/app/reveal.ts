// Opening a deliverable from a link elsewhere (2026-11-16, the command center's v-… links): a past deliverable sits in a
// project folder that may be closed, or filtered out, so scrolling to it finds nothing. The link leaves its id here and
// says so; the Deliverables tree (past-view.tsx) takes it, clears its filters and opens that folder, then it can scroll.
let pending: string | null = null;
export const REVEAL_EVENT = "orch:reveal-deliverable";

export function requestDeliverable(id: string) {
  pending = id;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: id }));
}

/** The deliverable a link asked for, once. */
export function takeDeliverable(): string | null {
  const p = pending;
  pending = null;
  return p;
}
