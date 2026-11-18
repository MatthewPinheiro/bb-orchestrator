// Pokémon are opt-in (requested 2026-11-13): an install that never turned the setting on must not show a Pokémon name to
// an agent (briefs) or to its owner (board rows, and the agents the app and the sidebar draw from). Turning it on later
// shows the Pokémon each agent was given all along.
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { BRIEF_VARS, BRIEFS, introSentence, loadBrief, pokemonSentence } from "../core/start.ts";
import { readPersonaPack } from "../personas.ts";
import { allMonNames, tokensForLevel } from "../mons.ts";

const BRIEF_DIR = join(import.meta.dirname, "..", "briefs");
const NAMES = allMonNames();
const ANY_MON = new RegExp(`\\b(${NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|")})\\b`);
const POKEMON_WORD = /pok[eé]mon/i;

function setup(pokemon?: boolean) {
  const e = new Engine(
    new DatabaseSync(":memory:") as never,
    {
      now: () => Date.parse("2026-11-14T10:00:00Z"),
      deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }),
      mirror: () => {},
      changed: () => {},
      log: () => {},
    },
    pokemon === undefined ? {} : { pokemon },
  );
  return e;
}

/** The brief each role gets from this engine: {pokemon} as the server's start routes fill it, the other variables neutral. */
function briefs(e: Engine): Record<string, string> {
  const vars = (role: (typeof BRIEFS)[number]): Record<string, string> => {
    const project = role === "lead" ? "code-reviews" : null;
    const known: Record<string, string> = { slug: "code-reviews", address: "lead:code-reviews", pokemon: pokemonSentence(e.monForStart(role, project)) };
    return Object.fromEntries(BRIEF_VARS[role].map((k) => [k, known[k] ?? "x"]));
  };
  return Object.fromEntries(BRIEFS.map((role) => [role, loadBrief(BRIEF_DIR, role, vars(role))]));
}

/** Every agent role registered, a thread levelled past two evolutions, then handed off. */
function work(e: Engine) {
  e.register("T-cos", "cos", null);
  e.register("T-st", "steward", null);
  e.register("T-la", "lead", "code-reviews");
  e.register("T-w1", "thread", "code-reviews", "T-la");
  e.gainXp("T-w1", tokensForLevel(40), 1); // Sandile → Krookodile (a review project is Dark: mons.ts TYPES)
  e.gainXp("T-la", tokensForLevel(64), 1); // Deino → Hydreigon
  e.takeOver("T-w1", "T-w2", "handoff.md");
}

test("the leak test knows every Pokémon, evolutions included", () => {
  for (const n of ["Rayquaza", "Caterpie", "Butterfree", "Alakazam", "Porygon-Z", "Bidoof"]) assert.ok(NAMES.includes(n), n);
});

