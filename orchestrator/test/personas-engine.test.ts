// The personas hook in the engine (2026-11-18, scope §3-4): with the pokemon setting on and a pack loaded, the CoS, the
// Steward and the leads are people (a persona), and a lead's Pokémon is hidden, never deleted, and frees its line.
// Threads draw from their lead's persona's lines first. Loading a pack moves no thread; removing one gives the leads
// their Pokémon back. Personas and projects here are made up (test/fixtures/personas-pack.json).
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult, type Settings } from "../core/engine.ts";
import { BRIEFS, BRIEF_VARS, introSentence, loadBrief } from "../core/start.ts";
import { readPersonaPack, type PersonaPack } from "../personas.ts";
import { monByName, tokensForLevel } from "../mons.ts";

const ports = { now: () => Date.parse("2026-11-18T10:00:00Z"), deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} };
const PACK = readPersonaPack(join(import.meta.dirname, "fixtures", "personas-pack.json"));
const BRIEF_DIR = join(import.meta.dirname, "..", "briefs");

function setup(s: Partial<Settings> = { pokemon: true, personas: PACK }, db = new DatabaseSync(":memory:")) {
  return { db, e: new Engine(db as never, ports, s) };
}
type Row = { thread_id: string; role: string; mon: string; mon_stage: number | null; mon_stage_level: number | null };
const rows = (db: DatabaseSync) => db.prepare(`SELECT thread_id, role, mon, mon_stage, mon_stage_level FROM agents WHERE retired_at IS NULL ORDER BY thread_id`).all() as Row[];
const monOf = (db: DatabaseSync, threadId: string) => rows(db).find((r) => r.thread_id === threadId)!.mon;

test("with a pack the CoS, the Steward and the leads are people; threads are Pokémon from their lead's lines first", () => {
  const { db, e } = setup();
  e.register("T-cos", "cos", null);
  e.register("T-st", "steward", null);
  e.register("L-cr", "lead", "code-reviews"); // Dark: the pack's first Dark persona
  for (const n of [1, 2, 3, 4]) e.register(`W-${n}`, "thread", "code-reviews", "L-cr");
  assert.deepEqual(e.personaOf(e.agentByAddress("cos")!), { name: "Orrin", title: "Harbormaster", image: "https://personas.example.test/orrin.png", credit: null, team: ["Rayquaza"], partner: "Rayquaza" });
  assert.equal(e.personaOf(e.agentByAddress("steward")!)?.partner, "Regigigas");
  const lead = e.agentByAddress("lead:code-reviews")!;
  assert.equal(e.personaOf(lead)?.name, "Vesna");
  assert.equal(e.personaOf(lead)?.partner, null, "a lead has no partner: its threads are its Pokémon");
  assert.equal(lead.mon, null, "the lead's Pokémon is hidden");
  assert.equal(monOf(db, "L-cr"), "Deino", "…but kept in the database");
  assert.deepEqual([1, 2, 3, 4].map((n) => e.agentByThread(`W-${n}`)!.mon), ["Feebas", "Budew", "Togepi", "Deino"], "the persona's lines, then the family, whose lead line is free now");
  assert.equal(e.personaOf(e.agentByThread("W-1")!), null, "threads have no persona");
});

test("a live persona's signature line is kept for its own threads: another project skips it", () => {
  const pack: PersonaPack = { ...PACK, personas: { ...PACK.personas, vesna: { ...PACK.personas.vesna!, roster: ["Feebas", "Gible", "Budew"] } } };
  const { e } = setup({ pokemon: true, personas: pack });
  e.register("L-vm", "lead", "vm-storage"); // Ground: Pell, whose signature is Gible
  e.register("L-cr", "lead", "code-reviews");
  e.register("W-1", "thread", "code-reviews", "L-cr");
  e.register("W-2", "thread", "code-reviews", "L-cr");
  assert.equal(e.agentByThread("W-2")!.mon, "Budew", "Gible is Pell's signature while Pell leads a live project");
  e.register("W-3", "thread", "vm-storage", "L-vm");
  assert.equal(e.agentByThread("W-3")!.mon, "Gible");
  e.setStatus("L-vm", "archived");
  e.register("W-4", "thread", "code-reviews", "L-cr");
  assert.notEqual(e.agentByThread("W-4")!.mon, "Gible", "W-3 still holds it: no two live agents share one");
});

