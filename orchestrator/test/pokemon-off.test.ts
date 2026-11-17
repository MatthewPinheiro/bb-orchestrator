// Pokémon are opt-in (requested 2026-11-13): an install that never turned the setting on must not show a Pokémon name to
// an agent (briefs) or to its owner (board rows, and the agents the app and the sidebar draw from). Turning it on later
// shows the Pokémon each agent was given all along.
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { BRIEF_VARS, BRIEFS, loadBrief, pokemonSentence } from "../core/start.ts";
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
  assert.match(b.steward!, /Your Pokémon is Regigigas\. Your working/);
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
