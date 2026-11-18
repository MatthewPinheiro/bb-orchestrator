// The faces, rendered (2026-11-18): app/ui's Avatar sprite variant, AvatarPair and AvatarGroup, and app/face.tsx, which
// every screen draws an agent with. What matters: a person and a pack's Pokémon show (never the neutral placeholder
// while a pack applies), the pair is one image with one name, the party stops at six, and with the setting off no
// persona or Pokémon reaches the markup even with a pack loaded.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createElement as h, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { readPersonaPack } from "../personas.ts";
import { monByName, monSprite, tokensForLevel } from "../mons.ts";
import { cleanTsx, importTsx } from "./tsx-render.ts";

after(cleanTsx);

type Any = ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ui = await importTsx<Record<string, Any>>("app/ui/avatar.tsx");
const face = await importTsx<Record<string, Any>>("app/face.tsx");
const html = (c: Any, props: Record<string, unknown>, ...kids: unknown[]) => renderToStaticMarkup(h(c, props, ...(kids as never[])));
const imgs = (s: string) => [...s.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]);

const vesna = { name: "Vesna", title: "Pilot", image: "https://personas.example.test/vesna.png", credit: "drawn by a made-up artist", team: ["Milotic", "Spiritomb"], partner: null };
const orrin = { name: "Orrin", title: "Harbormaster", image: "https://personas.example.test/orrin.png", credit: null, team: [], partner: "Rayquaza" };

test("the sprite variant draws pixel art whole: no round crop, no fill, contained and pixelated, bobbing only with motion allowed", () => {
  const s = html(ui.Avatar!, { variant: "sprite", size: "32" }, h("img", { src: "https://personas.example.test/vesna.png", alt: "" }));
  assert.match(s, /data-variant="sprite"/);
  for (const c of ["data-[variant=sprite]:rounded-none", "data-[variant=sprite]:bg-transparent", "data-[variant=sprite]:overflow-visible", "data-[variant=sprite]:[&amp;_img]:object-contain", "data-[variant=sprite]:[&amp;_img]:[image-rendering:pixelated]", "motion-safe:data-[variant=sprite]"])
    assert.ok(s.includes(c), c);
});

