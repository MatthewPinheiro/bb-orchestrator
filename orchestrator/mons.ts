// Each role agent's Pokémon (2026-11-13): the CoS is Rayquaza, the Steward Regigigas, leads start as the base
// form of a strong line and threads as early-route ones; both evolve as they level. Assigned at registration and kept for the address's life. Only names and
// National Dex numbers live here: the sprites load at runtime from PokeAPI's public sprite repo, never bundled.

export interface Mon {
  name: string;
  dex: number;
}

const m = (name: string, dex: number): Mon => ({ name, dex });

export const MON_POOLS: Record<"cos" | "steward" | "lead" | "thread", readonly Mon[]> = {
  cos: [m("Rayquaza", 384)],
  steward: [m("Regigigas", 486)],
  // Requested 2026-11-13: "leads should be able to evolve as well, start leads at their base form". Each is the first
  // stage of a pseudo-legendary-class line; 10 leads live at once, so enough that no two share one.
  lead: [m("Bagon", 371), m("Gible", 443), m("Larvitar", 246), m("Beldum", 374), m("Dratini", 147), m("Deino", 633),
    m("Magikarp", 129), m("Riolu", 447), m("Scyther", 123), m("Larvesta", 636), m("Axew", 610), m("Gastly", 92)],
  // Requested 2026-11-13: every thread is a three-stage line, and enough of them that no two live threads share one
  // (20+ threads can be live at once). All have animated sprites (dex <= 649).
  thread: [
    m("Caterpie", 10), m("Starly", 396), m("Weedle", 13), m("Wurmple", 265), m("Pidgey", 16), m("Lillipup", 506),
    m("Bulbasaur", 1), m("Charmander", 4), m("Squirtle", 7), m("Chikorita", 152), m("Cyndaquil", 155), m("Totodile", 158),
    m("Treecko", 252), m("Torchic", 255), m("Mudkip", 258), m("Turtwig", 387), m("Chimchar", 390), m("Piplup", 393),
    m("Snivy", 495), m("Tepig", 498), m("Oshawott", 501), m("Mareep", 179), m("Poliwag", 60), m("Oddish", 43),
    m("Bellsprout", 69), m("Geodude", 74), m("Machop", 66), m("Hoppip", 187), m("Pidove", 519), m("Sewaddle", 540),
    m("Roggenrola", 524), m("Timburr", 532), m("Tympole", 535), m("Whismur", 293), m("Seedot", 273), m("Lotad", 270),
  ],
};
/** Thread Pokémon from before the pool was three-stage only: still named on old rows, never picked again. */
const RETIRED_THREAD_MONS: readonly Mon[] = [m("Bidoof", 399), m("Zigzagoon", 263), m("Rattata", 19), m("Sentret", 161), m("Patrat", 504), m("Kricketot", 401)];

/**
 * Requested 2026-11-13: a lead's Pokémon matches its project's kind of work ("a PR review lead should be a smart type").
 * Each kind lists strong Pokémon of the fitting type, best first; a project matches a kind by its slug's words.
 */
