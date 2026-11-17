// The project accent (2026-11-16): one colour per project, its Pokémon type's (mons.ts TYPES), as one CSS custom
// property set on the project's element and read by what is inside it: its sidebar section, its Projects row and lanes,
// its project page and its cards. A later Projects redesign reads the same token.
// With the pokemon setting off the server sends no type, so every helper here returns undefined: no property, no
// colour, the page exactly as before (test/pokemon-types.test.ts).
import type { CSSProperties } from "react";
import { typeFamily } from "../mons.ts";
import { sectionTitle } from "../core/model.ts";
import { css, projectTone, type Tone } from "./palette.ts";

export const ACCENT_VAR = "--orch-project-accent";
/** The value that reads the token. */
export const ACCENT = `var(${ACCENT_VAR})`;

/** A project's accent tone: its type's, or null (no type, or the setting off). */
export const accentTone = (monType: string | null | undefined): Tone | null => typeFamily(monType)?.tone ?? null;

/** Sets the token on a project's element; undefined without a type. */
export function accentVars(monType: string | null | undefined, extra?: CSSProperties): CSSProperties | undefined {
  const t = accentTone(monType);
  return t ? ({ [ACCENT_VAR]: css(t), ...extra } as CSSProperties) : undefined;
}

/** A colour in the accent, wherever it sits; `otherwise` without a type. */
export function accentText(monType: string | null | undefined, otherwise?: string): string | undefined {
  const t = accentTone(monType);
  return t ? css(t) : otherwise;
}

/**
 * Requested 2026-11-13: section titles colour-coded "like a bar". Each project's section header (found by its title,
 * sectionTitle) gets a background tinted in the project's colour and bold text in that colour (the left bar was dropped).
 * With the pokemon setting on (2026-11-16) the colour is the project accent (its type's), also set as the
 * accent token on the section; with it off, exactly the hashed colour as before.
 */
export function sectionCss(agents: Iterable<{ project: string | null; monType?: string | null }>): string[] {
  const types = new Map<string | null, string | null>([[null, null]]);
  for (const a of agents) if (!types.get(a.project)) types.set(a.project, a.monType ?? null);
  return [...types].flatMap(([slug, monType]) => {
    const title = sectionTitle(slug).replace(/["\\]/g, "");
    const accent = slug ? accentTone(monType) : null;
    const c = css(accent ?? projectTone(slug));
    const section = `[data-sidebar-section-id]:has(> [data-sidebar="group-label"] span[title="${title}"])`;
    const head = `${section} > [data-sidebar="group-label"]`;
    return [
      ...(accent ? [`${section} { ${ACCENT_VAR}: ${c}; }`] : []),
      `${head} { background: color-mix(in srgb, ${c} 14%, var(--sidebar, var(--background))) !important; border-radius: 6px; margin: 6px 0 2px; }`,
      `${head} span[title] { color: ${c}; font-weight: 650; letter-spacing: .01em; }`,
    ];
  });
}
