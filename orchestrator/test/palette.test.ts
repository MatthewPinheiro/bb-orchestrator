// The colour code must stay readable: every role and kind colour, in both bb themes, against every surface it can sit
// on. Text (role addresses, pill words) needs 4.5:1 (WCAG AA), marks (dots, card stripes) 3:1. A palette edit that
// makes a colour unreadable for the owner in either theme fails here, not on their screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KIND_TONES, PR_CHIP_TONES, PRIORITY_TONES, ROLE_TONES, SLACK_TONES, TINT, kindOf, prKind, roleOf, ruleState } from "../app/palette.ts";
import { TYPES } from "../mons.ts";

type Rgb = [number, number, number]; // 0..255, gamma-encoded sRGB
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const enc = (y: number) => 255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055);
const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
/** `top` at `alpha` composited over `under` (how a translucent fill renders). */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((c, i) => c * alpha + under[i]! * (1 - alpha)) as Rgb;
/** An achromatic oklch(L 0 0) in sRGB: for a grey, linear r = g = b = L³. */
const grey = (l: number): Rgb => {
  const c = enc(l ** 3);
  return [c, c, c];
};

// Where the colours sit since the page is built from affectUI (app/affect): its card surface (card-clean #ffffff /
// #1b1b1e, decision-inbox and the avatar tile #ffffff / #1c1c1e; the lighter dark one is the stricter), bb's canvas
// around the cards (oklch 100% / 19.5%), and a card row under affectUI's wash (rgba(0,0,0,.03) / rgba(255,255,255,.04)),
// e.g. a hovered "waiting on an agent" row. The avatar tile is the card surface, so an agent's mark is checked there too.
const THEMES = {
  light: { card: hex("#ffffff"), canvas: grey(1), wash: { c: hex("#000000"), a: 0.03 } },
  dark: { card: hex("#1c1c1e"), canvas: grey(0.195), wash: { c: hex("#ffffff"), a: 0.04 } },
} as const;
const surfaces = (t: (typeof THEMES)[keyof typeof THEMES]) => ({ card: t.card, canvas: t.canvas, "washed row": over(t.wash.c, t.wash.a, t.card) });
/** A card row held by a write is drawn at opacity-80 (needs-you.tsx) over the inbox card: its mark, avatars and badges fade. */
const HELD = 0.8;

test("the contrast formula is the WCAG one (known pairs)", () => {
  assert.ok(contrast(hex("#767676"), hex("#ffffff")) >= 4.5, "#767676 on white is the classic 4.54:1 pass");
  assert.ok(contrast(hex("#777777"), hex("#ffffff")) < 4.5, "#777777 on white is the classic 4.48:1 fail");
  assert.equal(Math.round(contrast(hex("#000000"), hex("#ffffff"))), 21);
  assert.equal(grey(1).map(Math.round).join(), "255,255,255", "oklch(100% 0 0) is white");
});

