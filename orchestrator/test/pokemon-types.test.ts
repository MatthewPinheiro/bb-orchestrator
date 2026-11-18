// Pokémon types per project (requested 2026-11-16): each live project holds its own type; its lead is that type's
// strongest line and its threads are lines of the type, then of the lead's secondary type, then of a fixed sibling, so
// the family reads as one. No two live agents share a Pokémon, every sprite is an animated one, the one-time move to the
// families keeps every agent's level and stage, and with the setting off no project gets an accent colour.
// Project names here are made up.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { migrate } from "../core/db.ts";
import { MON_POOLS, TYPES, allMonNames, baseOf, familyThreads, familyTypes, levelFor, lineTypes, monByName, pickType, shownStage, tokensForLevel, typeFamily } from "../mons.ts";
import { ACCENT_VAR, accentText, accentTone, accentVars, sectionCss } from "../app/accent.ts";
import { css, projectTone } from "../app/palette.ts";
import { sectionTitle } from "../core/model.ts";

const ports = { now: () => Date.parse("2026-11-16T12:00:00Z"), deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} };

type Live = { thread_id: string; address: string; role: string; project: string | null; mon: string; mon_stage: number | null; mon_stage_level: number | null };
const live = (db: DatabaseSync) => db.prepare(`SELECT thread_id, address, role, project, mon, mon_stage, mon_stage_level FROM agents WHERE retired_at IS NULL ORDER BY thread_id`).all() as Live[];
const typeOf = (db: DatabaseSync, slug: string) => (db.prepare(`SELECT mon_type FROM projects WHERE slug = ?`).get(slug) as { mon_type: string | null }).mon_type;

test("the 18 types are all there, each with its own lead line, and every family's lines carry its types", () => {
  assert.equal(new Set(TYPES.map((t) => t.type)).size, 18);
  assert.equal(new Set(TYPES.map((t) => t.lead)).size, 18, "no two types share a lead line");
  const threadLines = new Set(TYPES.flatMap((t) => t.threads));
  for (const t of TYPES) {
    assert.ok(lineTypes(t.lead).includes(t.type), `${t.type}: its lead ${t.lead} carries the type`);
    if (t.second) assert.ok(lineTypes(t.lead).includes(t.second), `${t.type}: the secondary ${t.second} is the lead line's other type`);
    assert.ok(typeFamily(t.sibling) && t.sibling !== t.type, `${t.type}: a real sibling`);
    assert.ok(!threadLines.has(t.lead), `${t.lead} is a lead line: no thread pool lists it, so a live thread never blocks a lead`);
    for (const n of t.threads) assert.ok(lineTypes(n).includes(t.type), `${n} is in the ${t.type} pool but carries no ${t.type} form`);
  }
  const words = TYPES.flatMap((t) => t.words);
  assert.equal(new Set(words).size, words.length, "a kind word asks for one type only");
});

test("every sprite is an animated one: no Pokémon the orchestrator can show is past dex 649", () => {
  for (const n of allMonNames()) assert.ok(monByName(n)!.dex <= 649, `${n} (#${monByName(n)!.dex}) has no animated sprite`);
});

test("every thread line evolves twice, so each thread can evolve", () => {
  for (const x of MON_POOLS.thread) assert.equal(shownStage(x.name, 100), 2, `${x.name} is a three-stage line`);
});

/** Nine projects of made-up names, each a different kind of work, with a lead and several threads each. */
const PROJECTS = ["agent-evals", "edge-cli", "vm-storage", "ship-train", "orchestrator-core", "bug-triage", "code-reviews", "qa-suite", "team-playbook"];

/** How many threads each runs at once in a busy install (the owner's, 2026-11-16: up to 8 on one project). */
const BUSY = [6, 6, 8, 3, 4, 2, 2, 2, 2];

