// Each role agent's Pokémon (2026-11-13): the CoS is Rayquaza, the Steward Regigigas, leads start as the base
// form of a strong line and threads as early-route ones; both evolve as they level. Assigned at registration and kept
// for the address's life. Only names, types and National Dex numbers live here: the sprites load at runtime from PokeAPI's public sprite repo, never bundled.

export interface Mon {
  name: string;
  dex: number;
}

const m = (name: string, dex: number): Mon => ({ name, dex });

// Requested 2026-11-16 ("each project gets a Pokémon type"): every live project holds one of the 18 types, its own.
// Its lead is the strongest line of that type (shiny); its threads are other three-stage lines of the same type, then
// of the lead's secondary type, then of a fixed sibling type, so a project's family reads as one. The CoS and the
// Steward stay Rayquaza and Regigigas. A project's type is picked once by the words of its slug (or the first free
// one) and kept in the projects table; nothing here names a project.

export type MonType =
  | "normal" | "fire" | "water" | "electric" | "grass" | "ice" | "fighting" | "poison" | "ground"
  | "flying" | "psychic" | "bug" | "rock" | "ghost" | "dragon" | "dark" | "steel" | "fairy";

export interface TypeFamily {
  type: MonType;
  label: string;
  /** The project accent: readable as text on bb's light and dark surfaces and on a tint of itself (palette.test.ts). */
  tone: { light: string; dark: string };
  /** The lead's line (its base form). No thread pool lists it, so a live thread never blocks a lead. */
  lead: string;
  /** The lead line's other type: where threads go when the type's own lines are all held. */
  second: MonType | null;
  /** Then this fixed sibling type. */
  sibling: MonType;
  /** Slug words that ask for this type ("code-reviews" → review). */
  words: readonly string[];
  why: string;
  /** Three-stage lines that carry this type in some form, best first. */
  threads: readonly string[];
}

