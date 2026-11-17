// The shared components of the 2026-11-17 Projects tab (kit.ts has what they say): a neutral icon, the state chip, an
// age with its source, a step meter, a context meter and the section card. Shareable: the tokens sit on [data-orch], so
// Open PRs and Deliverables can use them as they are (not restyled this round). Rules kept: type 12/14/16, weights
// 400/600, every gap on a 4 px grid, no coloured left edges; colour says state only, and never alone.
import type { ReactNode } from "react";
import type { AgeSpec, ChipSpec, IconName, Tone } from "./kit.ts";

export const kitCss = /* css */ `
[data-orch] {
  --k-border: color-mix(in srgb, var(--orch-ink) 14%, transparent);
  --k-wash: color-mix(in srgb, var(--orch-ink) 5%, transparent);
  --k-need: light-dark(#9d174d, #f9a8d4);
  --k-blocked: light-dark(#b91c1c, #fca5a5);
  --k-warn: light-dark(#92400e, #fbbf24);
  --k-good: light-dark(#166534, #4ade80);
  --k-info: light-dark(#3730a3, #a5b4fc);
}
[data-orch] .k-i { width: 12px; height: 12px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
/* .k-chip.k-chip, .k-btn.k-btn, .k-more.k-more: doubled to beat a tab's button reset ([data-orch] .orch-cc button) */
[data-orch] .k-chip.k-chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 12px; font-size: 12px; line-height: 16px; font-weight: 400; white-space: nowrap; flex: none; color: var(--orch-ink); background: var(--k-wash); text-decoration: none; vertical-align: middle; }
[data-orch] .k-chip[data-tone="need"] { background: var(--k-need); color: Canvas; font-weight: 600; }
[data-orch] .k-chip[data-tone="blocked"] { color: var(--k-blocked); background: color-mix(in srgb, var(--k-blocked) 12%, transparent); font-weight: 600; }
[data-orch] .k-chip[data-tone="warn"] { color: var(--k-warn); background: color-mix(in srgb, var(--k-warn) 12%, transparent); }
[data-orch] .k-chip[data-tone="good"] { color: var(--k-good); background: color-mix(in srgb, var(--k-good) 12%, transparent); }
[data-orch] .k-chip[data-tone="info"] { color: var(--k-info); background: color-mix(in srgb, var(--k-info) 12%, transparent); }
[data-orch] .k-chip[data-tone="quiet"] { color: var(--orch-muted); background: transparent; box-shadow: inset 0 0 0 1px var(--k-border); }
[data-orch] button.k-chip { cursor: pointer; border: 0; font-family: inherit; }
[data-orch] .k-age { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 48px; font-size: 12px; line-height: 16px; color: var(--orch-muted); white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }
[data-orch] .k-age[data-old="true"] { color: var(--k-warn); }
[data-orch] .k-meter { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; line-height: 16px; color: var(--orch-muted); white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }
[data-orch] .k-meter i { display: block; width: 40px; height: 4px; border-radius: 2px; background: var(--k-border); overflow: hidden; }
[data-orch] .k-meter i u { display: block; height: 100%; background: var(--orch-muted); border-radius: 2px; }
[data-orch] .k-meter[data-high="true"] i u { background: var(--k-warn); }
[data-orch] .k-steps { display: inline-flex; gap: 4px; flex: none; }
[data-orch] .k-steps i { display: block; width: 8px; height: 4px; border-radius: 2px; background: var(--k-border); }
[data-orch] .k-steps i.on { background: var(--orch-ink); }
[data-orch] .k-btn.k-btn { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--k-border); background: transparent; color: var(--orch-ink); font: inherit; font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; white-space: nowrap; flex: none; }
[data-orch] .k-btn.k-btn:disabled { opacity: 0.5; cursor: default; }
[data-orch] .k-btn.k-btn.solid { background: var(--orch-ink); color: Canvas; border-color: transparent; }
[data-orch] .k-btn.k-btn.icon { width: 24px; padding: 0; justify-content: center; border-color: transparent; color: var(--orch-muted); }
[data-orch] .k-more.k-more { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; padding: 0 8px; border: 0; border-radius: 12px; background: transparent; color: var(--orch-muted); font: inherit; font-size: 12px; line-height: 16px; cursor: pointer; white-space: nowrap; }
[data-orch] .k-more.k-more:hover { background: var(--k-wash); }

/* ---- section card: one section, one unit; only Needs and Blocked get a tone */
[data-orch] .k-card { border: 1px solid var(--k-border); border-radius: 8px; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
[data-orch] .k-card-h { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 12px 0 16px; margin: 0; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--orch-ink); border-bottom: 1px solid var(--k-border); }
[data-orch] .k-card-h .k-count { font-weight: 400; color: var(--orch-muted); font-variant-numeric: tabular-nums; }
[data-orch] .k-card-h .k-sub { font-weight: 400; color: var(--orch-muted); }
[data-orch] .k-card-h .k-right { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-weight: 400; }
[data-orch] .k-card-b { display: flex; flex-direction: column; padding: 4px 8px 8px; min-width: 0; }
[data-orch] .k-card[data-tone="need"] { border-color: color-mix(in srgb, var(--k-need) 40%, transparent); }
[data-orch] .k-card[data-tone="need"] > .k-card-h { background: color-mix(in srgb, var(--k-need) 12%, transparent); color: var(--k-need); border-bottom-color: color-mix(in srgb, var(--k-need) 24%, transparent); }
[data-orch] .k-card[data-tone="blocked"] { border-color: color-mix(in srgb, var(--k-blocked) 40%, transparent); }
[data-orch] .k-card[data-tone="blocked"] > .k-card-h { background: color-mix(in srgb, var(--k-blocked) 12%, transparent); color: var(--k-blocked); border-bottom-color: color-mix(in srgb, var(--k-blocked) 24%, transparent); }
[data-orch] .k-card[data-tone] > .k-card-h .k-count { color: inherit; }
[data-orch] .k-card[data-empty="true"] > .k-card-h { border-bottom: 0; font-weight: 400; color: var(--orch-muted); }

/* ---- a row inside a card: words, then chips, then an age; one height */
[data-orch] .k-row { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 8px; border-radius: 4px; min-width: 0; }
[data-orch] .k-row + .k-row { box-shadow: 0 -1px 0 var(--orch-line); }
[data-orch] .k-row .k-lead { display: inline-flex; flex: none; color: var(--orch-muted); width: 16px; justify-content: center; }
[data-orch] .k-row .k-t { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .k-row .k-t .q { color: var(--orch-muted); }
[data-orch] .k-card[data-tone] .k-row .k-t { font-weight: 600; }
[data-orch] .k-row .k-ref { display: inline-flex; align-items: center; min-height: 24px; color: inherit; font: inherit; font-weight: 600; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: var(--k-border); text-underline-offset: 4px; font-variant-numeric: tabular-nums; }
[data-orch] .k-row .k-when { flex: none; min-width: 72px; text-align: right; font-size: 12px; line-height: 16px; color: var(--orch-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-orch] .k-empty { padding: 4px 8px; color: var(--orch-muted); }

/* ---- a two-way switch in a card's head */
[data-orch] .k-seg { display: inline-flex; gap: 4px; padding: 4px; margin-left: -8px; border-radius: 8px; background: var(--k-wash); font-weight: 400; color: var(--orch-muted); }
[data-orch] .k-seg button { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 4px; cursor: pointer; }
[data-orch] .k-seg button[aria-selected="true"] { background: Canvas; color: var(--orch-ink); font-weight: 600; box-shadow: 0 0 0 1px var(--k-border); }
`;