test("the persona named in a lead's brief is the one it gets, for a new project and after an archived lead", () => {
  const { e } = setup();
  e.register("L-cr", "lead", "code-reviews");
  const promised = e.personaForStart("lead", "vm-storage");
  assert.equal(promised?.name, "Pell");
  e.registerStarted("L-vm", "lead", "vm-storage");
  assert.deepEqual(e.personaOf(e.agentByAddress("lead:vm-storage")!), promised);
  e.setStatus("L-cr", "archived");
  const again = e.personaForStart("lead", "code-reviews");
  e.registerStarted("L-cr2", "lead", "code-reviews");
  assert.deepEqual(e.personaOf(e.agentByAddress("lead:code-reviews")!), again);
  assert.equal(again?.name, "Vesna");
});

test("a later lead never takes an earlier lead's persona, and the fallback catches the rest", () => {
  const { e } = setup();
  e.register("L-a", "lead", "edge-cli"); // Electric: Brannoc
  e.register("L-b", "lead", "vm-storage"); // Ground: Pell (first), Brannoc is held
  e.register("L-c", "lead", "qa-suite"); // Fighting: no list
  assert.deepEqual(["edge-cli", "vm-storage", "qa-suite"].map((p) => e.personaOf(e.agentByAddress(`lead:${p}`)!)?.name), ["Brannoc", "Pell", "Ysolde"]);
});

test("the briefs say who the agent is instead of its Pokémon", () => {
  const { e } = setup();
  const brief = (role: (typeof BRIEFS)[number], project: string | null) => {
    const known: Record<string, string> = { slug: "code-reviews", address: "lead:code-reviews", pokemon: introSentence(e.monForStart(role, project), e.personaForStart(role, project)) };
    return loadBrief(BRIEF_DIR, role, Object.fromEntries(BRIEF_VARS[role].map((k) => [k, known[k] ?? "x"])));
  };
  assert.match(brief("cos", null), /You are Harbormaster Orrin; your partner is Rayquaza\. Your working folder/);
  assert.match(brief("steward", null), /You are Warden Tamsin; your partner is Regigigas\. Your working/);
  const lead = brief("lead", "code-reviews");
  assert.match(lead, /You are Pilot Vesna\. Your working folder/);
  assert.doesNotMatch(lead, /Your Pokémon is/, "a lead gets no Pokémon sentence");
});

test("no evolution rows for a lead with a persona; its threads' still come", () => {
  const { e } = setup();
  e.register("L-cr", "lead", "code-reviews");
  e.register("W-1", "thread", "code-reviews", "L-cr");
  e.gainXp("L-cr", tokensForLevel(64), 1); // Deino would be Hydreigon
  e.gainXp("W-1", tokensForLevel(40), 1); // Feebas → Milotic
  const titles = e.board().map((r) => r.title);
  assert.ok(titles.includes("Feebas evolved into Milotic!"), titles.join(" | "));
  assert.ok(!titles.some((t) => /Deino|Zweilous|Hydreigon/.test(t)), "the lead's hidden Pokémon never shows");
  assert.equal(e.xpOf("lead:code-reviews").level, 64, "the lead still levels");
});

/** An install without a pack: leads, and threads in turn. */
function crowd(db = new DatabaseSync(":memory:")) {
  const { e } = setup({ pokemon: true }, db);
  e.register("T-cos", "cos", null);
  for (const p of ["code-reviews", "vm-storage", "edge-cli"]) e.register(`L-${p}`, "lead", p);
  for (let n = 0; n < 4; n++) for (const p of ["code-reviews", "vm-storage", "edge-cli"]) e.register(`W-${p}-${n}`, "thread", p, `L-${p}`);
  return { db, e };
}

test("loading a pack moves no agent, and a second settle moves nothing", () => {
  const { db, e } = crowd();
  const before = rows(db);
  e.settings = { ...e.settings, personas: PACK };
  assert.deepEqual(rows(db), before, "in the running plugin");
  assert.equal(e.settleMons(), 0);
  const { e: fresh } = setup({ pokemon: true, personas: PACK }, db);
  assert.deepEqual(rows(db), before, "and in a plugin started with the pack");
  assert.equal(fresh.settleMons(), 0);
});

