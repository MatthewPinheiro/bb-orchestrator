// Levels (2026-11-13): every agent levels up from the tokens its turns process, forever; threads evolve.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { MON_POOLS, formAt, levelFor, tokensForLevel } from "../mons.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, {
    now: () => Date.parse("2026-11-13T20:00:00Z"),
    async deliver(): Promise<DeliverResult> {
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  }, { pokemon: true }); // evolutions need the Pokémon setting on; pokemon-off.test.ts covers it off
  e.register("T-cos", "cos", null);
  const lead = e.register("T-la", "lead", "alpha");
  return { e, lead };
}

test("levels follow a cubic curve with no cap, so agents keep levelling the more they work", () => {
  assert.equal(levelFor(0), 1, "everyone starts at level 1");
  assert.equal(levelFor(tokensForLevel(10) - 1), 9);
  assert.equal(levelFor(tokensForLevel(10)), 10, "level 10 is 10M tokens");
  assert.equal(levelFor(tokensForLevel(150)), 150, "past 100: no cap");
});

test("a thread's Pokémon evolves at its species' own levels", () => {
  assert.equal(formAt("Caterpie", 6)!.name, "Caterpie");
  assert.equal(formAt("Caterpie", 7)!.name, "Metapod");
  assert.equal(formAt("Caterpie", 40)!.name, "Butterfree");
});

test("leads evolve too (the owner: start leads at their base form): every lead Pokémon is a base that ends in a strong form", async () => {
  const { MON_POOLS, baseOf } = await import("../mons.ts");
  assert.equal(formAt("Abra", 15)!.name, "Abra");
  assert.equal(formAt("Abra", 16)!.name, "Kadabra");
  assert.equal(formAt("Abra", 36)!.name, "Alakazam");
  for (const x of MON_POOLS.lead) {
    assert.equal(baseOf(x.name), x.name, `${x.name} is a base form`);
    assert.notEqual(formAt(x.name, 100)!.name, x.name, `${x.name} evolves`);
  }
  assert.equal(formAt("Rayquaza", 100)!.name, "Rayquaza", "the legendaries don't evolve");
});

test("a lead registered before leads evolved moves back to its line's base, and its level picks the form", async () => {
  const { migrate } = await import("../core/db.ts");
  const db = new DatabaseSync(":memory:");
  migrate(db as never);
  db.exec(`DELETE FROM _migrations WHERE id = 13`); // the lead-evolution migration, replayed on an old row
  db.prepare(`INSERT INTO agents (thread_id, address, role, project, created_at, mon) VALUES ('T1', 'lead:code-reviews', 'lead', 'code-reviews', 0, 'Alakazam'), ('T2', 'thread:code-reviews:1', 'thread', 'code-reviews', 0, 'Caterpie')`).run();
  migrate(db as never);
  const mons = db.prepare(`SELECT mon FROM agents ORDER BY thread_id`).all().map((r) => (r as { mon: string }).mon);
  assert.deepEqual(mons, ["Abra", "Caterpie"]);
});

test("each turn counts once, XP stays with the address across a restart, and an evolution is announced once", () => {
  const { e } = setup();
  const t = e.register("T-w1", "thread", "alpha", "T-la");
  assert.equal(t.mon, "Whismur", "alpha matches no type's words: the first free type, Normal");
  e.gainXp("T-w1", tokensForLevel(20), 5);
  assert.equal(e.gainXp("T-w1", tokensForLevel(20), 5), 20, "the same events again add nothing");
  assert.equal(e.board().filter((r) => /evolved into Loudred/.test(r.title)).length, 1);
  const succ = e.takeOver("T-w1", "T-w2", "handoff.md");
  assert.equal(e.xpOf(succ.address).level, 20, "the successor keeps the level");
  e.gainXp("T-w2", tokensForLevel(40) - tokensForLevel(20), 1);
  assert.equal(e.xpOf(succ.address).level, 40);
  assert.ok(e.board().some((r) => /Loudred evolved into Exploud/.test(r.title)));
});

test("every thread Pokémon is a three-stage line, so each thread can evolve twice", () => {
  for (const x of MON_POOLS.thread) {
    const forms = new Set(Array.from({ length: 100 }, (_, i) => formAt(x.name, i + 1)!.name));
    assert.equal(forms.size, 3, `${x.name} evolves twice`);
  }
});

test("on start, live threads that share a Pokémon or hold one from the old two-stage pool get their own", () => {
  const db = new DatabaseSync(":memory:");
  const ports = { now: () => Date.parse("2026-11-13T20:00:00Z"), deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} };
  const e = new Engine(db as never, ports);
  e.register("T-la", "lead", "alpha");
  for (const id of ["T-1", "T-2", "T-3", "T-4"]) e.register(id, "thread", "alpha", "T-la");
  db.prepare(`UPDATE agents SET mon = 'Slakoth', created_at = 4 WHERE thread_id = 'T-4'`).run();
  // the state the owner saw: two threads on Whismur, one on Rattata (two-stage); the oldest keeps what it has
  db.prepare(`UPDATE agents SET mon = 'Whismur', created_at = 1 WHERE thread_id = 'T-1'`).run();
  db.prepare(`UPDATE agents SET mon = 'Whismur', created_at = 2 WHERE thread_id = 'T-2'`).run();
  db.prepare(`UPDATE agents SET mon = 'Rattata', created_at = 3 WHERE thread_id = 'T-3'`).run();
  new Engine(db as never, ports);
  const mons = (db.prepare(`SELECT thread_id, mon FROM agents WHERE role = 'thread' ORDER BY created_at`).all() as { thread_id: string; mon: string }[]).map((r) => r.mon);
  assert.equal(mons[0], "Whismur", "the oldest holder keeps its Pokémon");
  assert.equal(mons[3], "Slakoth", "a thread with its own Pokémon keeps it, even though a re-rolled one would reach it first");
  assert.equal(new Set(mons).size, mons.length, "no two live threads share one");
  assert.ok(mons.every((x) => MON_POOLS.thread.some((p) => p.name === x)), "none is left on a two-stage line");
});