// Tones: the type's colour darkened (light theme) or lightened (dark theme) until text in it reads at 4.5:1 on bb's
// surfaces and on a 12-20% tint of itself.
export const TYPES: readonly TypeFamily[] = [
  { type: "normal", label: "Normal", tone: { light: "#434331", dark: "#b6b58f" }, lead: "Porygon", second: null, sibling: "fighting", why: "Porygon was built by programmers", words: ["dev", "dx", "experience", "tooling", "sdk", "upgrades", "helper", "misc", "one", "off"], threads: ["Whismur", "Lillipup", "Slakoth", "Happiny", "Igglybuff", "Azurill"] },
  { type: "fire", label: "Fire", tone: { light: "#693915", dark: "#f29f62" }, lead: "Charmander", second: "flying", sibling: "dragon", why: "Charizard: speed and heat", words: ["perf", "performance", "optimization", "speed", "fast", "latency"], threads: ["Cyndaquil", "Torchic", "Chimchar", "Tepig", "Magby", "Litwick"] },
  { type: "water", label: "Water", tone: { light: "#2e426e", dark: "#93b2f5" }, lead: "Magikarp", second: "flying", sibling: "ice", why: "Gyarados: data flows", words: ["data", "anonymize", "stream", "streams", "flow", "etl", "warehouse"], threads: ["Squirtle", "Totodile", "Oshawott", "Piplup", "Mudkip", "Poliwag", "Tympole", "Horsea", "Lotad", "Spheal", "Azurill"] },
  { type: "electric", label: "Electric", tone: { light: "#4f430e", dark: "#f7d02c" }, lead: "Shinx", second: null, sibling: "steel", why: "Luxray: a terminal's current", words: ["cli", "terminal", "shell", "command", "commands"], threads: ["Mareep", "Tynamo", "Pichu", "Elekid"] },
  { type: "grass", label: "Grass", tone: { light: "#2e4c1d", dark: "#7ac74c" }, lead: "Bulbasaur", second: "poison", sibling: "bug", why: "Venusaur: things that grow", words: ["eye", "candy", "ui", "ux", "design", "frontend", "growth", "web"], threads: ["Chikorita", "Treecko", "Turtwig", "Snivy", "Oddish", "Bellsprout", "Seedot", "Lotad", "Sewaddle", "Budew", "Hoppip"] },
  { type: "ice", label: "Ice", tone: { light: "#314847", dark: "#96d9d6" }, lead: "Swinub", second: "ground", sibling: "water", why: "Mamoswine: what is frozen and old", words: ["deprecation", "migration", "migrations", "archive", "legacy", "cache"], threads: ["Spheal", "Vanillite"] },
  { type: "fighting", label: "Fighting", tone: { light: "#8e221d", dark: "#e4a3a0" }, lead: "Riolu", second: "steel", sibling: "normal", why: "Lucario senses the aura of hidden flaws", words: ["qa", "test", "tests", "testing", "runners", "e2e"], threads: ["Machop", "Timburr", "Poliwag", "Torchic", "Chimchar", "Tepig"] },
  { type: "poison", label: "Poison", tone: { light: "#6f2a6d", dark: "#d4a4d3" }, lead: "Nidoran♀", second: "ground", sibling: "bug", why: "Nidoqueen guards the nest", words: ["security", "pii", "guard", "privacy", "rate", "limiting", "abuse", "anonymization"], threads: ["Venipede", "Oddish", "Bellsprout", "Budew", "Weedle", "Zubat", "Nidoran♂"] },
  { type: "ground", label: "Ground", tone: { light: "#4d4122", dark: "#e2bf65" }, lead: "Gible", second: "dragon", sibling: "rock", why: "Garchomp digs: file systems and machines", words: ["file", "files", "system", "microvm", "vm", "storage", "fs", "disk", "cloud"], threads: ["Geodude", "Rhyhorn", "Trapinch", "Nidoran♂", "Sandile", "Mudkip", "Turtwig", "Tympole"] },
  { type: "flying", label: "Flying", tone: { light: "#473c66", dark: "#bba7f6" }, lead: "Dratini", second: "dragon", sibling: "normal", why: "Dragonite delivers the mail: shipping", words: ["deploy", "deployment", "deployments", "release", "releases", "ci", "cd", "continuous", "ship", "delivery"], threads: ["Pidgey", "Starly", "Pidove", "Zubat", "Hoppip"] },
  { type: "psychic", label: "Psychic", tone: { light: "#7a2a42", dark: "#fb92b2" }, lead: "Beldum", second: "steel", sibling: "fairy", why: "Metagross: four brains, a supercomputer", words: ["ai", "llm", "llms", "ml", "model", "models", "classifier", "benchmark", "benchmarks", "harness", "agent", "agents", "eval", "evals"], threads: ["Abra", "Ralts", "Gothita", "Solosis"] },
  { type: "bug", label: "Bug", tone: { light: "#3f460a", dark: "#aabc23" }, lead: "Scyther", second: "steel", sibling: "grass", why: "it takes one to catch one", words: ["bug", "bugs", "debug", "incident", "investigation", "healing", "triage"], threads: ["Caterpie", "Weedle", "Wurmple", "Venipede", "Sewaddle"] },
  { type: "rock", label: "Rock", tone: { light: "#4c4417", dark: "#c4b35c" }, lead: "Larvitar", second: "dark", sibling: "ground", why: "Tyranitar: the bedrock everything stands on", words: ["gateway", "mcp", "db", "database", "backend", "platform", "api", "infra"], threads: ["Geodude", "Roggenrola", "Rhyhorn", "Aron"] },
  { type: "ghost", label: "Ghost", tone: { light: "#4e3b67", dark: "#baadcc" }, lead: "Gastly", second: "poison", sibling: "dark", why: "Gengar: the hand behind every thread", words: ["orchestrator", "orchestration", "coordinator", "memory", "dreams", "plugin"], threads: ["Litwick", "Duskull"] },
  { type: "dragon", label: "Dragon", tone: { light: "#5127b8", dark: "#bea4fe" }, lead: "Bagon", second: "flying", sibling: "fire", why: "Salamence: a Champion's dragon leads the team", words: ["team", "management", "people", "playbook", "workflow", "hiring"], threads: ["Axew", "Trapinch", "Horsea"] },
  { type: "dark", label: "Dark", tone: { light: "#524033", dark: "#bcb0a8" }, lead: "Deino", second: "dragon", sibling: "ghost", why: "Hydreigon: three heads review from every side", words: ["review", "reviews", "pr", "prs", "audit", "code"], threads: ["Sandile", "Seedot"] },
  { type: "steel", label: "Steel", tone: { light: "#42424a", dark: "#b7b7ce" }, lead: "Drilbur", second: "ground", sibling: "rock", why: "Excadrill: industry and machines", words: ["factory", "automation", "software", "self", "improvement", "pipeline", "pipelines", "build"], threads: ["Magnemite", "Klink", "Aron", "Piplup"] },
  { type: "fairy", label: "Fairy", tone: { light: "#5c394a", dark: "#dfa0bf" }, lead: "Togepi", second: "flying", sibling: "psychic", why: "Togekiss flies out to where the customer is", words: ["fde", "field", "customer", "forward", "desk", "support", "success"], threads: ["Cleffa", "Igglybuff", "Azurill", "Ralts"] },
];
export const typeFamily = (t: string | null | undefined): TypeFamily | null => TYPES.find((x) => x.type === t) ?? null;