const failures: string[] = [];
for (const [theme, t] of Object.entries(THEMES)) {
  for (const [where, surface] of Object.entries(surfaces(t))) {
    for (const [key, tone] of Object.entries(ROLE_TONES)) {
      // a role is an avatar mark (on its tile, the card) and its address in the colour, on the bare surface
      const c = hex(tone[theme as keyof typeof THEMES]);
      const r = contrast(c, surface);
      if (r < 4.5) failures.push(`role ${key} ${theme} on ${where}: text ${r.toFixed(2)} < 4.5`);
    }
    for (const [key, tone] of [...Object.entries(KIND_TONES), ...Object.entries(PRIORITY_TONES).map(([k, t]) => [`priority ${k}`, t] as const)]) {
      // a kind (or a project's priority) is an affectUI badge filled with its colour at TINT: the word and its dot sit on that fill
      const c = hex(tone[theme as keyof typeof THEMES]);
      const fill = over(c, TINT, surface);
      const text = contrast(c, fill);
      const mark = Math.min(contrast(c, fill), contrast(c, surface));
      if (text < 4.5) failures.push(`kind ${key} ${theme} on ${where}: text ${text.toFixed(2)} < 4.5`);
      if (mark < 3) failures.push(`kind ${key} ${theme} on ${where}: mark ${mark.toFixed(2)} < 3`);
    }
  }
}
for (const [theme, t] of Object.entries(THEMES)) {
  const fade = (h: string) => over(hex(h), HELD, t.card);
  for (const [key, tone] of Object.entries(ROLE_TONES)) {
    const r = contrast(fade(tone[theme as keyof typeof THEMES]), t.card); // an address on the held row
    if (r < 4.5) failures.push(`role ${key} ${theme} on a held card: text ${r.toFixed(2)} < 4.5`);
  }
  for (const [key, tone] of [...Object.entries(KIND_TONES), ...Object.entries(PRIORITY_TONES).map(([k, t]) => [`priority ${k}`, t] as const)]) {
    const h = tone[theme as keyof typeof THEMES];
    const bare = contrast(fade(h), t.card); // the held mark ("Answered ✓")
    const pill = contrast(fade(h), over(hex(h), HELD * TINT, t.card));
    if (bare < 4.5) failures.push(`kind ${key} ${theme} on a held card: text ${bare.toFixed(2)} < 4.5`);
    if (pill < 4.5) failures.push(`kind ${key} ${theme} pill on a held card: text ${pill.toFixed(2)} < 4.5`);
  }
}
// The project accents (2026-11-16, mons.ts TYPES): a project's name in its type's colour on bb's surfaces, and on the
// sidebar's section header, which is a 14% tint of the colour itself.
for (const [theme, t] of Object.entries(THEMES)) {
  for (const [where, surface] of Object.entries(surfaces(t))) {
    for (const { type, tone } of TYPES) {
      const c = hex(tone[theme as keyof typeof THEMES]);
      for (const [on, under] of [[where, surface], [`a 14% tint on ${where}`, over(c, 0.14, surface)]] as const) {
        const r = contrast(c, under);
        if (r < 4.5) failures.push(`accent ${type} ${theme} on ${on}: text ${r.toFixed(2)} < 4.5`);
      }
    }
  }
}
// Open PRs rev 2 (2026-11-16): a state chip's words on its own TINT fill over every surface, and the Slack preview's
// link and mention blues on its message card (#ffffff / #1a1d21) and on a mention's tint.
const SLACK_CARD = { light: hex("#ffffff"), dark: hex("#1a1d21") } as const;
for (const [theme, t] of Object.entries(THEMES)) {
  const th = theme as keyof typeof THEMES;
  for (const [where, surface] of Object.entries(surfaces(t)))
    for (const [key, tone] of Object.entries(PR_CHIP_TONES)) {
      const c = hex(tone[th]);
      const r = contrast(c, over(c, TINT, surface));
      if (r < 4.5) failures.push(`PR chip ${key} ${theme} on ${where}: text ${r.toFixed(2)} < 4.5`);
    }
  for (const [where, surface] of [...Object.entries(surfaces(t)), ["Slack card", SLACK_CARD[th]] as const])
    for (const [key, tone] of Object.entries(SLACK_TONES)) {
      const c = hex(tone[th]);
      for (const [on, under] of [[where, surface], [`a mention tint on ${where}`, over(c, TINT, surface)]] as const) {
        const r = contrast(c, under);
        if (r < 4.5) failures.push(`Slack ${key} ${theme} on ${on}: text ${r.toFixed(2)} < 4.5`);
      }
    }
}
test("every role and kind colour is readable in both themes", () => {
  assert.deepEqual(failures, []);
});

test("addresses map to their role, unknown ones to none", () => {
  assert.equal(roleOf("cos"), "cos");
  assert.equal(roleOf("steward"), "steward");
  assert.equal(roleOf("lead:alpha"), "lead");
  assert.equal(roleOf("thread:alpha:3"), "thread");
  assert.equal(roleOf("person"), "person");
  assert.equal(roleOf("orchestrator"), "system");
  assert.equal(roleOf("engine"), "system");
  assert.equal(roleOf("someone-else"), null);
  assert.equal(roleOf(null), null);
});