/** `threads`: one count for all, or one per project; registered in turns, as the leads start them. */
function crowd(threads: number | number[] = BUSY) {
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, ports, { pokemon: true });
  e.register("T-cos", "cos", null);
  e.register("T-st", "steward", null);
  for (const p of PROJECTS) e.register(`L-${p}`, "lead", p);
  const count = (i: number) => (typeof threads === "number" ? threads : threads[i]!);
  for (let n = 0; n < Math.max(...PROJECTS.map((_, i) => count(i))); n++) PROJECTS.forEach((p, i) => (n < count(i) ? e.register(`W-${p}-${n}`, "thread", p, `L-${p}`) : null));
  return { db, e };
}

test("no two live agents share a Pokémon, across every role and project, even past what the families hold", () => {
  // 62 threads: every three-stage thread line there is (MON_POOLS.thread) held at once, but Happiny's, which the
  // Steward's Chansey holds (2026-11-18: by line, not name)
  const { db } = crowd([7, 7, 7, 7, 7, 7, 7, 7, 6]);
  assert.equal(live(db).filter((r) => r.role === "thread").length, MON_POOLS.thread.length - 1);
  const mons = live(db).map((r) => baseOf(r.mon));
  assert.equal(new Set(mons).size, mons.length, `shared: ${mons.filter((m, i) => mons.indexOf(m) !== i).join(", ")}`);
  // and after a restart (the settle runs again), still none
  new Engine(db as never, ports, { pokemon: true });
  const again = live(db).map((r) => baseOf(r.mon));
  assert.equal(new Set(again).size, again.length);
});

test("no thread holds the line of the CoS's or the Steward's Pokémon: a thread on it moves, the Steward stays", () => {
  // 2026-11-18, the owner on the sidebar: two Chanseys, the Steward's and a Lv 21 thread on Happiny's line. No two live
  // agents share a line (baseOf), not just a name: Chansey is the middle of Happiny's line, so the Steward holds it all.
  const standing = new Set([...MON_POOLS.cos, ...MON_POOLS.steward].map((m) => baseOf(m.name)));
  assert.ok(standing.has("Happiny"), "the Steward's Chansey is on Happiny's line");
  const db = new DatabaseSync(":memory:");
  let t = Date.parse("2026-11-16T12:00:00Z");
  const e = new Engine(db as never, { ...ports, now: () => (t += 1000) }, { pokemon: true });
  e.register("L-a", "lead", "alpha"); // no type's words: Normal, the first free; its lines are Whismur, Lillipup, Slakoth, Happiny, …
  e.register("W-0", "thread", "alpha", "L-a");
  // a thread that took Happiny before the Steward started, as on the owner's install
  db.prepare(`UPDATE agents SET mon = 'Happiny', mon_stage = NULL, mon_stage_level = NULL WHERE thread_id = 'W-0'`).run();
  e.gainXp("W-0", tokensForLevel(21), 1);
  e.register("T-cos", "cos", null);
  e.register("T-st", "steward", null);
  for (let n = 1; n <= 30; n++) e.register(`W-${n}`, "thread", "alpha", "L-a");
  const lineOf = (id: string) => baseOf(e.agentByThread(id)!.mon!);
  for (let n = 1; n <= 30; n++) assert.ok(!standing.has(lineOf(`W-${n}`)), `W-${n}: a new thread never gets a standing agent's line (got ${lineOf(`W-${n}`)})`);
  assert.equal(e.agentByThread("W-0")!.mon, "Happiny", "the old thread is still there until a settle");
  const steward = JSON.stringify(live(db).find((r) => r.role === "steward"));
  new Engine(db as never, ports, { pokemon: true }); // a restart (the install) settles
  assert.ok(!standing.has(lineOf("W-0")), `the old thread moved off the Steward's line (to ${lineOf("W-0")})`);
  assert.equal(e.xpOf(e.agentByThread("W-0")!.address).level, 21, "and kept its level");
  assert.equal(JSON.stringify(live(db).find((r) => r.role === "steward")), steward, "the Steward never moves");
  const lines = live(db).map((r) => baseOf(r.mon));
  assert.equal(new Set(lines).size, lines.length, "no two live agents share a line");
  assert.equal(e.settleMons(), 0, "a second settle moves nothing");
});