test("off by default: no brief names a Pokémon or says the word", () => {
  const e = setup();
  assert.equal(e.settings.pokemon, false, "the default is off");
  for (const [role, text] of Object.entries(briefs(e))) {
    assert.doesNotMatch(text, ANY_MON, `${role} brief`);
    assert.doesNotMatch(text, POKEMON_WORD, `${role} brief`);
    assert.doesNotMatch(text, /\{[a-z]/, `${role} brief: no placeholder left`);
  }
  const b = briefs(e);
  assert.match(b.cos!, /\. Your working folder/, "the sentence goes cleanly, with no double space");
  assert.match(b.lead!, /\n\nYour working folder/);
});

test("off: no board row names a Pokémon, even after levels that would evolve one", () => {
  const e = setup();
  work(e);
  assert.ok(e.xpOf("thread:code-reviews:1").level >= 40, "the thread did level up");
  const rows = e.board();
  assert.ok(rows.length > 0);
  for (const r of rows) assert.doesNotMatch(`${r.title}\n${r.body ?? ""}`, ANY_MON, `board row: ${r.title}`);
  assert.ok(!rows.some((r) => /evolved/.test(r.title)), "no evolution rows");
});

test("off: the agents the app and the sidebar draw from carry no Pokémon", () => {
  const e = setup();
  work(e);
  for (const a of e.agents()) assert.equal(a.mon, null, a.address);
  assert.equal(e.agentByAddress("cos")!.mon, null);
  assert.equal(e.agentByThread("T-w2")!.mon, null);
});

test("on: briefs name the Pokémon and evolutions reach the board, as before the setting", () => {
  const e = setup(true);
  const b = briefs(e);
  assert.match(b.cos!, /Your Pokémon is Rayquaza\. Your working folder/);
  assert.match(b.steward!, /Your Pokémon is Chansey\. Your working/);
  assert.match(b.lead!, /Your Pokémon is Deino\. Your working folder/);
  work(e);
  assert.ok(e.board().some((r) => /Sandile evolved into Krookodile/.test(r.title)));
  assert.ok(e.board().some((r) => /Deino evolved into Hydreigon/.test(r.title)));
});

test("agents registered and handed off while off show their Pokémon once it is switched on", () => {
  const e = setup(false);
  work(e);
  e.settings = { ...e.settings, pokemon: true };
  assert.equal(e.agentByAddress("cos")!.mon, "Rayquaza");
  assert.equal(e.agentByAddress("lead:code-reviews")!.mon, "Deino");
  assert.equal(e.agentByThread("T-w2")!.mon, "Sandile", "the handoff successor kept the Pokémon while it was hidden");
});

// ---------------------------------------------------------------- the personas hook (2026-11-18, personas.ts)
// The off guarantee covers a loaded pack too: its personas' names, titles, images and credits, and its own Pokémon
// (read from the pack, which allMonNames() doesn't list once it is unloaded). The pack here is made up.
const PACK = readPersonaPack(join(import.meta.dirname, "fixtures", "personas-pack.json"));
const PACK_TERMS = [
  ...Object.values(PACK.personas).flatMap((p) => [p.name, p.title, p.image, p.credit ?? "", ...(p.team ?? []).map((m) => (typeof m === "string" ? m : m.name)), ...(p.roster ?? [])]),
  ...Object.entries(PACK.lines ?? {}).flatMap(([base, l]) => [base, ...l.evolutions.map((x) => x.name)]),
].filter(Boolean);
const ANY_PACK = new RegExp(`(${PACK_TERMS.map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|")})`);

function packEngine(pokemon: boolean) {
  return new Engine(
    new DatabaseSync(":memory:") as never,
    { now: () => Date.parse("2026-11-18T10:00:00Z"), deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} },
    { pokemon, personas: PACK },
  );
}
/** Everything an agent or the owner could read: the briefs, the board, the agents and their personas (the RPC's). */
function shown(e: Engine): string {
  const briefText = BRIEFS.map((role) => {
    const project = role === "lead" ? "code-reviews" : null;
    const known: Record<string, string> = { slug: "code-reviews", address: "lead:code-reviews", pokemon: introSentence(e.monForStart(role, project), e.personaForStart(role, project)) };
    return loadBrief(BRIEF_DIR, role, Object.fromEntries(BRIEF_VARS[role].map((k) => [k, known[k] ?? "x"])));
  });
  work(e);
  e.register("T-w3", "thread", "code-reviews", "T-la");
  e.gainXp("T-w3", tokensForLevel(40), 1);
  const rows = e.board().map((r) => `${r.title}\n${r.body ?? ""}`);
  // the board's agents and the deliverable cards carry faceOf (its persona and the dex of its Pokémon; 2026-11-18)
  const agents = e.agents().map((a) => JSON.stringify({ ...a, persona: e.personaOf(a), form: e.formOf(a, e.xpOf(a.address).level)?.name ?? null, face: e.faceOf(a) }));
  return [...briefText, ...rows, ...agents].join("\n");
}

test("the pack's terms are what the leak test looks for, and a pack line is in play", () => {
  for (const n of ["Vesna", "Pilot", "Feebas", "Milotic", "https://personas.example.test/vesna.png"]) assert.ok(PACK_TERMS.includes(n), n);
});

test("on with a pack: the briefs, the board and the agents show the personas (so the leak test can fail)", () => {
  const text = shown(packEngine(true));
  assert.match(text, /You are Pilot Vesna\./);
  assert.match(text, /Feebas evolved into Milotic/);
  assert.match(text, /personas\.example\.test\/orrin\.png/);
});

test("off with a pack loaded: no persona name, title, image or credit and no Pokémon, the pack's included, anywhere", () => {
  const e = packEngine(false);
  const text = shown(e);
  assert.doesNotMatch(text, ANY_PACK);
  assert.doesNotMatch(text, ANY_MON);
  assert.doesNotMatch(text, POKEMON_WORD);
  assert.doesNotMatch(text, /You are \w+ \w+[.;]/, "no persona sentence");
  for (const a of e.agents()) assert.equal(e.personaOf(a), null, a.address);
  for (const a of e.agents()) assert.deepEqual(e.faceOf(a), { dex: null, persona: null }, a.address);
  assert.equal(e.personaForStart("cos", null), null);
  assert.equal(e.personaForStart("lead", "edge-cli"), null);
});
