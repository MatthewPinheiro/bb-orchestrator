// The sidebar's metadata line under a role agent's thread, drawn (app/row-meta.tsx feeds it the agents RPC). No bb SDK
// here, so node --test renders it (test/row-line.test.ts). Plain inline styles: the sidebar is outside the app's
// [data-orch] scope, so the app's CSS doesn't reach it.
import type { Agents } from "../contract.ts";
import { isShiny } from "../mons.ts";
import { rowName, spriteMon } from "./faces.ts";
import { PRIORITY_TONES, ROLE_TONES, css, roleOf, tint, type Priority } from "./palette.ts";
import { accentText } from "./accent.ts";

type Agent = Agents[number];

const ROLE_LABEL: Record<string, string> = { cos: "Chief of Staff", steward: "Steward", lead: "Lead", thread: "Thread" };

/**
 * With a personas pack (2026-11-18): the chips (the role's, Lv) are never cut off, and the person's name stays whole.
 * The owner saw lead rows read "Lead Lv 28 D…  normal" at the sidebar's default width: the priority chip took the
 * name's room. The name wins: a lead's priority is a mark inside its role chip (PriorityMark), not a chip of its own.
 * Past what the row can hold, the name still ends in "…" rather than pushing the line out. Rows without a person keep
 * their style as before.
 */
const FIT = { gap: 3, maxWidth: "calc(100% - 8px)" } as const;
const NAME_FIT = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } as const;

/**
 * A lead's priority as one small mark, told apart by shape as well as colour (urgent's and high's reds are close):
 * urgent two chevrons up, high one, normal two bars, low one chevron down, in the priority's colour.
 */
const MARKS: Record<Priority, string> = {
  urgent: "M1 6.5 4 3.5 7 6.5M1 10 4 7 7 10",
  high: "M1 8.5 4 5.5 7 8.5",
  normal: "M1 5.5H7M1 8.5H7",
  low: "M1 5.5 4 8.5 7 5.5",
};

export function PriorityMark({ priority }: { priority: Priority }) {
  return (
    <svg data-priority={priority} role="img" aria-label={`${priority} priority`} width="8" height="14" viewBox="0 0 8 14" style={{ flexShrink: 0, marginLeft: 3, verticalAlign: "middle" }}>
      <title>{`${priority} priority`}</title>
      <path d={MARKS[priority]} fill="none" stroke={css(PRIORITY_TONES[priority])} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RowLine({ a }: { a: Agent }) {
  const role = roleOf(a.address);
  const tone = role ? ROLE_TONES[role] : null;
  const m = spriteMon(a.form ?? a.mon, a.formDex);
  const shiny = isShiny(a.role);
  const p = a.persona ?? null; // 2026-11-18: with a personas pack, its person
  const name = rowName(a);
  const priority = a.role === "lead" && a.priority && a.priority in PRIORITY_TONES ? (a.priority as Priority) : null;
  const tip = `${p ? `${p.name} · ` : m ? `${shiny ? "Shiny " : ""}${m.name} · ` : ""}${a.address}${priority ? ` · ${priority} priority` : ""}`;
  // with a person on a lead row, the priority is a mark in the role chip; otherwise the chip after the name, as before
  const markInChip = !!(p && priority);
  return (
    // indented as far as the sprite moved off the sidebar edge (useRowIcons), so the chips stay clear of it
    <span title={tip} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8, fontSize: 11, lineHeight: "18px", whiteSpace: "nowrap", ...(p ? FIT : {}) }}>
      {tone ? (
        <span style={{ ...(markInChip ? { display: "inline-flex", alignItems: "center" } : {}), color: css(tone), background: tint(tone), borderRadius: 999, padding: "0 7px", fontWeight: 600 }}>
          {ROLE_LABEL[a.role] ?? a.role}
          {markInChip ? <PriorityMark priority={priority!} /> : null}
        </span>
      ) : null}
      <span style={{ fontWeight: 700 }}>Lv {a.level}</span>
      {/* a lead's and its threads' Pokémon in their project's accent, so the family reads as one; with a personas pack
          the person's name alone (faces.ts rowName) */}
      {name ? (
        <span style={{ color: accentText(a.monType, tone ? css(tone) : undefined), ...(p ? NAME_FIT : {}) }}>{name}</span>
      ) : null}
      {priority && !markInChip ? (
        <span style={{ color: css(PRIORITY_TONES[priority]), background: tint(PRIORITY_TONES[priority]), borderRadius: 999, padding: "0 7px" }}>{priority}</span>
      ) : null}
    </span>
  );
}
