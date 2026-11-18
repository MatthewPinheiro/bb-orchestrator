// Who an agent looks like (2026-11-18, the personas hook's look): a Pokémon, as before, or with the pokemon setting on
// and a personas pack loaded, a person. The CoS and the Steward are a person with their Pokémon as partner (a pair), a
// lead is its person alone, and threads stay Pokémon. A pack's own lines are unknown to the browser's mons.ts, so their
// sprite's number comes from the server with the name. No JSX here, so node --test checks it; app/face.tsx draws it.
// Off means off: with the setting off the server sends no Pokémon and no persona, and every helper here gives what the
// screens showed before the hook (test/faces.test.ts).
import type { AgentPersona, Agents } from "../contract.ts";
import { isShiny, monByName, monSprite, type Mon } from "../mons.ts";

type Agent = Agents[number];

/**
 * The Pokémon to draw for a name: mons.ts's, else a personas pack's line, by the National Dex number the server sends
 * with it (the agents RPC's formDex, the board's dex). Null: nothing to draw (the setting off, or an unknown name).
 */
export const spriteMon = (name: string | null | undefined, dex?: number | null): Mon | null =>
  monByName(name) ?? (name && dex && Number.isInteger(dex) && dex > 0 ? { name, dex } : null);

/** "Pilot Vesna": the title, then the name. */
export const personaName = (p: Pick<AgentPersona, "name" | "title">): string => `${p.title} ${p.name}`;

/** The pair's one accessible name: "Warden Tamsin with Chansey" (the person alone without a partner). */
export const pairLabel = (p: Pick<AgentPersona, "name" | "title" | "partner">): string => (p.partner ? `${personaName(p)} with ${p.partner}` : personaName(p));

/**
 * The name on an agent's sidebar line, after its role chip and Lv: its Pokémon's, or with a personas pack its person's
 * alone. The title and the partner are in the profile card (and the pair's sprite shows the partner): with them the line
 * was cut off at the sidebar's default width (2026-11-18).
 */
export const rowName = (a: Pick<Agent, "persona" | "mon" | "form" | "formDex">): string | null => a.persona?.name ?? spriteMon(a.form ?? a.mon, a.formDex)?.name ?? null;

/** The party (scope §4): six slots, as in the games. */
export const PARTY_SIZE = 6;

/** A thread's number in its address (thread:<slug>:<n>): the higher, the more recently it started. */
const threadNo = (address: string): number => Number(address.split(":")[2]) || 0;

/**
 * A lead's party: its project's live threads that have a Pokémon. With a personas pack (2026-11-18), the threads on its
 * persona's roster lines come first, in roster order (`roster`, the base names); then the rest, the most recent first.
 * The first six show, the rest are "in the box". Empty with the setting off (no thread has a Pokémon).
 */
export function partyOf<T extends Pick<Agent, "address" | "role" | "project" | "engineStatus" | "form" | "mon">>(agents: readonly T[], project: string, roster: readonly string[] = []): { shown: T[]; boxed: number } {
  const at = (a: T) => (a.mon && roster.includes(a.mon) ? roster.indexOf(a.mon) : roster.length);
  const live = agents
    .filter((a) => a.role === "thread" && a.project === project && a.engineStatus !== "archived" && (a.form ?? a.mon))
    .sort((a, b) => at(a) - at(b) || threadNo(b.address) - threadNo(a.address));
  return { shown: live.slice(0, PARTY_SIZE), boxed: Math.max(0, live.length - PARTY_SIZE) };
}

/** "+2 in the box", or nothing. */
export const boxedText = (n: number): string | null => (n > 0 ? `+${n} in the box` : null);

/**
 * The sidebar's row icons (requested 2026-11-13: "move the sprites to the claude icons"). bb has no per-thread row icon
 * slot, so one stylesheet swaps the provider mark of each role agent's row (found by its thread link's
 * data-sidebar-thread-id) for its picture. Rows of threads that aren't role agents keep bb's own icon.
 * - A Pokémon: its animated sprite, as before (a pack's line by its formDex).
 * - A lead with a persona: the person's image, one background.
 * - The CoS and the Steward with a persona: two backgrounds, the person and, over its bottom-right corner, the partner.
 * With the setting off nothing has a Pokémon or a persona, so there are no rules.
 */
export function rowIconCss(agents: Iterable<Pick<Agent, "threadId" | "role" | "mon" | "form" | "formDex" | "persona">>): string[] {
  const out: string[] = [];
  for (const a of agents) {
    if (!/^[\w-]+$/.test(a.threadId)) continue;
    const p = a.persona ?? null;
    const m = spriteMon(a.form ?? a.mon, a.formDex);
    const partner = p?.partner ? spriteMon(p.partner, a.formDex) : null;
    // the person's image is checked by the server (personas.ts: https, nothing that ends a url() early); checked again
    const image = p && /^https:\/\/[^\s"'()\\<>]+$/.test(p.image) ? p.image : null;
    if (!image && !m) continue;
    // the standing agents and leads stand out; their threads stay smaller. The icon sits on the title line: moved down to
    // the middle of the two-line row, or its top is cut off by the row above, and kept clear of the sidebar's left edge
    const px = a.role === "thread" ? 30 : 38;
    // the exact chain bb draws (link, then its title span, then the icon): a looser match leaks into a neighbour row
    const row = `a[data-sidebar-thread-id="${a.threadId}"] + span > span > [data-sidebar-thread-provider]`;
    const box = `width: ${px}px; height: ${px}px; margin: -${(px - 16) / 2}px 4px -${(px - 16) / 2}px -${px - 30}px; position: relative; top: 9px;`;
    const bg = image
      ? partner
        ? `background: url("${monSprite(partner, true, isShiny(a.role))}") right bottom / 60% no-repeat, url("${image}") left top / 85% no-repeat;`
        : `background: url("${image}") center / contain no-repeat;`
      : `background: url("${monSprite(m!, true, isShiny(a.role))}") center / contain no-repeat;`;
    out.push(`${row} > * { display: none !important; }`, `${row} { ${box} ${bg} image-rendering: pixelated; }`);
  }
  return out;
}