/** Every line's dex number and the types it carries in any form (PokeAPI; Fairy as typed since Gen 6). */
export const LINES: Record<string, { dex: number; types: readonly MonType[] }> = {
  Porygon: { dex: 137, types: ["normal"] }, Whismur: { dex: 293, types: ["normal"] }, Lillipup: { dex: 506, types: ["normal"] },
  Slakoth: { dex: 287, types: ["normal"] }, Happiny: { dex: 440, types: ["normal"] }, Igglybuff: { dex: 174, types: ["normal", "fairy"] },
  Azurill: { dex: 298, types: ["normal", "water", "fairy"] },
  Charmander: { dex: 4, types: ["fire", "flying"] }, Cyndaquil: { dex: 155, types: ["fire"] }, Torchic: { dex: 255, types: ["fire", "fighting"] },
  Chimchar: { dex: 390, types: ["fire", "fighting"] }, Tepig: { dex: 498, types: ["fire", "fighting"] }, Magby: { dex: 240, types: ["fire"] },
  Litwick: { dex: 607, types: ["ghost", "fire"] },
  Magikarp: { dex: 129, types: ["water", "flying"] }, Squirtle: { dex: 7, types: ["water"] }, Totodile: { dex: 158, types: ["water"] },
  Oshawott: { dex: 501, types: ["water"] }, Piplup: { dex: 393, types: ["water", "steel"] }, Mudkip: { dex: 258, types: ["water", "ground"] },
  Poliwag: { dex: 60, types: ["water", "fighting"] }, Tympole: { dex: 535, types: ["water", "ground"] }, Horsea: { dex: 116, types: ["water", "dragon"] },
  Lotad: { dex: 270, types: ["water", "grass"] }, Spheal: { dex: 363, types: ["ice", "water"] },
  Shinx: { dex: 403, types: ["electric"] }, Mareep: { dex: 179, types: ["electric"] }, Tynamo: { dex: 602, types: ["electric"] },
  Pichu: { dex: 172, types: ["electric"] }, Elekid: { dex: 239, types: ["electric"] }, Magnemite: { dex: 81, types: ["electric", "steel"] },
  Bulbasaur: { dex: 1, types: ["grass", "poison"] }, Chikorita: { dex: 152, types: ["grass"] }, Treecko: { dex: 252, types: ["grass"] },
  Turtwig: { dex: 387, types: ["grass", "ground"] }, Snivy: { dex: 495, types: ["grass"] }, Oddish: { dex: 43, types: ["grass", "poison"] },
  Bellsprout: { dex: 69, types: ["grass", "poison"] }, Seedot: { dex: 273, types: ["grass", "dark"] }, Sewaddle: { dex: 540, types: ["bug", "grass"] },
  Budew: { dex: 406, types: ["grass", "poison"] }, Hoppip: { dex: 187, types: ["grass", "flying"] },
  Swinub: { dex: 220, types: ["ice", "ground"] }, Vanillite: { dex: 582, types: ["ice"] },
  Riolu: { dex: 447, types: ["fighting", "steel"] }, Machop: { dex: 66, types: ["fighting"] }, Timburr: { dex: 532, types: ["fighting"] },
  "Nidoran♀": { dex: 29, types: ["poison", "ground"] }, "Nidoran♂": { dex: 32, types: ["poison", "ground"] }, Venipede: { dex: 543, types: ["bug", "poison"] },
  Weedle: { dex: 13, types: ["bug", "poison"] }, Zubat: { dex: 41, types: ["poison", "flying"] },
  Gible: { dex: 443, types: ["dragon", "ground"] }, Geodude: { dex: 74, types: ["rock", "ground"] }, Rhyhorn: { dex: 111, types: ["ground", "rock"] },
  Trapinch: { dex: 328, types: ["ground", "dragon"] }, Sandile: { dex: 551, types: ["ground", "dark"] },
  Dratini: { dex: 147, types: ["dragon", "flying"] }, Pidgey: { dex: 16, types: ["normal", "flying"] }, Starly: { dex: 396, types: ["normal", "flying"] },
  Pidove: { dex: 519, types: ["normal", "flying"] },
  Beldum: { dex: 374, types: ["steel", "psychic"] }, Abra: { dex: 63, types: ["psychic"] }, Ralts: { dex: 280, types: ["psychic", "fairy"] },
  Gothita: { dex: 574, types: ["psychic"] }, Solosis: { dex: 577, types: ["psychic"] },
  Scyther: { dex: 123, types: ["bug", "flying", "steel"] }, Caterpie: { dex: 10, types: ["bug", "flying"] }, Wurmple: { dex: 265, types: ["bug", "flying"] },
  Larvitar: { dex: 246, types: ["rock", "ground", "dark"] }, Roggenrola: { dex: 524, types: ["rock"] }, Aron: { dex: 304, types: ["steel", "rock"] },
  Gastly: { dex: 92, types: ["ghost", "poison"] }, Duskull: { dex: 355, types: ["ghost"] },
  Bagon: { dex: 371, types: ["dragon", "flying"] }, Axew: { dex: 610, types: ["dragon"] },
  Deino: { dex: 633, types: ["dark", "dragon"] },
  Drilbur: { dex: 529, types: ["ground", "steel"] }, Klink: { dex: 599, types: ["steel"] },
  Togepi: { dex: 175, types: ["fairy", "flying"] }, Cleffa: { dex: 173, types: ["fairy"] },
};
/** The types a line carries in any of its forms (Nidoran♂ counts as Ground through Nidoking). */
export const lineTypes = (base: string): readonly MonType[] => LINES[base]?.types ?? [];

