// Only the cards scroll (2026-11-17, the owner: "the left navigation bar should stay in the same locations and also the
// header card should only the cards should scroll"). Wide, Projects and Scope take the pane's whole height
// (panes.tsx [data-fits-pane]); the list and the detail's header sit outside the one region that scrolls, and the cards
// are inside it. Before, the pane scrolled everything as one page, so the list and the header went up with the cards.
// This reads the sources, so the rule going fails here before a screenshot would catch it; the old lines are the fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

/** The body of one top-level function, up to the next one */
const fn = (s: string, name: string) => {
  const at = s.indexOf(`function ${name}(`);
  if (at < 0) return "";
  const next = s.slice(at + 1).search(/\n(export )?function /);
  return s.slice(at, next < 0 ? undefined : at + 1 + next);
};
/** The <div>s a stretch of JSX leaves open: 0 when every one it opens is closed in it */
const openDivs = (jsx: string) => (jsx.match(/<div\b[^>]*[^/]>/g)?.length ?? 0) - (jsx.match(/<\/div>/g)?.length ?? 0);
/** A CSS rule's declarations, by its exact selector */
const rule = (s: string, selector: string) => s.split("\n").find((l) => l.startsWith(`${selector} {`)) ?? "";

/**
 * Where the detail's parts sit, from the JSX between the head's opening tag and the cards': the head (name row and chat
 * card, its composer with it) closed before the cards' region opens, and the cards (ProjectBook) inside that region.
 */
function detailOrder(detail: string): string | null {
  const head = detail.indexOf('<div className="k-dfixed"');
  const cards = detail.indexOf('<div className="k-dcards"');
  const book = detail.indexOf("<ProjectBook");
  if (head < 0) return "no fixed head";
  if (cards < 0) return "no region for the cards";
  if (!(head < cards && cards < book)) return "the cards are not inside their region";
  for (const part of ['className="k-dhead"', "<ChatCard", "<Composer"]) {
    const at = detail.indexOf(part);
    if (!(head < at && at < cards)) return `${part} is not in the fixed head`;
  }
  if (openDivs(detail.slice(head, cards)) !== 0) return "the head is still open where the cards start: it would scroll with them";
  if (openDivs(detail.slice(cards, book)) !== 1) return "ProjectBook is not inside the cards' region";
  return null;
}

test("the pane hands a [data-fits-pane] tab its height and scrolls nothing itself", () => {
  const panes = src("app/panes.tsx");
  const frame = rule(panes, "[data-orch] .orch-pane__scroll:has([data-fits-pane])");
  assert.match(frame, /display: flex;/);
  assert.match(frame, /overflow: hidden;/, "the pane would scroll the list and the header with the cards");
  // a stable gutter under overflow: hidden still takes the scrollbar's room
  assert.match(frame, /scrollbar-gutter: auto;/);
  assert.match(rule(panes, "[data-orch] .orch-pane__scroll:has([data-fits-pane]) > div"), /flex: 1 1 auto;.*min-height: 0;/);
  assert.match(rule(panes, "[data-orch] [data-fits-pane]"), /flex: 1 1 auto;.*min-height: 0;/);
});

test("Projects, wide: the list and the project's header stay put, only the cards scroll", () => {
  const projects = src("app/projects.tsx");
  // only the wide layout opts in: one column keeps the pane's one scroll, the detail opening in place under its row
  assert.match(projects, /<div ref=\{root\} data-projects-width=\{width\} data-fits-pane=\{wide \|\| undefined\}>/);
  assert.match(projects, /<div className=\{wide \? "k-listpane" : undefined\} data-projects-list="">/);
  // the height reaches the two columns, which scroll each on its own
  assert.match(rule(projects, "[data-orch] [data-fits-pane] .b-body"), /flex: 1 1 0;.*min-height: 0;.*grid-template-rows: minmax\(0, 1fr\);.*align-items: stretch;/);
  assert.match(rule(projects, "[data-orch] [data-fits-pane] .b-body > .k-listpane"), /min-height: 0;.*overflow-y: auto;/, "the list scrolls on its own when taller");
  assert.match(rule(projects, "[data-orch] [data-fits-pane] .b-body > .detail > .k-dcards"), /flex: 1 1 0;.*overflow-y: auto;/, "the cards scroll in their own region");
  // the head takes at most half the height, so the cards keep the other half: an open chat's transcript gives up the room
  assert.match(rule(projects, "[data-orch] [data-fits-pane] .b-body > .detail > .k-dfixed"), /flex: 0 1 auto; min-height: 0; max-height: 50%;/);
  assert.match(projects, /\.k-dfixed \.k-chat > :is\(\.k-leadthread, \.k-chat__log\) \{ flex: 0 1 auto; min-height: 0; \}/, "the transcript doesn't shrink, so the head scrolls as a whole and the message box goes out of view");
  assert.equal(detailOrder(fn(projects, "DetailPanel")), null);
  // a new project's cards start at the top: the detail is a new element per project, the list the same one
  assert.match(projects, /<DetailPanel key=\{selected\.slug\} /);
  // the old detail: the head and the cards one flow inside the pane's scroll
  const old = `<div className="k-dhead">…</div>
        {project.lead ? (<ChatCard slug={project.slug}><Composer compact /></ChatCard>) : null}
        <ProjectBook project={project} />`;
  assert.equal(detailOrder(old), "no fixed head");
  // the head left open around the cards: it would scroll with them
  assert.match(detailOrder('<div className="k-dfixed"><div className="k-dhead"></div><ChatCard><Composer /></ChatCard><div className="k-dcards"><ProjectBook /></div></div>') ?? "", /still open/);
});

test("Scope, wide: the list and the entry's header card stay put, only the body scrolls", () => {
  const scope = src("app/scope.tsx");
  assert.match(scope, /<div ref=\{setRoot\} data-scope-tab="" data-scope-width=\{width\} data-fits-pane=\{wide \|\| undefined\}>/);
  assert.match(rule(scope, "[data-orch] [data-fits-pane] .orch-scope__grid"), /min-height: 0;.*grid-template-rows: minmax\(0, 1fr\);/);
  assert.match(rule(scope, "[data-orch] [data-fits-pane] .orch-scope__list"), /min-height: 0;.*overflow-y: auto;/);
  assert.match(rule(scope, "[data-orch] [data-fits-pane] .orch-scope__fixed"), /flex: none;/);
  assert.match(rule(scope, "[data-orch] [data-fits-pane] .orch-scope__body"), /flex: 1 1 0;.*overflow-y: auto;/);
  // the header card in the fixed part, closed before the body; the cards and the chat (its composer) in the body
  const view = fn(scope, "ScopeView");
  const fixed = view.indexOf('<div className="orch-scope__fixed"');
  const head = view.indexOf("{head}", fixed);
  const body = view.indexOf('className="orch-scope__body"');
  assert.ok(fixed > 0 && fixed < head && head < body, "the header card is in the fixed part");
  assert.equal(openDivs(view.slice(fixed, view.lastIndexOf("<div", body))), 0, "the fixed part is closed where the body starts");
  assert.match(view.slice(body, body + 800), /\{chatCol\}/);
  assert.match(view.slice(body, body + 800), /cardsCol/);
  // each entry's body starts at the top
  assert.match(view, /<div key=\{entry\.key\} className="orch-scope__body"/);
});
