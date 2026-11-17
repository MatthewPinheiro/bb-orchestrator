// The top bars stay put on every tab (2026-11-17, the owner: the tab strip and the Chief of Staff input bar must not move
// while switching tabs). Three things moved them: a lone pane's strip took its row from the tab's content width (only
// Deliverables, Projects and Open PRs gave it the full width, so the strip jumped sideways), the Chat tab dropped the
// input bar (so the strip jumped up), and a count coming or going widened its tab (so every tab after it slid). This
// reads the sources, so any of them coming back fails here, before a screenshot would catch it; the old lines are the
// fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

/** The pane header's opening tag: the tab strip's row */
const headerOf = (s: string) => s.match(/<header className=\{[^\n]*\}>/)?.[0] ?? "";
/** What a tab decides: its view, its content width (wide), whether it fills the pane, or the content column made from those */
const PER_TAB = /\bcolumn\b|\bwide\b|\bfills?\b|pane\.view/;
/** The input bar drawn only under a condition (a ternary or an &&) */
const CONDITIONAL_BAR = /(\?\s*null\s*:\s*\(|&&\s*\(?)\s*(<div[^>]*>\s*)?<CosComposer /;

test("a lone pane's tab strip spans the pane on every tab, whatever the tab", () => {
  const header = headerOf(src("app/panes.tsx"));
  assert.ok(header, "the pane header is found"); // a check that reads nothing must not pass
  assert.doesNotMatch(header, PER_TAB, "the strip's row depends on the tab shown");
  // a capped row makes the strip scroll sideways sooner as tabs are added
  assert.doesNotMatch(header, /max-w-/, "the strip's row is capped");
  // the line that moved the strip
  assert.match(headerOf('<header className={cx("flex shrink-0 items-center gap-1", many ? "px-2 pt-2" : `${column} px-4 pt-4`)}>'), PER_TAB);
});

test("the input bar is drawn on every tab, the Chat tab included", () => {
  const app = src("app.tsx");
  assert.match(app, /<CosComposer /);
  assert.doesNotMatch(app, CONDITIONAL_BAR);
  // the lines that hid it on the Chat tab
  assert.match(`{shown.has("chat") ? null : (\n        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-4">\n          <CosComposer agents={a} />`, CONDITIONAL_BAR);
});

test("every tab that can show a count keeps its slot, two digits wide", () => {
  const app = src("app.tsx");
  const counted = new Set([...(app.match(/const COUNTED = new Set<string>\(\[([^\]]*)\]\)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  // the tabs the strip's count expression gives a count to
  const expr = app.slice(app.indexOf("count:", app.indexOf("const views = VIEWS.map")), app.indexOf("}));", app.indexOf("const views = VIEWS.map")));
  const withCount = [...expr.matchAll(/v\.id === "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(withCount.length >= 3, "the count expression is found");
  for (const id of withCount) assert.ok(counted.has(id), `${id} shows a count but is not in COUNTED: its count coming or going moves the tabs after it`);
  // "2" → "10" keeps the width: the strip's counts are at least two digits wide
  assert.match(src("app/panes.tsx"), /\[data-pane\] > header \.ui-segc \.ui-segc__count \{ min-width: calc\(2ch \+ 6px\); \}/);
});

// 2026-11-17, the owner: "the tab name should be text centered". 1.11.0 kept the empty slot after the label, so a counted
// tab with no count drew its label at the left of its box beside a blank gap. The box stays as wide (the slot's room is
// held), and the label is centred in it.
test("a counted tab with no count centres its label in a box as wide as with one", () => {
  const panes = src("app/panes.tsx");
  // the box: a hidden copy of the label holds column one, so the label itself is free to move
  assert.match(panes, /<span className="orch-tab-label" data-label=\{label\} data-empty=\{text === "" \|\| undefined\}>/);
  assert.match(panes, /\.orch-tab-label::before \{ content: attr\(data-label\); grid-area: 1 \/ 1; visibility: hidden; \}/);
  assert.match(panes, /\.orch-tab-count\[data-empty\] \{ visibility: hidden; \}/, "the empty slot keeps its room: a count coming moves no tab");
  // no count: the label spans both columns, centred
  assert.match(panes, /\.orch-tab-label\[data-empty\] \.orch-tab-name \{ grid-column: 1 \/ -1; justify-self: center; \}/);
});

// 2026-11-17, the owner: "make all the tab widths the same. i hate that they're all different widths. it just looks
// weird." Each tab took its own label's width, so the strip read ragged. Now every tab is the widest tab's natural width
// (its label and count slot), labels centred, and a count coming or going moves nothing. Too narrow for them all, the
// strip scrolls sideways with the tabs still equal (never some labels cut short). It must keep its natural width: a strip
// stretched across the row would make every tab as wide as a tenth of a wide pane.
test("every tab in the strip has one width, the widest tab's, and the strip keeps its natural width", () => {
  const panes = src("app/panes.tsx");
  const strip = /<SegmentedControl\b[\s\S]*?\/>/;
  const control = panes.match(strip)?.[0] ?? "";
  assert.ok(control, "the strip's control is found");
  assert.match(control, /\bfullWidth\b/, "the control's equal mode");
  // the line that drew a ragged strip
  assert.doesNotMatch('<SegmentedControl\n            kind="tabs"\n            variant="tray"\n            size="sm"\n            value={pane.view}\n          />'.match(strip)![0], /\bfullWidth\b/);
  // the equal mode: columns of minmax(the widest tab, 1fr) in a max-content track, so each is the widest tab's width
  const seg = src("app/affect/segmented-control-clean.tsx");
  assert.match(seg, /\.ui-segc\[data-full\] \.ui-segc__track \{ display: grid; grid-auto-flow: column; grid-auto-columns: minmax\(var\(--ui-segc-min\), 1fr\); \}/);
  assert.match(seg, /setProperty\("--ui-segc-min", `\$\{Math\.max\(\.\.\.widths\)\}px`\)/);
  assert.match(seg, /\.ui-segc__track \{[^}]*width: max-content;/);
  // its own "display: flex; width: 100%" would stretch the strip and every tab across the row: the pane keeps it natural
  assert.match(seg, /\.ui-segc\[data-full\] \{ display: flex; width: 100%; \}/);
  assert.match(panes, /\[data-orch\] \[data-pane\] > header \.ui-segc\[data-full\] \{ display: inline-flex; width: auto; \}/);
  // labels centred in the wider box
  assert.match(seg, /\.ui-segc__opt \{[^}]*justify-content: center;/);
});
