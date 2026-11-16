// The double-tap rules as pure functions of time, so they can be checked without a browser.
//
// 1. Arming: a card takes clicks only once it has sat at its place, at its rev, for ARM_MS.
// 2. Settling: after a write, the page stays as it is until the request finished AND SETTLE_MS passed since both the
//    response and the last pointer release (and no pointer is down). Only then may the list move.

export const ARM_MS = 400;
export const SETTLE_MS = 400;

/** When a card last appeared or moved: its rev and its top (px from the list wrapper) at that time. */
export type Seen = { rev: number; top: number; at: number };

/** Fold a fresh measurement in: the same rev at the same place (within 1 px) keeps the clock, anything else restarts it. */
export function track(prev: Seen | undefined, rev: number, top: number, now: number): Seen {
  return prev && prev.rev === rev && Math.abs(prev.top - top) < 1 ? prev : { rev, top, at: now };
}

/** Armed once the card has sat still, at this rev, for ARM_MS. A card never measured is not armed. */
export function armed(seen: Seen | undefined, rev: number, now: number): boolean {
  return seen !== undefined && seen.rev === rev && now >= seen.at + ARM_MS;
}

/**
 * When a write's hold on the page may end: SETTLE_MS after the later of its response and the last pointer release.
 * Null while the request runs or a pointer is down (a later release sets a new time).
 */
export function releaseAt(lock: { done: boolean; doneAt: number }, pointerDown: boolean, lastReleaseAt: number): number | null {
  if (!lock.done || pointerDown) return null;
  return Math.max(lock.doneAt, lastReleaseAt) + SETTLE_MS;
}
