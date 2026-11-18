// Who an agent looks like (app/faces.ts, 2026-11-18): the sprite for a pack's line, the sidebar's row icons and a lead's
// party. The point of each: with a personas pack the screens show people and the pack's own Pokémon (no neutral
// placeholder), and without one, or with the setting off, they are exactly what they were.
import assert from "node:assert/strict";
import { test } from "node:test";
import { monByName, monSprite } from "../mons.ts";
import { boxedText, pairLabel, partyOf, personaName, rowIconCss, rowName, spriteMon } from "../app/faces.ts";

const vesna = { name: "Vesna", title: "Pilot", image: "https://personas.example.test/vesna.png", credit: null, team: [], partner: null };
const orrin = { name: "Orrin", title: "Harbormaster", image: "https://personas.example.test/orrin.png", credit: null, team: [], partner: "Rayquaza" };

test("a pack's line, unknown to the browser's mons.ts, still gets its sprite by the server's dex", () => {
  assert.equal(monByName("Feebas"), null, "the browser loads no pack: this is the case that drew the placeholder");
  assert.deepEqual(spriteMon("Feebas", 349), { name: "Feebas", dex: 349 });
  assert.deepEqual(spriteMon("Gible", 999), monByName("Gible"), "mons.ts's own Pokémon wins over any number sent");
  assert.equal(spriteMon("Feebas", null), null, "no number: nothing to draw, the role's letter shows");
  assert.equal(spriteMon(null, 349), null, "no name (the setting off): nothing, whatever the number");
  assert.equal(spriteMon("Feebas", 0), null);
});

test("a person is named title first, and the pair names both", () => {
  assert.equal(personaName(vesna), "Pilot Vesna");
  assert.equal(pairLabel(orrin), "Harbormaster Orrin with Rayquaza");
  assert.equal(pairLabel(vesna), "Pilot Vesna", "a lead has no partner");
});

const row = (id: string) => `a[data-sidebar-thread-id="${id}"] + span > span > [data-sidebar-thread-provider]`;
const agent = (over: Record<string, unknown>) => ({ threadId: "T1", role: "thread", mon: null, form: null, formDex: null, persona: null, ...over });

test("sidebar line: the person's name alone, never the title or the partner (with them the line was cut off)", () => {
  assert.equal(rowName(agent({ role: "cos", mon: "Rayquaza", form: "Rayquaza", formDex: 384, persona: orrin })), "Orrin", "not \"Harbormaster\", not \"Rayquaza\": the card and the pair's sprite show those");
  assert.equal(rowName(agent({ role: "lead", persona: vesna })), "Vesna");
  assert.equal(rowName(agent({ mon: "Feebas", form: "Feebas", formDex: 349 })), "Feebas", "a thread on a pack line: its Pokémon");
  assert.equal(rowName(agent({ role: "lead", mon: "Deino", form: "Zweilous" })), "Zweilous", "on without a pack: the Pokémon's name, as before");
  assert.equal(rowName(agent({ role: "lead" })), null, "the setting off: no name");
});

test("sidebar, setting off: no row icon rules at all, so bb's own icons show", () => {
  const off = [agent({ role: "cos", threadId: "C" }), agent({ role: "lead", threadId: "L" }), agent({ threadId: "W" })];
  assert.deepEqual(rowIconCss(off as never), []);
});

test("sidebar, on without a pack: the rules are byte for byte what they were before the personas hook", () => {
  // the 1.16.25 rule, written out: a lead's shiny animated sprite, 38 px, and a thread's at 30 px
  const before = (id: string, px: number, url: string) => [
    `${row(id)} > * { display: none !important; }`,
    `${row(id)} { width: ${px}px; height: ${px}px; margin: -${(px - 16) / 2}px 4px -${(px - 16) / 2}px -${px - 30}px; position: relative; top: 9px; background: url("${url}") center / contain no-repeat; image-rendering: pixelated; }`,
  ];
  const got = rowIconCss([agent({ role: "lead", threadId: "L", mon: "Deino", form: "Zweilous", formDex: 634 }), agent({ threadId: "W", mon: "Sandile", form: "Sandile", formDex: 551 })] as never);
  assert.deepEqual(got, [...before("L", 38, monSprite(monByName("Zweilous")!, true, true)), ...before("W", 30, monSprite(monByName("Sandile")!, true, false))]);
});

