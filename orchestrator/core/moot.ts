// The auto-moot check (2026-11-16): a card the owner already answered in a deliverable's change note is flagged to the
// CoS before it can reach Needs you. Deterministic word overlap, tuned on 124 real cards: a change note from the same
// lead in the last day sharing two content words flagged 2 of them, both of which went moot. A deliverable's title
// ("shipped work") or an earlier plan flagged follow-ups that weren't moot, so they don't count.

/** How far back a change note can cover a card. */
export const MOOT_WINDOW_MS = 24 * 3_600_000;
/** How many content words a card and a note must share. */
export const MOOT_MIN_SHARED = 2;

// Words that say what kind of work it is, not which work: every card has some.
const STOP = new Set(
  (
    "the and for with that this then than into from your you can are was were has have had not but all any our its it's should would could will " +
    "make made now one two get got let lets use new also only just more less what when which who how why yes off out per via onto over under " +
    "start thread threads review reviews read-only codex posting nothing plan build fix fixes dev open merge merged prs small release files view"
  ).split(" "),
);

/** A text's content words: lower case, 3+ characters, versions and PR numbers kept whole. */
export function contentWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9./-]*[a-z0-9]/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)));
}

/** The words two texts share, in the first one's order. */
export function sharedWords(a: string, b: string): string[] {
  const bw = contentWords(b);
  return [...contentWords(a)].filter((w) => bw.has(w));
}