// icons: neutral, drawn on a 16 grid at 12 px, in the text's colour
const P: Record<IconName, string> = {
  you: '<circle cx="8" cy="5" r="2.5"/><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4"/>',
  blocked: '<circle cx="8" cy="8" r="6"/><path d="M3.8 3.8l8.4 8.4"/>',
  wait: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
  moving: '<path d="M5.5 3.5l6 4.5-6 4.5z"/>',
  quiet: '<path d="M4 8h8"/>',
  held: '<path d="M6 4v8M10 4v8"/>',
  nolead: '<circle cx="8" cy="5" r="2.5"/><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4M2.5 2.5l11 11"/>',
  pr: '<circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M4 5.5v5M12 10.5V7a2 2 0 0 0-2-2H8"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  draft: '<circle cx="8" cy="8" r="5.5" stroke-dasharray="2 2.3"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  merged: '<circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M4 5.5v5M4 6a4 4 0 0 0 4 2h2.5"/>',
  doc: '<path d="M4 1.5h5l3 3v10H4zM9 1.5v3h3"/><path d="M6 8h4M6 10.5h4"/>',
  page: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 6h13M4 4.3h.01M6 4.3h.01"/>',
  link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>',
  box: '<path d="M2.5 5L8 2l5.5 3v6L8 14l-5.5-3zM2.5 5L8 8l5.5-3M8 8v6"/>',
  report: '<path d="M4 1.5h8v13H4z"/><path d="M6 8l1.5 1.5L10 6.5"/>',
  pin: '<path d="M9.5 2l4.5 4.5-2.3.4-2.2 2.2.3 3.2L6 8.5zM6.9 9.1L2.5 13.5"/>',
  unpin: '<path d="M9.5 2l4.5 4.5-2.3.4-2.2 2.2.3 3.2L6 8.5zM6.9 9.1L2.5 13.5M2.5 2.5l11 11"/>',
  more: '<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2"/>',
  said: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  live: '<path d="M1.5 8h3l1.5-4 3 8 1.5-4h4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  chev: '<path d="M6 3.5L10.5 8 6 12.5"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M3.5 10.5h-1v-8h8v1"/>',
  open: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M8.5 2.5v11"/>',
};

