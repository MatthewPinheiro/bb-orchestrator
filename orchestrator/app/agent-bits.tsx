// What an agent's row says about it, shared by the Projects tab's lanes and standing agents (2026-11-16: the Agents tab
// went, and each of its fields moved here) and by the cards' PR blocks: its PR chip, its level, how full its context
// window is, and whether something happened since the owner last looked.
import type { CSSProperties } from "react";
import type { Agents } from "../contract.ts";
import { KIND_TONES, ROLE_TONES, css, prKind, roleOf } from "./palette.ts";
import { Kind } from "./ui.tsx";

type Agent = Agents[number];

export const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** used / window as a short bar in the agent's role colour, with the numbers beside it. */
export function ContextMeter({ a }: { a: Agent }) {
  if (a.usedTokens === null) return null;
  const win = a.contextWindow && a.contextWindow > 0 ? a.contextWindow : null;
  const ratio = win ? Math.min(1, Math.max(0, a.usedTokens / win)) : null;
  const role = roleOf(a.address);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" data-tokens={ratio === null ? "" : ratio.toFixed(2)} title="Context window used">
      {ratio !== null ? (
        <span
          role="meter"
          aria-label="Context window used"
          aria-valuemin={0}
          aria-valuemax={win ?? 0}
          aria-valuenow={a.usedTokens}
          className="inline-block h-1.5 w-10 overflow-hidden rounded-full"
          style={{ background: "var(--orch-line)" }}
        >
          <span className="block h-full rounded-full" style={{ width: `${ratio * 100}%`, background: role ? css(ROLE_TONES[role]) : "var(--orch-muted)" } as CSSProperties} />
        </span>
      ) : null}
      <span className="orch-muted text-xs tabular-nums">
        {kTokens(a.usedTokens)}
        {win ? `/${kTokens(win)}` : ""}
      </span>
    </span>
  );
}

/** Level and the XP bar to the next one: tokens processed by this agent's turns (mons.ts levelFor). */
export function Level({ a }: { a: Agent }) {
  const pct = Math.max(0, Math.min(100, ((a.xp - a.xpThis) / Math.max(1, a.xpNext - a.xpThis)) * 100));
  const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);
  return (
    <span data-level={a.level} className="inline-flex items-center gap-1 whitespace-nowrap text-xs" title={`${fmt(a.xp)} tokens · next level at ${fmt(a.xpNext)}`}>
      <span className="font-semibold">Lv {a.level}</span>
      <span className="inline-block h-1.5 w-8 overflow-hidden rounded-full" style={{ background: "var(--orch-line)" }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--primary)" }} />
      </span>
    </span>
  );
}

/** Something happened in the agent's thread since the owner last looked. */
export function UnreadDot() {
  return <span data-unread="" role="img" aria-label="Unread" title="Something happened since you last looked" className="inline-block size-2 shrink-0 rounded-full" style={{ background: css(KIND_TONES.asked) }} />;
}

/** The PR: number, state, what it waits on and its checks, coloured by prKind; a link when bb knows the url. */
export function PrChip({ pr }: { pr: Omit<NonNullable<Agent["pr"]>, "review"> }) {
  const words = [`PR${pr.number ? ` #${pr.number}` : ""}`, pr.state, pr.attention && pr.attention !== "none" && pr.attention !== pr.state ? pr.attention.replace(/_/g, " ") : null, pr.checks ? `checks ${pr.checks}` : null]
    .filter(Boolean)
    .join(" · ");
  const chip = (
    <Kind of="pr" group={prKind(pr)} data-pr={pr.state ?? ""}>
      {words}
    </Kind>
  );
  return pr.url ? (
    <a href={pr.url} target="_blank" rel="noreferrer" className="no-underline hover:underline" title={pr.url}>
      {chip}
    </a>
  ) : (
    chip
  );
}