export const LEAD_KINDS: readonly { kind: string; why: string; words: readonly string[]; mons: readonly Mon[] }[] = [
  // each is a base form; the "why" names the form it grows into
  { kind: "review", why: "Psychic: grows into Alakazam, the genius reviewer", words: ["review", "reviews", "pr", "prs", "audit"], mons: [m("Abra", 63), m("Ralts", 280), m("Eevee", 133)] },
  { kind: "ai", why: "Psychic/Steel: grows into Metagross, whose four brains are a supercomputer", words: ["classifier", "llm", "llms", "ai", "model", "models", "benchmark", "benchmarks", "ml", "harness", "agent", "agents"], mons: [m("Beldum", 374), m("Solosis", 577), m("Staryu", 120)] },
  { kind: "bugs", why: "Bug: it takes one to catch one", words: ["bug", "bugs", "debug", "incident", "investigation", "healing"], mons: [m("Scyther", 123), m("Venipede", 543), m("Larvesta", 636)] },
  { kind: "deploy", why: "Grows into Dragonite, who delivers the mail: shipping", words: ["deploy", "deployment", "release", "ci", "cd", "continuous", "ship"], mons: [m("Dratini", 147), m("Bagon", 371)] },
  { kind: "storage", why: "Ground/Steel diggers for file systems and infra", words: ["file", "system", "microvm", "vm", "storage", "infra", "cloud", "gateway"], mons: [m("Drilbur", 529), m("Onix", 95), m("Aron", 304)] },
  { kind: "qa", why: "Riolu grows into Lucario, who senses the aura of hidden flaws", words: ["qa", "test", "tests", "testing", "runners"], mons: [m("Riolu", 447), m("Shinx", 403)] },
  { kind: "factory", why: "Steel/Electric industry: Magnemite grows into Magnezone, Klink is gears", words: ["factory", "automation", "pipeline", "self", "improvement", "software"], mons: [m("Magnemite", 81), m("Klink", 599)] },
  { kind: "devx", why: "Porygon was built by programmers", words: ["dev", "dx", "experience", "tooling", "sdk", "upgrades"], mons: [m("Porygon", 137), m("Joltik", 595)] },
  { kind: "team", why: "Gible grows into Garchomp, the Champion's ace, who leads the team", words: ["team", "management", "people", "playbook", "workflow"], mons: [m("Gible", 443), m("Larvitar", 246)] },
  { kind: "field", why: "Bagon grows into Salamence and flies out to where the customer is", words: ["fde", "field", "customer", "forward", "desk"], mons: [m("Bagon", 371), m("Magikarp", 129)] },
];

/** The lead kinds a project slug matches, best first (most matching words). */
export function leadKinds(project: string): typeof LEAD_KINDS {
  const words = project.toLowerCase().split(/[^a-z0-9]+/);
  return LEAD_KINDS.map((k) => ({ k, n: k.words.filter((w) => words.includes(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.k);
}

const BY_NAME = new Map([...Object.values(MON_POOLS).flat(), ...RETIRED_THREAD_MONS, ...LEAD_KINDS.flatMap((k) => k.mons)].map((x) => [x.name, x]));
export const monByName = (name: string | null | undefined): Mon | null => (name ? (BY_NAME.get(name) ?? null) : null);

/**
 * The first of the role's pool that no live agent holds; when all are taken, cycle by how many are live. A lead first
 * tries the Pokémon matching its project's kind of work (LEAD_KINDS), then the general pool.
 */
export function pickMon(role: keyof typeof MON_POOLS, taken: readonly string[], project: string | null = null): Mon {
  if (role === "lead" && project) {
    const fit = leadKinds(project).flatMap((k) => k.mons).find((x) => !taken.includes(x.name));
    if (fit) return fit;
  }
  const pool = MON_POOLS[role];
  return pool.find((x) => !taken.includes(x.name)) ?? pool[taken.length % pool.length]!;
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
};
/** A form's base (Alakazam → Abra); a base or a Pokémon without a line is its own. */
export function baseOf(name: string): string {
  for (const [base, line] of Object.entries(EVOLUTIONS)) if (line.some((e) => e.mon.name === name)) return base;
  return name;
}
for (const line of Object.values(EVOLUTIONS)) for (const e of line) BY_NAME.set(e.mon.name, e.mon);
/** Every Pokémon name the orchestrator can show, evolutions included (the leak test checks none appears with the setting off). */
export const allMonNames = (): string[] => [...BY_NAME.keys()];

/** The form a Pokémon has at a level: its base, or the last evolution it has reached. */
export function formAt(base: string | null | undefined, level: number): Mon | null {
  const b = monByName(base);
  if (!b) return null;
  let form = b;
  for (const e of EVOLUTIONS[b.name] ?? []) if (level >= e.at) form = e.mon;
  return form;
}
