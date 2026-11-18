// The personas hook (2026-11-18): with the pokemon setting on, an optional JSON pack gives the CoS, the Steward and the
// leads a persona (a name, a title and an image) instead of a Pokémon of their own. Threads stay Pokémon and draw first
// from their lead's persona's lines. The plugin ships no persona: a pack lives outside it, at the absolute path the
// personaPack setting names, and this file only reads and checks one. Everything here is generic; the names in the
// tests are made up.
//
// A pack:
//   {
//     "version": 1,
//     "note": "free text: sources, credits, notices (never shown)",
//     "personas": { "<id>": { "name": "…", "title": "…", "image": "https://…", "credit": "…",
//                             "team": ["display-only names for a profile card"], "roster": ["<line>", …] } },
//     "roles": { "cos": "<id>", "steward": "<id>" },
//     "byType": { "<type>": ["<id>", …] },          // a lead's persona by its project's Pokémon type, first free one
//     "byProject": { "<project slug>": "<id>" },     // the owner's overrides, before byType
//     "fallback": "<id>",                            // when byType has no free one
//     "lines": { "<base>": { "dex": 1, "types": ["water"], "evolutions": [{ "at": 30, "name": "…", "dex": 2 }] } }
//   }
// `roster`: the lines its threads take first, the signature line first. Each is one of mons.ts's lines or the pack's,
// and evolves at least once. The CoS's and the Steward's partner is the Pokémon they already have.
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { builtInEvolutions, builtInMon, TYPES, type MonType, type PackLine } from "./mons.ts";

const MAX_DEX = 649; // the last Pokémon with an animated sprite (mons.ts monSprite)
const MAX_BYTES = 1_000_000;

const oneLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s === s.trim() && !/[\u0000-\u001f\u007f]/.test(s), "one line of text, no leading or trailing space");
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "an id: lower-case letters, digits and dashes");
const dex = z.number().int().min(1).max(MAX_DEX);
// The image goes into a CSS url() and an <img>: https only, and nothing that could end the url() early.
const image = z
  .string()
  .max(500)
  .regex(/^https:\/\/[^\s"'()\\<>]+$/, "an https URL with no spaces, quotes, parentheses or backslashes")
  .refine((s) => URL.canParse(s), "an https URL");

const personaSchema = z.strictObject({
  name: oneLine(40),
  title: oneLine(40),
  image,
  credit: oneLine(200).optional(),
  team: z.array(oneLine(40)).max(12).optional(),
  roster: z.array(oneLine(40)).max(12).optional(),
});
const lineSchema = z.strictObject({
  dex,
  types: z.array(z.enum(TYPES.map((t) => t.type) as [MonType, ...MonType[]])).max(3).optional(),
  evolutions: z.array(z.strictObject({ at: z.number().int().min(1).max(100), name: oneLine(40), dex })).min(1).max(2),
});
const packSchema = z.strictObject({
  version: z.literal(1).optional(),
  note: z.string().max(10_000).optional(),
  personas: z.record(id, personaSchema).refine((r) => Object.keys(r).length > 0, "at least one persona"),
  roles: z.strictObject({ cos: id.optional(), steward: id.optional() }).optional(),
  byType: z.strictObject(Object.fromEntries(TYPES.map((t) => [t.type, z.array(id).max(20).optional()]))).optional(),
  byProject: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "a project slug"), id).optional(),
  fallback: id,
  lines: z.record(oneLine(40), lineSchema).optional(),
});

export interface Persona {
  name: string;
  title: string;
  image: string;
  credit?: string;
  team?: string[];
  roster?: string[];
}
export interface PersonaPack {
  version?: 1;
  note?: string;
  personas: Record<string, Persona>;
  roles?: { cos?: string; steward?: string };
  byType?: Partial<Record<MonType, string[]>>;
  byProject?: Record<string, string>;
  fallback: string;
  lines?: Record<string, PackLine>;
}