test("each live project holds its own type, picked from its words, and its lead is that type's line", () => {
  const { db, e } = crowd(0);
  const types = PROJECTS.map((p) => typeOf(db, p));
  assert.equal(new Set(types).size, PROJECTS.length, "no two live projects share a type");
  assert.deepEqual(types, ["psychic", "electric", "ground", "flying", "ghost", "bug", "dark", "fighting", "dragon"]);
  for (const p of PROJECTS) assert.equal(e.agentByAddress(`lead:${p}`)!.mon, typeFamily(typeOf(db, p))!.lead);
});

test("a project's threads never use a type outside its lead's type, the lead's secondary or the sibling", () => {
  const { db } = crowd(); // a busy install
  for (const r of live(db).filter((x) => x.role === "thread")) {
    const fam = typeFamily(typeOf(db, r.project!))!;
    const allowed = familyTypes(fam);
    assert.ok(lineTypes(r.mon).some((t) => allowed.includes(t)), `${r.address} is ${r.mon} (${lineTypes(r.mon).join("/")}), outside ${allowed.join("/")}`);
    assert.ok(familyThreads(fam).includes(r.mon), `${r.address}: ${r.mon} is not one of its family's lines`);
  }
});

test("only when a whole family is held does a thread borrow a free line from outside it: no two agents share one", () => {
  const e = new Engine(new DatabaseSync(":memory:") as never, ports, { pokemon: true });
  e.register("L", "lead", "code-reviews");
  const fam = familyThreads(typeFamily("dark")!);
  const mons = fam.map((_, i) => e.register(`W${i}`, "thread", "code-reviews", "L").mon!);
  assert.deepEqual(mons, fam, "first the whole family, in order");
  const extra = e.register("W-extra", "thread", "code-reviews", "L").mon!;
  assert.ok(!mons.includes(extra) && MON_POOLS.thread.some((x) => x.name === extra), `${extra}: a free three-stage line`);
});

test("overflow follows the rule: the type's own lines, then the lead's secondary type, then the sibling", () => {
  const ghost = typeFamily("ghost")!;
  assert.deepEqual(familyTypes(ghost), ["ghost", "poison", "dark"], "Gengar is Ghost/Poison, so Poison comes before the Dark sibling");
  const e = new Engine(new DatabaseSync(":memory:") as never, ports, { pokemon: true });
  e.register("L", "lead", "orchestrator-core");
  const mons = ["1", "2", "3"].map((n) => e.register(`W${n}`, "thread", "orchestrator-core", "L").mon);
  assert.deepEqual(mons, ["Litwick", "Duskull", "Venipede"]);
});

test("a new project takes a free type by its words; a taken one sends it to the matched type's sibling, then the first free", () => {
  assert.equal(pickType("edge-cli", []), "electric");
  assert.equal(pickType("edge-cli", ["electric"]), "steel", "Electric's sibling");
  assert.equal(pickType("nothing-matches", ["normal"]), "fire");
  assert.equal(pickType("anything", TYPES.map((t) => t.type)), "normal", "all 18 held: shared, never a crash");
});

test("a project brought back from the archive keeps its type unless a live project took it meanwhile", () => {
  const { db, e } = crowd(0);
  db.prepare(`UPDATE projects SET archived_at = 1 WHERE slug = 'edge-cli'`).run();
  e.register("L-term", "lead", "term-cli");
  assert.equal(typeOf(db, "term-cli"), "electric", "the archived project's type is free again");
  db.prepare(`UPDATE projects SET archived_at = NULL WHERE slug = 'edge-cli'`).run();
  assert.notEqual(e.typeFor("edge-cli"), "electric", "it came back after its type was taken: it picks another");
});

// ---------------------------------------------------------------- the one-time move to the families