test("a plugin restarted with the pack keeps threads on their persona's lines and on their leads' freed lines", () => {
  const db = new DatabaseSync(":memory:");
  const { e } = setup({ pokemon: true, personas: PACK }, db);
  e.register("L-vm", "lead", "vm-storage"); // hidden Pokémon: Gible
  e.register("L-cr", "lead", "code-reviews");
  e.register("W-vm", "thread", "vm-storage", "L-vm"); // Gible, the lead's own line
  e.register("W-cr1", "thread", "code-reviews", "L-cr"); // Feebas
  e.register("W-cr2", "thread", "code-reviews", "L-cr"); // Budew: outside the Dark family
  e.retire("W-cr1");
  e.register("W-cr3", "thread", "code-reviews", "L-cr"); // Feebas again, the first free line: a re-pick would swap it
  const before = rows(db);
  assert.deepEqual(["W-vm", "W-cr2", "W-cr3"].map((t) => monOf(db, t)), ["Gible", "Budew", "Feebas"]);
  setup({ pokemon: true, personas: PACK }, db);
  assert.deepEqual(rows(db), before);
});

test("removing the pack gives each lead its Pokémon back and moves threads off it and off pack lines, keeping their stage", () => {
  const db = new DatabaseSync(":memory:");
  const { e } = setup({ pokemon: true, personas: PACK }, db);
  e.register("L-vm", "lead", "vm-storage"); // Pell; its hidden Pokémon is Gible
  e.register("L-cr", "lead", "code-reviews"); // Vesna
  e.register("W-vm", "thread", "vm-storage", "L-vm"); // Gible: the lead's line is free while a pack applies
  e.register("W-cr", "thread", "code-reviews", "L-cr"); // Feebas: a pack line
  assert.equal(monOf(db, "L-vm"), "Gible");
  assert.equal(monOf(db, "W-vm"), "Gible");
  e.gainXp("W-vm", tokensForLevel(30), 1); // Gabite: stage 1
  e.gainXp("W-cr", tokensForLevel(40), 1); // Milotic: stage 1
  e.settings = { ...e.settings, personas: null };
  assert.equal(e.agentByAddress("lead:vm-storage")!.mon, "Gible", "the lead has its Pokémon back");
  const vm = rows(db).find((r) => r.thread_id === "W-vm")!;
  const cr = rows(db).find((r) => r.thread_id === "W-cr")!;
  assert.notEqual(vm.mon, "Gible");
  assert.notEqual(cr.mon, "Feebas");
  assert.ok(monByName(cr.mon), "a line the plugin knows without the pack");
  assert.equal(monByName("Feebas"), null, "the pack's lines are gone");
  assert.deepEqual([vm.mon_stage, cr.mon_stage], [1, 1], "each kept its stage");
  assert.equal(e.personaOf(e.agentByAddress("lead:vm-storage")!), null);
  assert.equal(e.settleMons(), 0, "a second run moves nothing");
});

test("a plugin started without the pack it had moves threads off pack lines; with no stage to read it keeps any old pin", () => {
  const db = new DatabaseSync(":memory:");
  const { e } = setup({ pokemon: true, personas: PACK }, db);
  e.register("L-cr", "lead", "code-reviews");
  e.register("W-cr", "thread", "code-reviews", "L-cr");
  e.gainXp("W-cr", tokensForLevel(40), 1);
  const { e: fresh } = setup({ pokemon: true }, db);
  const cr = rows(db).find((r) => r.thread_id === "W-cr")!;
  assert.ok(cr.mon !== "Feebas" && monByName(cr.mon), cr.mon);
  assert.equal(cr.mon_stage, null, "no pin: the new line shows its own stage at the level");
  assert.equal(fresh.agentByAddress("lead:code-reviews")!.mon, "Deino");
  assert.equal(fresh.settleMons(), 0);
});

test("a pack that fails its checks shows nothing and moves nothing", () => {
  const db = new DatabaseSync(":memory:");
  const { e } = setup({ pokemon: true, personas: PACK }, db);
  e.register("L-cr", "lead", "code-reviews");
  e.register("W-cr", "thread", "code-reviews", "L-cr");
  const before = rows(db);
  e.settings = { ...e.settings, personas: { error: "personas pack: 1 problem: fallback: no persona" } };
  assert.deepEqual(rows(db), before, "a typo is not a removal");
  assert.equal(e.personaOf(e.agentByAddress("lead:code-reviews")!), null);
  setup({ pokemon: true, personas: { error: "broken" } }, db);
  assert.deepEqual(rows(db), before, "nor at load");
});