test("AvatarPair is one image with one name; the partner is decoration at 60% in a halo of the page's background", () => {
  const s = html(ui.AvatarPair!, { size: "32", "aria-label": "Harbormaster Orrin with Rayquaza" }, h(ui.Avatar!, { variant: "sprite", key: "a" }), h(ui.AvatarPairPartner!, { key: "b" }, h(ui.Avatar!, { variant: "sprite" })));
  assert.match(s, /<span role="img" data-slot="avatar-pair" data-size="32" class="[^"]*\bh-8 w-10\b[^"]*" aria-label="Harbormaster Orrin with Rayquaza">/, "a quarter wider than the person, so the partner covers no neighbour");
  assert.match(s, /data-slot="avatar-pair-partner" aria-hidden="true" class="[^"]*\babsolute right-0 bottom-0\b[^"]*\bh-3\/5\b/);
  assert.match(s, /drop-shadow\(1px_0_0_var\(--background\)\)/, "the halo is the theme's background, not a colour of its own");
});

test("AvatarGroup gives sprites the halo in place of the ring (a ring would draw their transparent box)", () => {
  const s = html(ui.AvatarGroup!, {}, h(ui.Avatar!, { variant: "sprite", key: 1 }));
  assert.ok(s.includes("*:data-[variant=sprite]:ring-0"));
  assert.ok(s.includes("*:data-[variant=sprite]:[filter:drop-shadow(1px_0_0_var(--background))"));
  assert.ok(s.includes("*:data-[slot=avatar]:ring-2"), "round avatars keep shadcn's ring");
});

test("AgentFace: without a persona it is the Pokémon, as before; a pack's line by its dex", () => {
  const mon = html(face.AgentFace!, { face: { mon: "Gible" }, address: "thread:p:1" });
  assert.deepEqual(imgs(mon), [`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/443.gif`]);
  const pack = html(face.AgentFace!, { face: { mon: "Feebas", dex: 349 }, address: "thread:p:2" });
  assert.match(imgs(pack)[0] ?? "", /\/animated\/349\.gif$/, "a pack line draws its sprite, not the neutral letter");
  assert.doesNotMatch(pack, /data-slot="avatar-fallback"/);
});

test("AgentFace: a lead with a persona is its person alone; the CoS with one is the pair", () => {
  const lead = html(face.AgentFace!, { face: { mon: null, persona: vesna }, address: "lead:p" });
  assert.deepEqual(imgs(lead), [vesna.image]);
  assert.match(lead, /alt="Pilot Vesna"/);
  assert.doesNotMatch(lead, /avatar-pair/, "a lead has no partner");
  const cos = html(face.AgentFace!, { face: { mon: "Rayquaza", persona: orrin }, address: "cos" });
  assert.match(cos, /role="img" data-slot="avatar-pair"[^>]*aria-label="Harbormaster Orrin with Rayquaza"/);
  assert.equal(imgs(cos)[0], orrin.image, "the person first");
  assert.match(imgs(cos)[1] ?? "", /\/animated\/shiny\/384\.gif$/, "then its shiny partner");
});

test("AgentFace with nothing (the setting off): the role's letter, no picture", () => {
  const s = html(face.AgentFace!, { face: { mon: null, persona: null }, address: "lead:p" });
  assert.deepEqual(imgs(s), []);
  assert.match(s, /data-slot="avatar-fallback"[^>]*>L</);
});

test("the party draws at most six, then '+N in the box', and nothing when there is no party", () => {
  const shown = [1, 2, 3, 4, 5, 6].map((n) => ({ address: `thread:p:${n}`, mon: "Gible", form: "Gible", formDex: 443 }));
  const s = html(face.Party!, { shown, boxed: 2 });
  assert.equal(imgs(s).length, 6);
  assert.match(s, />\+2 in the box</);
  assert.match(s, /aria-label="Party: Gible, Gible, Gible, Gible, Gible, Gible, and 2 more in the box"/);
  assert.equal(html(face.Party!, { shown: [], boxed: 0 }), "");
});

test("the profile card: the person and its level, its role and project, the party, the team from the games and the credit", () => {
  const s = html(face.ProfileCard!, { persona: vesna, address: "lead:p", project: "p", level: 33, party: { shown: [{ address: "thread:p:1", mon: "Feebas", form: "Feebas", formDex: 349 }], boxed: 0 } });
  for (const t of ["Pilot Vesna", ">Lv 33<", "Lead · p", "Team: Milotic, Spiritomb", "drawn by a made-up artist"]) assert.ok(s.includes(t), t);
  assert.match(s, /data-party="1"/);
  assert.match(s, /data-slot="card"/, "the shared Card");
  const cos = html(face.ProfileCard!, { persona: orrin, address: "cos", project: null, level: 38 });
  assert.ok(cos.includes("Chief of Staff · partner Rayquaza"), "the CoS's card names its partner");
  assert.match(cos, /data-slot="avatar-pair"/);
});

test("the profile card's team row: each member's sprite in its own form by the pack's dex, repeats kept, before the threads", () => {
  // the owner saw the team only as text, next to a party of unrelated Pokémon (2026-11-18)
  const lead = { ...vesna, team: ["Garchomp", "Dragapult", "Garchomp", "Spiritomb", "Nobody"], teamDex: [445, 887, 445, 442, null] };
  const s = html(face.ProfileCard!, { persona: lead, address: "lead:p", project: "p", level: 33, party: { shown: [{ address: "thread:p:1", mon: "Gible", form: "Gabite", formDex: 444 }], boxed: 3 } });
  const team = s.slice(s.indexOf("data-profile-team"), s.indexOf("data-profile-threads"));
  assert.ok(team && s.indexOf("data-profile-team") < s.indexOf("data-profile-threads"), "the team row first, then the threads");
  assert.deepEqual(imgs(team), [
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/445.gif",
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/887.png",
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/445.gif",
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/442.gif",
  ], "Garchomp, not Gible; past 649 the still sprite; never shiny; a member with no number draws no image");
  assert.match(team, /data-team-member="Nobody"[^>]*>.*?data-slot="avatar-fallback"[^>]*>N</, "…but its initial");
  assert.match(team, /role="img" aria-label="Team: Garchomp, Dragapult, Garchomp, Spiritomb, Nobody"/);
  assert.match(team, /title="Dragapult"/, "the name on hover");
  assert.match(s, /data-profile-threads=""[^>]*>.*?>Threads</, "the party is labelled, so the rows can't be confused");
  assert.match(s, />\+3 in the box</);
  assert.doesNotMatch(team, /shiny/);
  const old = html(face.ProfileCard!, { persona: { ...vesna, team: ["Gible"] }, address: "lead:p", project: "p", level: 1 });
  assert.deepEqual(imgs(old), [vesna.image, "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/443.gif"], "an older server without teamDex: mons.ts's number");
  assert.doesNotMatch(html(face.ProfileCard!, { persona: { ...vesna, team: [], credit: null }, address: "steward", project: null, level: 1 }), /data-profile-team/, "no team: no row");
});

test("the standing bar: without a persona exactly its label; with one, the pair and a name that opens the profile card", () => {
  assert.equal(html(face.StandingFace!, { face: { mon: "Rayquaza" }, address: "cos", label: "Chief of Staff", level: 3 }), "Chief of Staff", "on without a pack: as before");
  assert.equal(html(face.StandingFace!, { face: undefined, address: "steward", label: "Steward", level: null }), "Steward", "no agent yet: as before");
  const s = html(face.StandingFace!, { face: { mon: "Rayquaza", persona: orrin }, address: "cos", label: "Chief of Staff", level: 3 });
  assert.match(s, /aria-label="Harbormaster Orrin with Rayquaza"/);
  assert.match(s, /aria-haspopup="dialog"[^>]*data-profile-open="cos"|data-profile-open="cos"[^>]*aria-haspopup="dialog"/);
  assert.doesNotMatch(s, /data-profile-card/, "the card opens in a Popover: closed, nothing on the page");
});

// ---- off means off, through a real engine: what the board and the agents RPC carry, drawn by every face
const PACK = readPersonaPack(join(import.meta.dirname, "fixtures", "personas-pack.json"));
// the team row too (2026-11-18): each member's name and both of its sprites
const TEAM = Object.values(PACK.personas).flatMap((p) => p.team ?? []).map((m) => (typeof m === "string" ? { name: m, dex: monByName(m)?.dex ?? 0 } : m));
const TERMS = [...Object.values(PACK.personas).flatMap((p) => [p.name, p.title, p.image, p.credit ?? ""]), ...TEAM.flatMap((m) => [m.name, monSprite(m, true), monSprite(m, false)]), "Feebas", "Milotic"].filter(Boolean);

function faces(pokemon: boolean): string {
  const e = new Engine(new DatabaseSync(":memory:") as never, { now: () => Date.parse("2026-11-18T10:00:00Z"), deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} }, { pokemon, personas: PACK });
  e.register("T-cos", "cos", null);
  e.register("T-st", "steward", null);
  e.register("T-la", "lead", "code-reviews");
  for (const n of [1, 2, 3]) e.register(`T-w${n}`, "thread", "code-reviews", "T-la");
  e.gainXp("T-w1", tokensForLevel(40), 1);
  const assigned = e.personaAssignments();
  return e
    .agents()
    .map((a) => {
      const f = e.faceOf(a, assigned);
      const form = e.formOf(a, e.xpOf(a.address).level);
      return [
        html(face.AgentFace!, { face: { mon: a.mon, ...f }, address: a.address }),
        f.persona ? html(face.ProfileCard!, { persona: f.persona, address: a.address, project: a.project, level: 1 }) : "",
        html(face.StandingFace!, { face: { mon: a.mon, ...f }, address: a.address, label: "label", level: 1 }),
        html(face.Party!, { shown: a.role === "thread" && a.mon ? [{ address: a.address, mon: a.mon, form: form?.name ?? a.mon, formDex: form?.dex }] : [], boxed: 0 }),
      ].join("");
    })
    .join("\n");
}

test("on with the pack, the faces show the personas and the pack's line (so the leak check below can fail)", () => {
  const s = faces(true);
  assert.ok(s.includes("Pilot Vesna") && s.includes("https://personas.example.test/orrin.png"), "the people");
  assert.match(s, /\/animated\/349\.gif/, "the first thread took the pack's own line, and it is drawn");
  assert.match(s, /data-profile-open="cos"/, "the standing bar's name that opens the CoS's profile card");
  assert.match(s, /data-profile-card=/);
});

test("off with the pack loaded: no persona or pack Pokémon in any face, and no picture at all", () => {
  const s = faces(false);
  const hits = TERMS.filter((t) => s.includes(t));
  assert.deepEqual(hits, []);
  assert.deepEqual(imgs(s), [], "only the role letters");
  // the lead's ask (2026-11-18): off, no profile card and no popover, so the standing bar is exactly as before
  assert.doesNotMatch(s, /data-profile-open|data-profile-card|aria-haspopup/);
});