/** A database as the plugin left it before types: every migration but the new state, Pokémon from the old pools. */
function before() {
  const db = new DatabaseSync(":memory:");
  migrate(db as never);
  const projects = ["agent-evals", "edge-cli", "vm-storage", "ship-train", "orchestrator-core"];
  projects.forEach((p, i) => db.prepare(`INSERT INTO projects (slug, created_at) VALUES (?, ?)`).run(p, i));
  const rows: [string, string, string | null, string, number][] = [
    // thread_id, role, project, old mon, level
    ["T-cos", "cos", null, "Rayquaza", 54],
    ["T-st", "steward", null, "Regigigas", 7], // the Steward before 2026-11-18: settling moves it to Chansey
    ["L1", "lead", "agent-evals", "Solosis", 38], // Duosion: Metang at 38 too
    ["L2", "lead", "edge-cli", "Bagon", 16], // Bagon at 16; Shinx would be Luxio by level: the pin keeps it Shinx
    ["L3", "lead", "vm-storage", "Drilbur", 22],
    ["L4", "lead", "ship-train", "Dratini", 17],
    ["L5", "lead", "orchestrator-core", "Larvitar", 24],
    ["W1", "thread", "vm-storage", "Wurmple", 21], // Beautifly at 21: a slow line would show its base, the pin keeps the final form
    ["W2", "thread", "vm-storage", "Caterpie", 6],
    ["W3", "thread", "edge-cli", "Totodile", 15],
    ["W4", "thread", "edge-cli", "Chimchar", 1],
    ["W5", "thread", "agent-evals", "Chikorita", 19],
    ["W6", "thread", "orchestrator-core", "Squirtle", 10],
    ["W7", "thread", "orchestrator-core", "Bellsprout", 1],
    ["W8", "thread", "ship-train", "Mudkip", 18],
  ];
  rows.forEach(([id, role, project, mon, level], i) => {
    const address = role === "cos" || role === "steward" ? role : role === "lead" ? `lead:${project}` : `thread:${project}:${id.slice(1)}`;
    db.prepare(`INSERT INTO agents (thread_id, address, role, project, status, created_at, mon) VALUES (?, ?, ?, ?, 'idle', ?, ?)`).run(id, address, role, project, i, mon);
    db.prepare(`INSERT INTO xp (address, tokens, updated_at) VALUES (?, ?, 0)`).run(address, tokensForLevel(level) + 12_345);
  });
  // a retired row on a Pokémon no pool has any more: it keeps its name, and the name still resolves
  db.prepare(`INSERT INTO agents (thread_id, address, role, project, status, created_at, retired_at, mon) VALUES ('OLD', 'thread:vm-storage:0', 'thread', 'vm-storage', 'archived', 0, 1, 'Bidoof')`).run();
  return db;
}

const levelOf = (db: DatabaseSync, address: string) => levelFor((db.prepare(`SELECT tokens FROM xp WHERE address = ?`).get(address) as { tokens: number }).tokens);
const stageOf = (db: DatabaseSync, r: Live) => shownStage(r.mon, levelOf(db, r.address), r.mon_stage != null ? { stage: r.mon_stage, level: r.mon_stage_level! } : null);

test("the move to the families keeps every agent's level and evolution stage, and running it again changes nothing", () => {
  const db = before();
  const was = new Map(live(db).map((r) => [r.address, { level: levelOf(db, r.address), stage: stageOf(db, r), mon: r.mon }]));
  const e = new Engine(db as never, ports, { pokemon: true });
  const after = live(db);
  for (const r of after) {
    const w = was.get(r.address)!;
    assert.equal(levelOf(db, r.address), w.level, `${r.address}: level`);
    assert.equal(stageOf(db, r), w.stage, `${r.address}: ${w.mon} → ${r.mon} changed stage`);
  }
  // the two cases a plain re-pick would get wrong, both directions
  assert.equal(e.agentByAddress("lead:edge-cli")!.mon, "Shinx");
  assert.equal(e.formOf(e.agentByAddress("lead:edge-cli")!, 16)!.name, "Shinx", "not Luxio: it was a base form");
  assert.equal(stageOf(db, after.find((r) => r.address === "thread:vm-storage:1")!), 2, "Beautifly stays a final form");
  // the Steward's Pokémon changed (2026-11-18, the owner): a stored Regigigas is no longer the Steward's, so it moves;
  // the CoS keeps Rayquaza
  assert.equal(e.agentByAddress("steward")!.mon, "Chansey");
  assert.equal(e.formOf(e.agentByAddress("steward")!, 7)!.name, "Chansey");
  assert.equal(e.agentByAddress("cos")!.mon, "Rayquaza");
  // it really moved them, to their families
  assert.deepEqual(["agent-evals", "edge-cli", "vm-storage", "ship-train", "orchestrator-core"].map((p) => e.agentByAddress(`lead:${p}`)!.mon), ["Beldum", "Shinx", "Gible", "Dratini", "Gastly"]);
  const mons = after.map((r) => r.mon);
  assert.equal(new Set(mons).size, mons.length, "no two share one");
  // idempotent: a restart, and another, leave every row as it is
  const snap = JSON.stringify(live(db));
  new Engine(db as never, ports, { pokemon: true });
  new Engine(db as never, ports, { pokemon: false });
  assert.equal(JSON.stringify(live(db)), snap);
  assert.ok(monByName((db.prepare(`SELECT mon FROM agents WHERE thread_id = 'OLD'`).get() as { mon: string }).mon), "an old row's name still resolves");
});