/** A neutral 12 px icon. With `label` it is announced; without, it is decoration beside a word. */
export function Icon({ name, label }: { name: IconName; label?: string }) {
  return <svg className="k-i" viewBox="0 0 16 16" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: P[name] }} />;
}

/** The state chip: an icon and a word in one of five tones (never colour alone). */
export function Chip({ spec, title, ...data }: { spec: ChipSpec; title?: string; [d: `data-${string}`]: string | undefined }) {
  return (
    <span className="k-chip" data-tone={spec.tone} title={title} {...data}>
      <Icon name={spec.icon} />
      <span>{spec.word}</span>
    </span>
  );
}

/** A chip that is also a button (a wait on the owner that opens its card). */
export function ChipButton({ spec, title, onClick, ...data }: { spec: ChipSpec; title?: string; onClick: () => void; [d: `data-${string}`]: string | undefined }) {
  return (
    <button type="button" className="k-chip" data-tone={spec.tone} title={title} onClick={onClick} {...data}>
      <Icon name={spec.icon} />
      <span>{spec.word}</span>
    </button>
  );
}

/** "6h" with a mark for its source (live, the lead's word, a thread's report); amber once old. */
export function Age({ spec }: { spec: AgeSpec | null }) {
  if (!spec) return <span className="k-age" />;
  return (
    <span className="k-age" data-old={spec.old ? "true" : "false"} title={spec.title}>
      {spec.source ? <Icon name={spec.source === "live" ? "live" : "said"} label={spec.source === "live" ? "live" : spec.source === "lead" ? "lead said" : "thread said"} /> : null}
      {spec.text}
    </span>
  );
}

/** One small bar per step; the steps done and the current one in ink. */
export function Steps({ at, total }: { at: number; total: number }) {
  return (
    <span className="k-steps" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < at ? "on" : undefined} />
      ))}
    </span>
  );
}

/** How full a context window is, with the tokens used; amber past 60%. */
export function CtxMeter({ used, window: win }: { used: number | null; window: number | null }) {
  if (used === null) return null;
  const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const ratio = win && win > 0 ? Math.min(1, Math.max(0, used / win)) : null;
  return (
    <span className="k-meter" data-tokens={ratio === null ? "" : ratio.toFixed(2)} data-high={ratio !== null && ratio > 0.6 ? "true" : "false"} title={`Context window used: ${k(used)}${win ? ` of ${k(win)}` : ""}`}>
      {ratio !== null ? (
        <i role="meter" aria-label="Context window used" aria-valuemin={0} aria-valuemax={win ?? 0} aria-valuenow={used}>
          <u style={{ width: `${Math.round(ratio * 100)}%` }} />
        </i>
      ) : null}
      {k(used)}
    </span>
  );
}

/**
 * A section card: a head (icon, title, count, a quiet note, things on the right) and its rows. Only Needs and Blocked
 * take a tone. An empty card is its head alone.
 */
export function SectionCard({ name, title, count, sub, tone, icon, right, empty, children }: { name: string; title: ReactNode; count?: number | null; sub?: string | null; tone?: Extract<Tone, "need" | "blocked">; icon?: IconName; right?: ReactNode; empty?: boolean; children?: ReactNode }) {
  return (
    <section className="k-card" data-card-section={name} data-book-section={name} data-tone={tone} data-empty={empty ? "true" : "false"}>
      <h4 className="k-card-h">
        {icon ? <Icon name={icon} /> : null}
        <span>{title}</span>
        {count !== undefined && count !== null ? <span className="k-count">{count}</span> : null}
        {sub ? <span className="k-sub">{sub}</span> : null}
        {right ? <span className="k-right">{right}</span> : null}
      </h4>
      {empty ? null : <div className="k-card-b">{children}</div>}
    </section>
  );
}

/** "all 8 ›": the rest of a capped list. */
export function AllButton({ n, open, onClick, ...data }: { n: number; open: boolean; onClick: () => void; [d: `data-${string}`]: string | undefined }) {
  return (
    <button type="button" className="k-more" aria-expanded={open} onClick={onClick} {...data}>
      {open ? "fewer" : `all ${n}`}
      <Icon name="chev" />
    </button>
  );
}