test("sidebar, with a pack: a lead is its person, the CoS a pair, and a thread on a pack line its own sprite", () => {
  const css = rowIconCss([
    agent({ role: "lead", threadId: "L", persona: vesna }),
    agent({ role: "cos", threadId: "C", mon: "Rayquaza", form: "Rayquaza", formDex: 384, persona: orrin }),
    agent({ threadId: "W", mon: "Feebas", form: "Feebas", formDex: 349 }),
  ] as never).join("\n");
  assert.ok(css.includes(`${row("L")} { width: 38px; height: 38px; margin: -11px 4px -11px -8px; position: relative; top: 9px; background: url("${vesna.image}") center / contain no-repeat;`), "the lead: its person, one background");
  // the pair: the partner first, so it draws over the person's corner
  assert.match(css, /data-sidebar-thread-id="C"[^{]*\{[^}]*background: url\("[^"]*\/animated\/shiny\/384\.gif"\) right bottom \/ 60% no-repeat, url\("https:\/\/personas\.example\.test\/orrin\.png"\) left top \/ 85% no-repeat;/);
  assert.match(css, /data-sidebar-thread-id="W"[^{]*\{[^}]*animated\/349\.gif/, "Feebas by its dex, not a blank row");
});

test("sidebar: an image that could end the url() early is never written into the stylesheet", () => {
  const bad = { ...vesna, image: 'https://x.test/a.png") } body { display: none' };
  assert.deepEqual(rowIconCss([agent({ role: "lead", threadId: "L", persona: bad })] as never), [], "no Pokémon either (hidden for a person): no rule");
  assert.deepEqual(rowIconCss([agent({ role: "lead", threadId: 'L"]', persona: vesna })] as never), [], "an odd thread id writes no selector");
});

const t = (n: number, over: Record<string, unknown> = {}) => ({ address: `thread:p:${n}`, role: "thread", project: "p", engineStatus: "idle", mon: "Gible", form: "Gible", ...over });

test("the party: the six most recent live threads, the rest in the box", () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => t(n));
  const p = partyOf([...all, t(9, { project: "q", address: "thread:q:9" }), t(10, { engineStatus: "archived" }), { ...t(0), address: "lead:p", role: "lead" }] as never, "p");
  assert.deepEqual(p.shown.map((a) => a.address), ["thread:p:8", "thread:p:7", "thread:p:6", "thread:p:5", "thread:p:4", "thread:p:3"]);
  assert.equal(p.boxed, 2, "eight live threads: six shown, two boxed; another project's, an archived one and the lead don't count");
  assert.equal(boxedText(p.boxed), "+2 in the box");
  assert.equal(boxedText(0), null);
});

test("with a pack, the threads on the trainer's roster lines lead the party, in roster order; then the rest, newest first", () => {
  // the party sits under the trainer's game team (2026-11-18): its roster threads first, so the two rows line up
  const all = [t(1, { mon: "Feebas", form: "Milotic" }), t(2, { mon: "Sandile" }), t(3, { mon: "Togepi" }), t(4, { mon: "Budew" }), t(5, { mon: "Axew" })];
  assert.deepEqual(partyOf(all as never, "p", ["Budew", "Feebas", "Togepi"]).shown.map((a) => a.address), ["thread:p:4", "thread:p:1", "thread:p:3", "thread:p:5", "thread:p:2"]);
  assert.deepEqual(partyOf(all as never, "p").shown.map((a) => a.address), ["thread:p:5", "thread:p:4", "thread:p:3", "thread:p:2", "thread:p:1"], "no roster (no pack): as before");
  const many = [...[1, 2, 3, 4, 5, 6, 7].map((n) => t(n, { mon: `M${n}` })), t(8, { mon: "Feebas" })];
  const p = partyOf(many as never, "p", ["Feebas"]);
  assert.equal(p.shown[0]!.address, "thread:p:8", "a roster thread is never in the box");
  assert.equal(p.boxed, 2);
});

test("the party is empty with the setting off: no thread has a Pokémon", () => {
  assert.deepEqual(partyOf([t(1, { mon: null, form: null })] as never, "p"), { shown: [], boxed: 0 });
});