test("a kept stage evolves on at the new line's levels once the agent levels past it, and a handoff keeps it", () => {
  const db = before();
  const e = new Engine(db as never, ports, { pokemon: true });
  const lead = e.agentByAddress("lead:edge-cli")!; // Shinx kept at stage 0, level 16
  e.gainXp(lead.threadId, tokensForLevel(17) - tokensForLevel(16), 1);
  assert.ok(e.board().some((r) => /Shinx evolved into Luxio/.test(r.title)), "the next level-up catches it up");
  const t = e.agentByAddress("thread:vm-storage:1")!;
  const succ = e.takeOver(t.threadId, "T-next", "handoff.md");
  assert.deepEqual(succ.monPin, t.monPin, "the successor keeps the stage");
  assert.equal(succ.mon, t.mon);
});

// ---------------------------------------------------------------- the project accent

test("with the pokemon setting off no project gets an accent colour, and the sidebar is exactly as before", () => {
  const { e } = crowd(1);
  e.settings = { ...e.settings, pokemon: false };
  for (const p of PROJECTS) assert.equal(e.accentType(p), null, `${p} has an accent with the setting off`);
  assert.equal(accentVars(null), undefined);
  assert.equal(accentText(null, "inherit"), "inherit");
  assert.equal(accentTone(undefined), null);
  // the 2026-11-13 sidebar code, verbatim: the off output must be byte for byte the same
  const old = (slugs: (string | null)[]) =>
    [...new Set<string | null>([null, ...slugs])].flatMap((slug) => {
      const title = sectionTitle(slug).replace(/["\\]/g, "");
      const c = css(projectTone(slug));
      const head = `[data-sidebar-section-id]:has(> [data-sidebar="group-label"] span[title="${title}"]) > [data-sidebar="group-label"]`;
      return [
        `${head} { background: color-mix(in srgb, ${c} 14%, var(--sidebar, var(--background))) !important; border-radius: 6px; margin: 6px 0 2px; }`,
        `${head} span[title] { color: ${c}; font-weight: 650; letter-spacing: .01em; }`,
      ];
    });
  const agents = e.agents().map((a) => ({ project: a.project, monType: e.accentType(a.project) }));
  assert.deepEqual(sectionCss(agents), old(agents.map((a) => a.project)));
  assert.ok(!sectionCss(agents).some((l) => l.includes(ACCENT_VAR)));
});

test("with it on, a project's accent is its type's colour, and its lead's and threads' rows share it", () => {
  const { e } = crowd(2);
  for (const p of PROJECTS) {
    const t = e.accentType(p);
    assert.equal(accentTone(t), typeFamily(t)!.tone);
    const colours = new Set(e.agents().filter((a) => a.project === p).map((a) => accentText(e.accentType(a.project))));
    assert.equal(colours.size, 1, `${p}: every agent's colour matches its lead's`);
  }
  const css = sectionCss(e.agents().map((a) => ({ project: a.project, monType: e.accentType(a.project) })));
  assert.ok(css.some((l) => l.includes(`${ACCENT_VAR}:`)), "the sidebar section carries the token");
});
