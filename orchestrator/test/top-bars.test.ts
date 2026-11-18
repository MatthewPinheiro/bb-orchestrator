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
  // "2" → "10" keeps the width: the strip's count badge is at least two digits wide (shadcn's Badge since 2026-11-17)
  const panes = src("app/panes.tsx");
  assert.match(panes, TWO_DIGITS);
  assert.doesNotMatch('<Badge variant="secondary" className="orch-tab-count h-4 px-1 tabular-nums" data-empty={text === "" || undefined}>', TWO_DIGITS, "a badge as wide as its digits");
  // and a counted tab draws its slot even with no count
  assert.match(panes, /\{v\.counted \|\| v\.count !== undefined \? <CountedLabel label=\{v\.label\} count=\{v\.count\} \/> : v\.label\}/);
});
/** The count's badge with a two-digit minimum width */
const TWO_DIGITS = /<Badge\b[^>]*className="[^"]*\borch-tab-count\b[^"]*\bmin-w-\[calc\(2ch\+\d+px\)\]/;

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
  // 2026-11-17: shadcn's Tabs. The list is a grid of equal columns (auto-cols-fr) at its own max-content width (w-max): a
  // grid sized to max-content gives every 1fr column the widest tab's max-content width, so all tabs are as wide as the
  // widest, with no measuring script. The Tabs root around it is the strip's sideways scroller.
  const strip = /<Tabs\b[\s\S]*?<TabsList\b[^>]*>/;
  const control = panes.match(strip)?.[0] ?? "";
  assert.ok(control, "the strip's Tabs is found");
  assert.match(control, EQUAL, "the list's equal columns at its natural width");
  assert.match(control, /^<Tabs\b[^\n]*\bclassName="[^"]*\boverflow-x-auto\b/, "too narrow for every tab, the strip scrolls sideways (none cut short)");
  // the lines that drew a ragged strip (shadcn's own list: each tab its own width) and a stretched one (a tenth of a wide pane each)
  assert.doesNotMatch("<TabsList>", EQUAL);
  assert.doesNotMatch('<TabsList className="grid w-full auto-cols-fr grid-flow-col">', EQUAL);
  // labels centred in the wider box
  assert.match(src("app/ui/tabs.tsx"), /function TabsTrigger[\s\S]*?"relative inline-flex [^"]*\bjustify-center\b/);
});
/** A grid of equal columns, flowing sideways, at its natural width */
const EQUAL = /<TabsList className="(?=[^"]*\bgrid\b)(?=[^"]*\bw-max\b)(?=[^"]*\bauto-cols-fr\b)(?=[^"]*\bgrid-flow-col\b)[^"]*">/;
