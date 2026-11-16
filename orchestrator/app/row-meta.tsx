// The sidebar's metadata line under each role agent's thread (2026-11-13: "make the sidebar prettier, more
// colors"): a role chip in the role's colour, its Pokémon's name and a lead's
// priority; the sprite itself replaces the row's provider icon (useRowIcons). bb draws the line only with the threadRowMetadata experiment on and Organize → Rows → Metadata checked.
// Plain inline styles: the sidebar is outside the app's [data-orch] scope, so the app's CSS doesn't reach it.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { experimental_useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadRowMetadataProps } from "@get-bb/plugin-sdk/app";
import { CHANGED_CHANNEL, rpcContract, type Agents } from "../contract.ts";
import { isShiny, monByName, monSprite } from "../mons.ts";
import { PRIORITY_TONES, ROLE_TONES, css, projectTone, roleOf, tint, type Priority } from "./palette.ts";
import { sectionTitle } from "../core/model.ts";

type Agent = Agents[number];
export type RowData = Map<string, Agent>;

const ROLE_LABEL: Record<string, string> = { cos: "Chief of Staff", steward: "Steward", lead: "Lead", thread: "Thread" };

/** One agents query for the whole sidebar, refreshed when the orchestrator changes. */
export function useRowData(): RowData {
  const q = experimental_useRpcQuery({ contract: rpcContract, method: "agents", input: null });
  const refetch = q.refetch;
  // the agents read asks bb about every agent's thread: at most one refresh per 15 s however busy the orchestrator is
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useRealtime(
    CHANGED_CHANNEL,
    useCallback(() => {
      timer.current ??= setTimeout(() => {
        timer.current = null;
        void refetch();
      }, 15_000);
    }, [refetch]),
  );
  const map = useMemo(() => new Map((q.data ?? []).map((a) => [a.threadId, a])), [q.data]);
  useRowIcons(map);
  return map;
}

/**
 * Requested 2026-11-13: section titles colour-coded "like a bar". Each project's section header (found by its title,
 * sectionTitle) gets a background tinted in the project's colour and bold text in that colour (the left bar was dropped).
 */
function sectionCss(map: RowData): string[] {
  const slugs = new Set<string | null>([null, ...[...map.values()].map((a) => a.project)]);
  return [...slugs].flatMap((slug) => {
    const title = sectionTitle(slug).replace(/["\\]/g, "");
    const c = css(projectTone(slug));
    const head = `[data-sidebar-section-id]:has(> [data-sidebar="group-label"] span[title="${title}"]) > [data-sidebar="group-label"]`;
    return [
      `${head} { background: color-mix(in srgb, ${c} 14%, var(--sidebar, var(--background))) !important; border-radius: 6px; margin: 6px 0 2px; }`,
      `${head} span[title] { color: ${c}; font-weight: 650; letter-spacing: .01em; }`,
    ];
  });
}

/**
 * Requested 2026-11-13: "move the sprites to the claude icons". bb has no per-thread row icon slot, so one stylesheet
 * swaps the provider mark of each role agent's row (found by its thread link's data-sidebar-thread-id) for its
 * sprite. Rows of threads that aren't role agents keep bb's own icon.
 */
function useRowIcons(map: RowData): void {
  useEffect(() => {
    const id = "orch-row-icons";
    const el = (document.getElementById(id) as HTMLStyleElement | null) ?? Object.assign(document.createElement("style"), { id });
    if (!el.isConnected) document.head.appendChild(el);
    el.textContent = [...map.values()]
      .flatMap((a) => {
        const m = monByName(a.form ?? a.mon);
        if (!m || !/^[\w-]+$/.test(a.threadId)) return [];
        // the exact chain bb draws (link, then its title span, then the icon): a looser match leaks into a neighbour row
        // the standing agents and leads stand out; their threads stay smaller. The icon sits on the title line: moved down
        // to the middle of the two-line row, or its top is cut off by the row above, and kept clear of the sidebar's left
        // edge (2026-11-13)
        const px = a.role === "thread" ? 30 : 38;
        const row = `a[data-sidebar-thread-id="${a.threadId}"] + span > span > [data-sidebar-thread-provider]`;
        return [
          `${row} > * { display: none !important; }`,
          `${row} { width: ${px}px; height: ${px}px; margin: -${(px - 16) / 2}px 4px -${(px - 16) / 2}px -${px - 30}px; position: relative; top: 9px; background: url("${monSprite(m, true, isShiny(a.role))}") center / contain no-repeat; image-rendering: pixelated; }`,
        ];
      })
      .concat(sectionCss(map))
      .join("\n");
  }, [map]);
  useEffect(() => () => document.getElementById("orch-row-icons")?.remove(), []);
}

export function RowMeta({ thread, data }: ExperimentalThreadRowMetadataProps<RowData>) {
  const a = data?.get(thread.id);
  if (!a) return null;
  const role = roleOf(a.address);
  const tone = role ? ROLE_TONES[role] : null;
  const m = monByName(a.form ?? a.mon);
  const shiny = isShiny(a.role);
  const priority = a.role === "lead" && a.priority && a.priority in PRIORITY_TONES ? (a.priority as Priority) : null;
  const tip = `${m ? `${shiny ? "Shiny " : ""}${m.name} · ` : ""}${a.address}${priority ? ` · ${priority} priority` : ""}`;
  return (
    // indented as far as the sprite moved off the sidebar edge (useRowIcons), so the chips stay clear of it
    <span title={tip} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8, fontSize: 11, lineHeight: "18px", whiteSpace: "nowrap" }}>
      {tone ? (
        <span style={{ color: css(tone), background: tint(tone), borderRadius: 999, padding: "0 7px", fontWeight: 600 }}>{ROLE_LABEL[a.role] ?? a.role}</span>
      ) : null}
      <span style={{ fontWeight: 700 }}>Lv {a.level}</span>
      {m ? <span style={{ color: tone ? css(tone) : undefined }}>{m.name}</span> : null}
      {priority ? (
        <span style={{ color: css(PRIORITY_TONES[priority]), background: tint(PRIORITY_TONES[priority]), borderRadius: 999, padding: "0 7px" }}>{priority}</span>
      ) : null}
    </span>
  );
}