/** A pack that failed its checks: every problem, each with where in the pack it is. */
export class PackError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`personas pack: ${problems.length} problem${problems.length === 1 ? "" : "s"}: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

const where = (path: readonly PropertyKey[]) => path.map((p, i) => (typeof p === "number" ? `[${p}]` : `${i ? "." : ""}${String(p)}`)).join("") || "(the pack)";

/** Check a parsed JSON value as a pack; throws a PackError naming every problem. */
export function parsePersonaPack(json: unknown): PersonaPack {
  const r = packSchema.safeParse(json);
  if (!r.success) throw new PackError(r.error.issues.map((i) => `${where(i.path)}: ${i.message}`));
  const pack = r.data as PersonaPack;
  const problems: string[] = [];
  const known = (at: string, x: string | undefined) => {
    if (x !== undefined && !pack.personas[x]) problems.push(`${at}: no persona "${x}"`);
  };
  known("roles.cos", pack.roles?.cos);
  known("roles.steward", pack.roles?.steward);
  known("fallback", pack.fallback);
  for (const [t, ids] of Object.entries(pack.byType ?? {})) ids?.forEach((x, i) => known(`byType.${t}[${i}]`, x));
  for (const [slug, x] of Object.entries(pack.byProject ?? {})) known(`byProject.${slug}`, x);

  // the pack's own lines: new names only, unless one is exactly mons.ts's line of that name
  const lines = pack.lines ?? {};
  const owner = new Map<string, string>(); // a pack name → the pack line it belongs to
  for (const [base, l] of Object.entries(lines)) {
    const forms = l.evolutions.map((e) => e.name);
    const mine = builtInEvolutions(base);
    if (builtInMon(base)) {
      if (!mine || mine.map((e) => e.mon.name).join() !== forms.join())
        problems.push(`lines.${base}: mons.ts already has ${base}${mine ? ` (${[base, ...mine.map((e) => e.mon.name)].join(" → ")})` : ""}; a pack can't give it another line`);
      continue;
    }
    l.evolutions.forEach((e, i) => {
      if (builtInMon(e.name)) problems.push(`lines.${base}.evolutions[${i}]: ${e.name} is already a Pokémon of mons.ts`);
      if (i && e.at <= l.evolutions[i - 1]!.at) problems.push(`lines.${base}.evolutions[${i}]: evolves at ${e.at}, not after the form before it`);
    });
    for (const n of [base, ...forms]) {
      if (owner.has(n) || (n !== base && lines[n])) problems.push(`lines.${base}: ${n} is in another pack line too`);
      owner.set(n, base);
    }
  }
  // a roster takes lines that can be threads: they evolve, and every form has an animated sprite
  const threadLine = (n: string) => !!lines[n] || (!!builtInEvolutions(n)?.length && (builtInMon(n)?.dex ?? Infinity) <= MAX_DEX);
  for (const [pid, p] of Object.entries(pack.personas)) {
    p.roster?.forEach((n, i) => {
      if (!threadLine(n)) problems.push(`personas.${pid}.roster[${i}]: ${n} is not a line a thread can take (one that evolves, of mons.ts or this pack)`);
      if (p.roster!.indexOf(n) !== i) problems.push(`personas.${pid}.roster[${i}]: ${n} is listed twice`);
    });
  }
  if (problems.length) throw new PackError(problems);
  return pack;
}

/** Read and check the pack at an absolute path; throws with what is wrong (a PackError for its content). */
export function readPersonaPack(path: string): PersonaPack {
  if (!isAbsolute(path)) throw new PackError([`the pack path must be absolute, not ${JSON.stringify(path)}`]);
  const size = statSync(path).size;
  if (size > MAX_BYTES) throw new PackError([`the pack is ${size} bytes; the most is ${MAX_BYTES}`]);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new PackError([`not JSON: ${e instanceof Error ? e.message : String(e)}`]);
  }
  return parsePersonaPack(json);
}

/**
 * Each live lead's persona id, by its project (scope §2's runtime rule), leads in the order they started: a project's
 * byProject entry, else the first of its type's byType list that no other lead and neither the CoS nor the Steward
 * holds, else the fallback (which may be shared). byProject entries are claimed before any byType pick.
 */
export function assignPersonas(pack: PersonaPack, leads: readonly { project: string; type: MonType | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  const held = new Set([pack.roles?.cos, pack.roles?.steward].filter((x): x is string => !!x));
  for (const l of leads) {
    const x = pack.byProject?.[l.project];
    if (x) {
      out.set(l.project, x);
      held.add(x);
    }
  }
  for (const l of leads) {
    if (out.has(l.project)) continue;
    const x = (l.type ? (pack.byType?.[l.type] ?? []) : []).find((p) => !held.has(p)) ?? pack.fallback;
    out.set(l.project, x);
    held.add(x);
  }
  return out;
}

/** What the agents RPC carries for an agent with a persona: the persona, and for the CoS and the Steward their partner. */
export interface AgentPersona {
  name: string;
  title: string;
  image: string;
  credit: string | null;
  team: string[];
  /** The CoS's and the Steward's own Pokémon (its form now); null for a lead, whose threads are its Pokémon. */
  partner: string | null;
}
export const agentPersona = (p: Persona, partner: string | null): AgentPersona => ({ name: p.name, title: p.title, image: p.image, credit: p.credit ?? null, team: [...(p.team ?? [])], partner });

/** The persona's sentence at the top of a brief: "You are Warden Tamsin. ", with the partner for the CoS and the Steward. */
export const personaSentence = (p: { name: string; title: string; partner: string | null }): string => `You are ${p.title} ${p.name}${p.partner ? `; your partner is ${p.partner}` : ""}. `;