const lineMon = (name: string): Mon => m(name, LINES[name]!.dex);

/** A family's types in the order its threads take them: its own, the lead's secondary, the sibling. */
export const familyTypes = (t: TypeFamily): MonType[] => [...new Set([t.type, ...(t.second ? [t.second] : []), t.sibling])];
/** The thread lines a project of this type takes, in order, each once. */
export const familyThreads = (t: TypeFamily): string[] => [...new Set(familyTypes(t).flatMap((x) => typeFamily(x)!.threads))].filter((n) => !LEAD_NAMES.has(n));
const LEAD_NAMES = new Set(TYPES.map((t) => t.lead));

export const MON_POOLS: Record<"cos" | "steward" | "lead" | "thread", readonly Mon[]> = {
  cos: [m("Rayquaza", 384)],
  steward: [m("Regigigas", 486)],
  lead: TYPES.map((t) => lineMon(t.lead)),
  thread: [...new Set(TYPES.flatMap((t) => t.threads))].map(lineMon),
};
/** Pokémon of earlier pools (before 2026-11-16): still named on old rows, so they keep resolving; never picked again. */
const RETIRED_MONS: readonly Mon[] = [
  m("Bidoof", 399), m("Zigzagoon", 263), m("Rattata", 19), m("Sentret", 161), m("Patrat", 504), m("Kricketot", 401),
  m("Larvesta", 636), m("Eevee", 133), m("Staryu", 120), m("Onix", 95), m("Joltik", 595),
];

/**
 * The type a new project takes: the free type whose words its slug matches most (ties: TYPES order), then a free
 * sibling of a matched type, then the first free type. With all 18 held, they are shared in TYPES order.
 */
