// No vertical accent lines on the Projects tab (2026-11-16, the owner: "remove the vertical line on the card vibecoded bs
// on the selected project and the uis"). A selected, loud or expanded project says so with a background tint or a
// heavier weight, never with a coloured left edge; the project page's thread tree indents without a rail. This reads
// the tab's own sources, so a left bar added back in any of them fails here, before a screenshot would catch it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// every component the tab renders (projects.tsx's, project-book.tsx's and search.tsx's own imports included)
const FILES = [
  "projects.tsx", "cc-lines.tsx", "project-detail.tsx", "direct-line.tsx", "ref-text.tsx", "project-book.tsx", "search.tsx",
  "agent-bits.tsx", "mon.tsx", "status-bar.tsx", "ui.tsx", "kit-ui.tsx", "thread-card.tsx", "pins.tsx",
  "affect/badge-clean.tsx", "affect/dropdown-menu-clean.tsx", "affect/empty-state-clean.tsx", "affect/segmented-control-clean.tsx",
];
// a left or inline-start border, Tailwind's border-l/border-s, or an inset shadow with an x offset (inset 2px 0 0 …)
const BAR = /border-?left|borderLeft|border-?inline-?start|borderInlineStart|\bborder-[ls](?:-|\b)|inset\s+-?[1-9][\d.]*px\s+0/;

for (const f of FILES) {
  test(`${f}: no left border or vertical bar`, () => {
    // a renamed or missing file fails here: a check that reads nothing must not pass
    const src = readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");
    const hits = src.split("\n").filter((l) => BAR.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l));
    assert.deepEqual(hits, [], `${f} draws a vertical bar`);
  });
}

test("the pattern catches the bars that were there", () => {
  for (const s of [`.proj[data-loud] { box-shadow: inset 2px 0 0 var(--x); }`, `style={{ borderLeft: "1.5px solid" }}`, `className="border-l-2"`, `border-left: 3px solid`]) assert.match(s, BAR, s);
  for (const s of [`box-shadow: inset 0 0 0 1px var(--x)`, `border-bottom: 1px solid`, `border-radius: 8px`]) assert.doesNotMatch(s, BAR, s);
});
