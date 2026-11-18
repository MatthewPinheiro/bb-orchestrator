// The rules for an option tile's badges (2026-11-18), apart from answer-ui.tsx so a test can import them.
//
// Pressing must move nothing (Needs you arms cards by position, so a tile that grows on a pick is a mis-click risk):
//   - "Recommended" has its own row under the words, reserved on every tile of a card only while one tile has it;
//   - "Picked" sits in the title row, always laid out and only made visible by a pick, so a pick changes no height.

/** Whether a card's option tiles reserve the Recommended row: only when some option is recommended (equal tiles, no empty row otherwise). */
export const reservesBadgeRow = (options: readonly { recommended?: boolean }[]) => options.some((o) => o.recommended);

/** The Picked badge's classes: the same box ticked or not, so only its visibility changes. -my-0.5 keeps the title row one line tall. */
export const pickedClass = (pressed: boolean) => `-my-0.5 flex-none${pressed ? "" : " invisible"}`;