export function pickType(project: string, taken: readonly string[]): MonType {
  const words = project.toLowerCase().split(/[^a-z0-9]+/);
  const matched = TYPES.map((t) => ({ t, n: t.words.filter((w) => words.includes(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.t);
  const free = (t: TypeFamily | null) => !!t && !taken.includes(t.type);
  const pick = matched.find(free) ?? matched.map((t) => typeFamily(t.sibling)).find(free) ?? TYPES.find(free);
  return (pick ?? TYPES[taken.length % TYPES.length]!).type;
}

const BY_NAME = new Map([...Object.values(MON_POOLS).flat(), ...RETIRED_MONS, ...Object.keys(LINES).map(lineMon)].map((x) => [x.name, x]));
export const monByName = (name: string | null | undefined): Mon | null => (name ? (BY_NAME.get(name) ?? null) : null);

/**
 * The Pokémon a new agent gets; `taken` is every live agent's, whatever its role (no two share one).
 * A lead: its type's line, else the first free lead line. A thread: the first free line of its family (own type,
 * lead's secondary, sibling), else any free thread line, else its family's lines in turn (only when all are held).
 */
export function pickMon(role: keyof typeof MON_POOLS, taken: readonly string[], type: string | null = null): Mon {
  const free = (n: string) => !taken.includes(n);
  const fam = typeFamily(type) ?? TYPES[0]!;
  if (role === "lead") return lineMon([fam.lead, ...TYPES.map((t) => t.lead)].find(free) ?? fam.lead);
  if (role === "thread") {
    const own = familyThreads(fam);
    const name = own.find(free) ?? MON_POOLS.thread.map((x) => x.name).find(free) ?? own[taken.length % own.length]!;
    return lineMon(name);
  }
  const pool = MON_POOLS[role];
  return pool.find((x) => free(x.name)) ?? pool[taken.length % pool.length]!;
}

const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
/** Requested 2026-11-13: the CoS, the Steward and the leads are shiny; threads are normal. */
export const isShiny = (role: string | null | undefined) => role === "cos" || role === "steward" || role === "lead";
/** Animated Black/White sprite (dex ≤ 649), and a still one for reduced motion or as a fallback. */
export const monSprite = (x: Mon, animated: boolean, shiny = false) => {
  const s = shiny ? "shiny/" : "";
  return animated && x.dex <= 649 ? `${SPRITES}/versions/generation-v/black-white/animated/${s}${x.dex}.gif` : `${SPRITES}/${s}${x.dex}.png`;
};

// ---------------------------------------------------------------- levels and evolution (2026-11-13)
// Every agent levels up from the tokens its turns process, without a cap. Pokémon's "medium fast" curve: level L
// needs L³ × XP_PER_LEVEL_CUBE tokens, so level 10 is 10M tokens and level 50 is 1.25B. Threads evolve at their
// species' real evolution levels; so do leads (2026-11-13). Where the games evolve by trade, stone or friendship,
// the level is a fair stand-in. The CoS and the Steward are legendaries: they just keep levelling.
export const XP_PER_LEVEL_CUBE = 10_000;
export const levelFor = (tokens: number): number => Math.max(1, Math.floor(Math.cbrt(Math.max(0, tokens) / XP_PER_LEVEL_CUBE) + 1e-9));
export const tokensForLevel = (level: number): number => level ** 3 * XP_PER_LEVEL_CUBE;

/** Each thread's and lead's line: the level each later form arrives at. */
const EVOLUTIONS: Record<string, readonly { at: number; mon: Mon }[]> = {
  Caterpie: [{ at: 7, mon: m("Metapod", 11) }, { at: 10, mon: m("Butterfree", 12) }],
  Starly: [{ at: 14, mon: m("Staravia", 397) }, { at: 34, mon: m("Staraptor", 398) }],
  Bidoof: [{ at: 15, mon: m("Bibarel", 400) }],
  Weedle: [{ at: 7, mon: m("Kakuna", 14) }, { at: 10, mon: m("Beedrill", 15) }],
  Wurmple: [{ at: 7, mon: m("Silcoon", 266) }, { at: 10, mon: m("Beautifly", 267) }],
  Zigzagoon: [{ at: 20, mon: m("Linoone", 264) }],
  Pidgey: [{ at: 18, mon: m("Pidgeotto", 17) }, { at: 36, mon: m("Pidgeot", 18) }],
  Rattata: [{ at: 20, mon: m("Raticate", 20) }],
  Sentret: [{ at: 15, mon: m("Furret", 162) }],
  Patrat: [{ at: 20, mon: m("Watchog", 505) }],
  Lillipup: [{ at: 16, mon: m("Herdier", 507) }, { at: 32, mon: m("Stoutland", 508) }],
  Bulbasaur: [{ at: 16, mon: m("Ivysaur", 2) }, { at: 32, mon: m("Venusaur", 3) }],
  Charmander: [{ at: 16, mon: m("Charmeleon", 5) }, { at: 36, mon: m("Charizard", 6) }],
  Squirtle: [{ at: 16, mon: m("Wartortle", 8) }, { at: 36, mon: m("Blastoise", 9) }],
  Chikorita: [{ at: 16, mon: m("Bayleef", 153) }, { at: 32, mon: m("Meganium", 154) }],
  Cyndaquil: [{ at: 14, mon: m("Quilava", 156) }, { at: 36, mon: m("Typhlosion", 157) }],
  Totodile: [{ at: 18, mon: m("Croconaw", 159) }, { at: 30, mon: m("Feraligatr", 160) }],
  Treecko: [{ at: 16, mon: m("Grovyle", 253) }, { at: 36, mon: m("Sceptile", 254) }],
  Torchic: [{ at: 16, mon: m("Combusken", 256) }, { at: 36, mon: m("Blaziken", 257) }],
  Mudkip: [{ at: 16, mon: m("Marshtomp", 259) }, { at: 36, mon: m("Swampert", 260) }],
  Turtwig: [{ at: 18, mon: m("Grotle", 388) }, { at: 32, mon: m("Torterra", 389) }],
  Chimchar: [{ at: 14, mon: m("Monferno", 391) }, { at: 36, mon: m("Infernape", 392) }],
  Piplup: [{ at: 16, mon: m("Prinplup", 394) }, { at: 36, mon: m("Empoleon", 395) }],
  Snivy: [{ at: 17, mon: m("Servine", 496) }, { at: 36, mon: m("Serperior", 497) }],
  Tepig: [{ at: 17, mon: m("Pignite", 499) }, { at: 36, mon: m("Emboar", 500) }],
  Oshawott: [{ at: 17, mon: m("Dewott", 502) }, { at: 36, mon: m("Samurott", 503) }],
  Mareep: [{ at: 15, mon: m("Flaaffy", 180) }, { at: 30, mon: m("Ampharos", 181) }],
  Poliwag: [{ at: 25, mon: m("Poliwhirl", 61) }, { at: 36, mon: m("Poliwrath", 62) }],
  Oddish: [{ at: 21, mon: m("Gloom", 44) }, { at: 36, mon: m("Vileplume", 45) }],
  Bellsprout: [{ at: 21, mon: m("Weepinbell", 70) }, { at: 36, mon: m("Victreebel", 71) }],
  Geodude: [{ at: 25, mon: m("Graveler", 75) }, { at: 36, mon: m("Golem", 76) }],
  Machop: [{ at: 28, mon: m("Machoke", 67) }, { at: 40, mon: m("Machamp", 68) }],
  Hoppip: [{ at: 18, mon: m("Skiploom", 188) }, { at: 27, mon: m("Jumpluff", 189) }],
  Pidove: [{ at: 21, mon: m("Tranquill", 520) }, { at: 32, mon: m("Unfezant", 521) }],
  Sewaddle: [{ at: 20, mon: m("Swadloon", 541) }, { at: 36, mon: m("Leavanny", 542) }],
  Roggenrola: [{ at: 25, mon: m("Boldore", 525) }, { at: 36, mon: m("Gigalith", 526) }],
  Timburr: [{ at: 25, mon: m("Gurdurr", 533) }, { at: 36, mon: m("Conkeldurr", 534) }],
  Tympole: [{ at: 25, mon: m("Palpitoad", 536) }, { at: 36, mon: m("Seismitoad", 537) }],
  Whismur: [{ at: 20, mon: m("Loudred", 294) }, { at: 40, mon: m("Exploud", 295) }],
  Seedot: [{ at: 14, mon: m("Nuzleaf", 274) }, { at: 30, mon: m("Shiftry", 275) }],
  Lotad: [{ at: 14, mon: m("Lombre", 271) }, { at: 30, mon: m("Ludicolo", 272) }],
  Kricketot: [{ at: 10, mon: m("Kricketune", 402) }],
  // leads
  Abra: [{ at: 16, mon: m("Kadabra", 64) }, { at: 36, mon: m("Alakazam", 65) }],
  Ralts: [{ at: 20, mon: m("Kirlia", 281) }, { at: 30, mon: m("Gardevoir", 282) }],
  Eevee: [{ at: 25, mon: m("Espeon", 196) }],
  Beldum: [{ at: 20, mon: m("Metang", 375) }, { at: 45, mon: m("Metagross", 376) }],
  Solosis: [{ at: 32, mon: m("Duosion", 578) }, { at: 41, mon: m("Reuniclus", 579) }],
  Staryu: [{ at: 30, mon: m("Starmie", 121) }],
  Scyther: [{ at: 30, mon: m("Scizor", 212) }],
  Venipede: [{ at: 22, mon: m("Whirlipede", 544) }, { at: 30, mon: m("Scolipede", 545) }],
  Larvesta: [{ at: 59, mon: m("Volcarona", 637) }],
  Dratini: [{ at: 30, mon: m("Dragonair", 148) }, { at: 55, mon: m("Dragonite", 149) }],
  Bagon: [{ at: 30, mon: m("Shelgon", 372) }, { at: 50, mon: m("Salamence", 373) }],
  Drilbur: [{ at: 31, mon: m("Excadrill", 530) }],
  Onix: [{ at: 30, mon: m("Steelix", 208) }],
  Aron: [{ at: 32, mon: m("Lairon", 305) }, { at: 42, mon: m("Aggron", 306) }],
  Riolu: [{ at: 25, mon: m("Lucario", 448) }],
  Shinx: [{ at: 15, mon: m("Luxio", 404) }, { at: 30, mon: m("Luxray", 405) }],
  Magnemite: [{ at: 30, mon: m("Magneton", 82) }, { at: 45, mon: m("Magnezone", 462) }],
  Klink: [{ at: 38, mon: m("Klang", 600) }, { at: 49, mon: m("Klinklang", 601) }],
  Porygon: [{ at: 30, mon: m("Porygon2", 233) }, { at: 50, mon: m("Porygon-Z", 474) }],
  Joltik: [{ at: 36, mon: m("Galvantula", 596) }],
  Gible: [{ at: 24, mon: m("Gabite", 444) }, { at: 48, mon: m("Garchomp", 445) }],
  Larvitar: [{ at: 30, mon: m("Pupitar", 247) }, { at: 55, mon: m("Tyranitar", 248) }],
  Deino: [{ at: 50, mon: m("Zweilous", 634) }, { at: 64, mon: m("Hydreigon", 635) }],
  Magikarp: [{ at: 20, mon: m("Gyarados", 130) }],
  Axew: [{ at: 38, mon: m("Fraxure", 611) }, { at: 48, mon: m("Haxorus", 612) }],
  Gastly: [{ at: 25, mon: m("Haunter", 93) }, { at: 40, mon: m("Gengar", 94) }],
  // 2026-11-16, the type families. Where the games evolve by trade, stone or friendship, the level is a stand-in.
  Horsea: [{ at: 32, mon: m("Seadra", 117) }, { at: 50, mon: m("Kingdra", 230) }],
  Tynamo: [{ at: 39, mon: m("Eelektrik", 603) }, { at: 50, mon: m("Eelektross", 604) }],
  Pichu: [{ at: 12, mon: m("Pikachu", 25) }, { at: 30, mon: m("Raichu", 26) }],
  Elekid: [{ at: 30, mon: m("Electabuzz", 125) }, { at: 50, mon: m("Electivire", 466) }],
  Budew: [{ at: 12, mon: m("Roselia", 315) }, { at: 32, mon: m("Roserade", 407) }],
  Swinub: [{ at: 33, mon: m("Piloswine", 221) }, { at: 50, mon: m("Mamoswine", 473) }],
  Spheal: [{ at: 32, mon: m("Sealeo", 364) }, { at: 44, mon: m("Walrein", 365) }],
  Vanillite: [{ at: 35, mon: m("Vanillish", 583) }, { at: 47, mon: m("Vanilluxe", 584) }],
  "Nidoran♀": [{ at: 16, mon: m("Nidorina", 30) }, { at: 36, mon: m("Nidoqueen", 31) }],
  "Nidoran♂": [{ at: 16, mon: m("Nidorino", 33) }, { at: 36, mon: m("Nidoking", 34) }],
  Zubat: [{ at: 22, mon: m("Golbat", 42) }, { at: 40, mon: m("Crobat", 169) }],
  Rhyhorn: [{ at: 42, mon: m("Rhydon", 112) }, { at: 55, mon: m("Rhyperior", 464) }],
  Trapinch: [{ at: 35, mon: m("Vibrava", 329) }, { at: 45, mon: m("Flygon", 330) }],
  Sandile: [{ at: 29, mon: m("Krokorok", 552) }, { at: 40, mon: m("Krookodile", 553) }],
  Gothita: [{ at: 32, mon: m("Gothorita", 575) }, { at: 41, mon: m("Gothitelle", 576) }],
  Litwick: [{ at: 41, mon: m("Lampent", 608) }, { at: 50, mon: m("Chandelure", 609) }],
  Duskull: [{ at: 37, mon: m("Dusclops", 356) }, { at: 50, mon: m("Dusknoir", 477) }],
  Togepi: [{ at: 15, mon: m("Togetic", 176) }, { at: 40, mon: m("Togekiss", 468) }],
  Cleffa: [{ at: 12, mon: m("Clefairy", 35) }, { at: 32, mon: m("Clefable", 36) }],
  Igglybuff: [{ at: 12, mon: m("Jigglypuff", 39) }, { at: 32, mon: m("Wigglytuff", 40) }],
  Azurill: [{ at: 12, mon: m("Marill", 183) }, { at: 18, mon: m("Azumarill", 184) }],
  Slakoth: [{ at: 18, mon: m("Vigoroth", 288) }, { at: 36, mon: m("Slaking", 289) }],
  Happiny: [{ at: 15, mon: m("Chansey", 113) }, { at: 40, mon: m("Blissey", 242) }],
  Magby: [{ at: 30, mon: m("Magmar", 126) }, { at: 50, mon: m("Magmortar", 467) }],
};
/** A form's base (Alakazam → Abra); a base or a Pokémon without a line is its own. */
export function baseOf(name: string): string {
  for (const [base, line] of Object.entries(EVOLUTIONS)) if (line.some((e) => e.mon.name === name)) return base;
  return name;
}
for (const line of Object.values(EVOLUTIONS)) for (const e of line) BY_NAME.set(e.mon.name, e.mon);
/** Every Pokémon name the orchestrator can show, evolutions included (the leak test checks none appears with the setting off). */
export const allMonNames = (): string[] => [...BY_NAME.keys()];

/** Which form of its line a Pokémon is at a level: 0 for the base, 1 and 2 for its evolutions. */
export function stageAt(base: string | null | undefined, level: number): number {
  return (EVOLUTIONS[base ?? ""] ?? []).filter((e) => level >= e.at).length;
}

/**
 * A stage kept through a change of Pokémon (2026-11-16, the type families): the stage it had and its level then.
 * Up to that level it shows exactly that stage; past it never less, so it evolves on at its new line's levels.
 */
export interface StagePin {
  stage: number;
  level: number;
}

/** The stage a Pokémon shows at a level: its line's, or the one it keeps (0 for a name with no line). */
export function shownStage(base: string | null | undefined, level: number, pin: StagePin | null = null): number {
  const line = EVOLUTIONS[base ?? ""] ?? [];
  const byLevel = stageAt(base, level);
  return Math.min(line.length, pin ? (level <= pin.level ? pin.stage : Math.max(pin.stage, byLevel)) : byLevel);
}

/** The form a Pokémon has at a level: its base, or the last evolution it has reached (or is pinned to). */
export function formAt(base: string | null | undefined, level: number, pin: StagePin | null = null): Mon | null {
  const b = monByName(base);
  if (!b) return null;
  const stage = shownStage(b.name, level, pin);
  return stage ? EVOLUTIONS[b.name]![stage - 1]!.mon : b;
}