test("each raw kind or state has one colour group, and the same word is coloured the same on every tab", () => {
  const seen = new Map<string, string>();
  for (const [key, tone] of Object.entries(KIND_TONES)) for (const c of tone.covers) {
    assert.ok(!seen.has(c), `${c} is in both ${seen.get(c)} and ${key}`);
    seen.set(c, key);
  }
  // the decision lifecycle reads as asked → triaged → deferred → answered, four different colours
  const states = ["asked", "open", "deferred", "answered"].map(kindOf);
  assert.equal(new Set(states).size, 4);
  assert.equal(kindOf("acked"), kindOf("answered"));
  assert.equal(kindOf("decision.answer"), kindOf("answered"));
  assert.equal(kindOf("pr"), kindOf("merge"));
  assert.equal(kindOf("something-new"), null);
});

// Every Board row kind the engine and server write gets a colour group: a new kind left uncoloured would read as
// "nothing special" on the Board. Read from the source, so a kind added there without a colour fails here.
test("every Board row kind the server writes has a colour group", () => {
  const src = ["../core/engine.ts", "../server.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  const written = new Set([...src.matchAll(/boardAdd\(\s*"([a-z._]+)"/g)].map((m) => m[1]!));
  written.add("pr").add("report"); // engine.ts report(): boardAdd(pr ? "pr" : "report", …)
  for (const k of ["prstate", "resolved", "unplanned", "archived"]) assert.ok(written.has(k), `the server no longer writes ${k}; drop it here`);
  for (const k of written) assert.ok(kindOf(k) !== null, `board kind ${k} has no colour in KIND_TONES`);
});

test("the phase-2 kinds read apart: resolved (archive me), unplanned (a flag) and archived (gone) never share a colour", () => {
  const groups = ["resolved", "unplanned", "archived"].map(kindOf);
  assert.equal(new Set(groups).size, 3);
  assert.equal(kindOf("archived"), kindOf("revoked"), "archived is inactive, like other finished things");
  assert.equal(kindOf("prstate"), kindOf("pr"), "a PR change is coloured like a PR report");
  assert.equal(kindOf("held"), kindOf("deferred"), "a held project is paused, like a deferred card");
});

test("a PR chip is red when something needs fixing, green when ready, and never green over failing checks", () => {
  const pr = (state: string, attention: string | null, checks: string | null) => prKind({ state, attention, checks });
  assert.equal(pr("open", "checks_failed", "failing"), "alarm");
  assert.equal(pr("open", "conflicts", "passing"), "alarm");
  assert.equal(pr("open", "changes_requested", null), "alarm");
  assert.equal(pr("open", "ready_to_merge", "passing"), "done");
  assert.equal(pr("open", "ready_to_merge", "failing"), "alarm");
  assert.equal(pr("open", "review_requested", "pending"), "merge");
  assert.equal(pr("merged", "merged", "passing"), "merge");
  assert.equal(pr("closed", "closed", "failing"), "inactive");
});

test("a rule is revoked before it is expired", () => {
  assert.equal(ruleState({ revokedAt: 5, expiresAt: 1 }, 10), "revoked");
  assert.equal(ruleState({ revokedAt: null, expiresAt: 10 }, 10), "expired");
  assert.equal(ruleState({ revokedAt: null, expiresAt: 11 }, 10), "live");
  assert.equal(ruleState({ revokedAt: null, expiresAt: null }, 10), "live");
});

test("every output kind has its own colour, so the owner tells a video from a doc at a glance on the Outputs tab", () => {
  const kinds = ["doc", "video", "image", "report", "link"].map(kindOf);
  assert.ok(kinds.every((k) => k !== null), "no output kind is left uncoloured");
  assert.equal(new Set(kinds).size, kinds.length);
  assert.equal(kindOf("report"), "report", "an output report is coloured as a reported piece of work on the Board");
  assert.ok(kindOf("output") !== null && !kinds.includes(kindOf("output")!), "the Board's output row has its own colour");
});
