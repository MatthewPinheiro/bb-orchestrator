// The visual blocks of a deliverable (and a card), in affectUI's clean look (2026-11-13: deliverables "a lot more
// visual", then "way too vibe coded ... we base everything off the affectUI library"). Each block is affectUI's Change
// Summary card: one card with hairline shadows, a 44px heading row (icon, title, a quiet note on the right), rows under
// 0.5px lines, a small tinted mark, quiet gray text. Statuses are affectUI Badges in its six tones. The diagram's boxes
// are drawn as the same cards in miniature.
import type { ReactNode } from "react";
import type { Block, Point } from "../blocks.ts";
import { Badge } from "./affect/badge-clean.tsx";
import { css as changeSummaryCss } from "./affect/change-summary-clean.tsx";
import { BOX_W, BOX_W_MAX, layout } from "./diagram-layout.ts";

type B<K extends Block["kind"]> = Extract<Block, { kind: K }>;

/* ---------- Icons: affectUI's thin lines, round caps ---------- */
const icon = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const ICONS = {
  decisions: icon(<path d="M3 8.5l3 3 7-7" />),
  changes: icon(<path d="M2.5 4h4M2.5 8h8M6.5 12h7M9.5 4h1" />),
  checks: icon(<><circle cx="8" cy="8" r="5.5" /><path d="M5.8 8.2l1.6 1.6 2.9-3.2" /></>),
  verdicts: icon(<><circle cx="8" cy="8" r="5.5" /><path d="M5.8 8.2l1.6 1.6 2.9-3.2" /></>),
  facts: icon(<path d="M3 13V8M8 13V3M13 13V6" />),
  rca: icon(<><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></>),
  diagram: icon(<><rect x="1.5" y="2.5" width="5" height="4" rx="1" /><rect x="9.5" y="9.5" width="5" height="4" rx="1" /><path d="M4 6.5v3.5a1 1 0 0 0 1 1h4.5" /></>),
};
const MARKS = {
  good: <path d="M3.5 6.2l1.7 1.7 3.3-3.6" />,
  bad: <path d="M4 4l4 4M8 4l-4 4" />,
  neutral: <path d="M3 6h6" />,
};
function Mark({ tone }: { tone: "good" | "bad" | "neutral" }) {
  return (
    <span className="ui-csc__trend" data-tone={tone} aria-hidden="true">
      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
        {MARKS[tone]}
      </svg>
    </span>
  );
}

/** affectUI's Change Summary card: the heading row, then the rows. */
function Panel({ kind, title, note, children }: { kind: keyof typeof ICONS; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-csc orch-panel" data-block={kind} aria-label={title}>
      <header className="ui-csc__head">
        <span className="ui-csc__title">
          <span className="ui-csc__icon">{ICONS[kind]}</span>
          <span className="ui-csc__title-text">{title}</span>
        </span>
        {note ? <span className="ui-csc__period orch-panel__note">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** A row: what (wrapping, medium), a quiet second line, and a badge or mark at the end. */
function Row({ lead, text, sub, end, data }: { lead?: ReactNode; text: ReactNode; sub?: ReactNode; end?: ReactNode; data?: Record<string, string> }) {
  return (
    <div className="ui-csc__row orch-panel__row" data-lead={lead ? "" : undefined} {...data}>
      {lead}
      <div className="min-w-0">
        <div className="orch-panel__text">{text}</div>
        {sub ? <div className="orch-panel__sub">{sub}</div> : null}
      </div>
      {end ?? <span />}
    </div>
  );
}

const DECIDED = { made: { label: "Decided", tone: "success" }, proposed: { label: "Proposed", tone: "info" }, needs_you: { label: "Needs you", tone: "warning" } } as const;

export function Decisions({ b }: { b: B<"decisions"> }) {
  return (
    <Panel kind="decisions" title={b.title ?? "Decisions"}>
      {b.items.map((d, i) => (
        <Row key={i} data={{ "data-decision": d.status }} text={d.text} sub={d.why} end={<Badge tone={DECIDED[d.status].tone}>{DECIDED[d.status].label}</Badge>} />
      ))}
    </Panel>
  );
}

const LEVEL = { must: { label: "Must", tone: "danger" }, should: { label: "Should", tone: "warning" }, nit: { label: "Nit", tone: "neutral" } } as const;

export function Changes({ b }: { b: B<"changes"> }) {
  const order = { must: 0, should: 1, nit: 2 } as const;
  const items = [...b.items].sort((x, y) => order[x.level] - order[y.level]);
  const counts = (["must", "should", "nit"] as const).map((l) => [l, b.items.filter((c) => c.level === l).length] as const).filter(([, n]) => n > 0);
  return (
    <Panel kind="changes" title={b.title ?? "What to change"} note={counts.map(([l, n]) => `${n} ${l}`).join(" · ")}>
      {items.map((c, i) => (
        <Row key={i} data={{ "data-change-level": c.level }} text={c.text} sub={c.where ? <span className="orch-mono">{c.where}</span> : undefined} end={<Badge tone={LEVEL[c.level].tone}>{LEVEL[c.level].label}</Badge>} />
      ))}
    </Panel>
  );
}

export function Checks({ b }: { b: B<"checks"> }) {
  const passed = b.items.filter((c) => c.ok).length;
  return (
    <Panel kind="checks" title={b.title ?? "Checks"} note={`${passed} of ${b.items.length} passed`}>
      {b.items.map((c, i) => (
        <Row key={i} data={{ "data-check": c.ok ? "ok" : "fail" }} lead={<Mark tone={c.ok ? "good" : "bad"} />} text={c.text} sub={c.how} />
      ))}
    </Panel>
  );
}

const FACT = { good: "good", bad: "bad", warn: "neutral" } as const;

export function Facts({ b }: { b: B<"facts"> }) {
  // when some values carry a mark, the others keep its space so the values line up
  const toned = b.items.some((f) => f.tone);
  return (
    <Panel kind="facts" title={b.title ?? "Facts"}>
      <dl className="ui-csc__list">
        {b.items.map((f, i) => (
          <div key={i} className="ui-csc__row">
            <dt className="ui-csc__label" title={f.label}>
              {f.label}
            </dt>
            <dd className="ui-csc__change">
              {f.tone ? <Mark tone={FACT[f.tone]} /> : toned ? <span className="ui-csc__trend" aria-hidden="true" style={{ visibility: "hidden" }} /> : null}
              <span className="ui-csc__text">{f.value}</span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function Rca({ b }: { b: B<"rca"> }) {
  const rows = [
    { key: "symptom", label: "Symptom", text: b.symptom, tone: "bad" as const },
    { key: "cause", label: "Root cause", text: b.cause, sub: b.evidence ? `Evidence: ${b.evidence}` : undefined, tone: "neutral" as const },
    { key: "fix", label: "Fix", text: b.fix, tone: "good" as const },
  ];
  return (
    <Panel kind="rca" title="Root cause" note={<Badge tone={b.status === "fixed" ? "success" : "info"}>{b.status === "fixed" ? "Fixed" : "Fix proposed"}</Badge>}>
      <dl className="ui-csc__list">
        {rows.map((r) => (
          <div key={r.key} className="ui-csc__row orch-panel__pair" data-rca={r.key}>
            <dt className="ui-csc__label">{r.label}</dt>
            <dd className="ui-csc__change">
              <Mark tone={r.tone} />
              <span className="min-w-0">
                <span className="orch-panel__text block">{r.text}</span>
                {r.sub ? <span className="orch-panel__sub block">{r.sub}</span> : null}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* ---------- Less text (2026-11-14): a PR review as tiles, then each decision and finding in one line ---------- */

const VERDICT = { good: "success", warn: "warning", bad: "danger" } as const;
const prNo = (url: string) => url.match(/\/pull\/(\d+)/)?.[1] ?? null;

/** The picture first: one bar of the verdict mix, then a tile per PR with its verdict. */
export function Verdicts({ b }: { b: B<"verdicts"> }) {
  const ready = b.items.filter((v) => v.tone === "good").length;
  return (
    <Panel kind="verdicts" title={b.title ?? `${b.items.length} PR${b.items.length === 1 ? "" : "s"}`} note={`${ready} ready`}>
      <div className="orch-verdicts">
        <div className="orch-verdicts__bar" data-verdict-bar="">
          {b.items.map((v, i) => (
            <span key={i} data-tone={v.tone ?? "none"} title={`${prNo(v.url) ? `#${prNo(v.url)} · ` : ""}${v.verdict}`} />
          ))}
        </div>
        <div className="orch-verdicts__tiles">
          {b.items.map((v, i) => (
            <a key={i} href={v.url} target="_blank" rel="noopener noreferrer" data-verdict={prNo(v.url) ?? i} className="orch-shot orch-verdicts__tile">
              <span className="orch-verdicts__no">{prNo(v.url) ? `#${prNo(v.url)}` : "PR"}</span>
              <span className="orch-panel__sub">{v.name}</span>
              <span>
                <Badge tone={v.tone ? VERDICT[v.tone] : "neutral"} dot>
                  {v.verdict}
                </Badge>
              </span>
            </a>
          ))}
        </div>
      </div>
    </Panel>
  );
}

const POINT_MARK = { good: "good", warn: "neutral", bad: "bad" } as const;

/** A deliverable's points: Decisions, then Findings, each one plain line with its why under it. */
export function Points({ points }: { points: readonly Point[] }) {
  const decisions = points.filter((p) => p.kind === "decision");
  const findings = points.filter((p) => p.kind === "finding");
  return (
    <div data-points="" className="grid gap-3">
      {decisions.length > 0 ? (
        <Panel kind="decisions" title="Decisions">
          {decisions.map((p, i) => (
            <Row key={i} data={{ "data-point": "decision" }} lead={p.tone ? <Mark tone={POINT_MARK[p.tone]} /> : undefined} text={p.headline} sub={p.why} />
          ))}
        </Panel>
      ) : null}
      {findings.length > 0 ? (
        <Panel kind="rca" title="Findings">
          {findings.map((p, i) => (
            <Row key={i} data={{ "data-point": "finding" }} lead={<Mark tone={p.tone ? POINT_MARK[p.tone] : "neutral"} />} text={p.headline} sub={p.why} />
          ))}
        </Panel>
      ) : null}
    </div>
  );
}

/* ---------- Diagram: the boxes are small affectUI cards ---------- */

const CHANGE = { added: { label: "Added", tone: "success", glyph: "M4 8h8M8 4v8" }, changed: { label: "Changed", tone: "info", glyph: "M4 6.5h8M4 9.5h8" }, removed: { label: "Removed", tone: "danger", glyph: "M4 8h8" }, same: { label: "Unchanged", tone: "neutral", glyph: "" } } as const;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// a 13px label runs about 6.8px a character (measured: 134px for 20); a box keeps 34px in front for its mark, 12 behind
const LABEL_PX = 6.8;
const fits = (w: number, marked: boolean, px: number) => Math.floor((w - (marked ? 34 : 12) - 12) / px + 0.05);

export function Diagram({ b }: { b: B<"diagram"> }) {
  const want = Math.max(...b.nodes.map((n) => n.label.length * LABEL_PX + (n.change !== "same" ? 34 : 12) + 12));
  const boxW = Math.ceil(Math.min(BOX_W_MAX, Math.max(BOX_W, want)));
  const { boxes, lines, width, height } = layout(b.nodes, b.edges, b.direction, boxW);
  const used = (["added", "changed", "removed"] as const).filter((c) => b.nodes.some((n) => n.change === c) || b.edges.some((e) => e.change === c));
  const mid = `orch-dg-${b.nodes.map((n) => n.id).join("-").slice(0, 40)}`;
  return (
    <Panel
      kind="diagram"
      title={b.title ?? "Diagram"}
      note={
        used.length ? (
          <span className="inline-flex gap-1.5">
            {used.map((c) => (
              <Badge key={c} tone={CHANGE[c].tone} dot>
                {CHANGE[c].label}
              </Badge>
            ))}
          </span>
        ) : undefined
      }
    >
      <div className="orch-dg">
        {/* fits the pane down to 3/4 size, then scrolls sideways rather than shrink the text further */}
        <svg role="img" aria-label={b.title ?? "Diagram"} viewBox={`0 0 ${width} ${height}`} className="block h-auto" style={{ width: "100%", maxWidth: width, minWidth: Math.round(width * 0.75) }}>
          <defs>
            {(Object.keys(CHANGE) as (keyof typeof CHANGE)[]).map((c) => (
              <marker key={c} id={`${mid}-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="orch-dg__head" data-change={c} />
              </marker>
            ))}
          </defs>
          {lines.map((l, i) => (
            <g key={i} data-edge={`${l.from}->${l.to}`}>
              <path d={l.path} className="orch-dg__edge" data-change={l.change} markerEnd={`url(#${mid}-${l.change})`} />
              {l.label ? (
                <text x={l.lx} y={l.ly - 5} textAnchor="middle" className="orch-dg__edge-label">
                  {clip(l.label, 20)}
                </text>
              ) : null}
            </g>
          ))}
          {boxes.map((n) => (
            <g key={n.id} data-node={n.id} data-change={n.change}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="8" className="orch-dg__box" data-change={n.change} />
              {n.change !== "same" ? (
                <g transform={`translate(${n.x + 10}, ${n.y + (n.h - 16) / 2})`}>
                  <rect width="16" height="16" rx="4" className="orch-dg__mark" data-change={n.change} />
                  <path d={CHANGE[n.change].glyph} transform="scale(1)" className="orch-dg__glyph" data-change={n.change} />
                </g>
              ) : null}
              <text x={n.x + (n.change !== "same" ? 34 : 12)} y={n.y + (n.note ? 22 : 30)} className="orch-dg__label" data-change={n.change}>
                {clip(n.label, fits(n.w, n.change !== "same", LABEL_PX))}
              </text>
              {n.note ? (
                <text x={n.x + (n.change !== "same" ? 34 : 12)} y={n.y + 38} className="orch-dg__note">
                  {clip(n.note, fits(n.w, n.change !== "same", 6.2))}
                </text>
              ) : null}
              <title>{`${n.label}${n.note ? `: ${n.note}` : ""} (${CHANGE[n.change].label.toLowerCase()})`}</title>
            </g>
          ))}
        </svg>
      </div>
    </Panel>
  );
}

/** The styles: affectUI's Change Summary as it ships, plus what these blocks add to it. */
export function VisualBlocksStyle() {
  return (
    <>
      <style href="ui-change-summary-clean" precedence="default">
        {changeSummaryCss}
      </style>
      <style href="orch-visual-blocks" precedence="default">
        {visualCss}
      </style>
    </>
  );
}

const visualCss = /* css */ `
[data-orch] .orch-panel { max-width: none; }
[data-orch] .orch-panel__note { display: inline-flex; align-items: center; max-width: 60%; }
[data-orch] .orch-panel__row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; padding: 10px 16px; min-height: 48px; animation: none; }
[data-orch] .orch-panel__row[data-lead] { grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; }
[data-orch] .orch-panel__text { font-weight: 500; color: var(--ui-csc-ink); overflow-wrap: anywhere; }
[data-orch] .orch-panel__sub { margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--ui-csc-muted); overflow-wrap: anywhere; }
[data-orch] .orch-panel .ui-csc__row { animation: none; }
[data-orch] .orch-panel__pair { align-items: start; padding-top: 12px; padding-bottom: 12px; }
[data-orch] .orch-panel__pair .ui-csc__change { align-items: flex-start; color: var(--ui-csc-ink); }
[data-orch] .orch-panel__pair .ui-csc__label { white-space: normal; color: var(--ui-csc-text); font-weight: 400; }
[data-orch] .orch-dg {
  --orch-dg-line: rgba(0, 0, 0, 0.22);
  --orch-dg-box-line: rgba(0, 0, 0, 0.1);
  --orch-dg-added: #007d2ee0; --orch-dg-added-bg: #00a43319;
  --orch-dg-changed: #006dcbf2; --orch-dg-changed-bg: #008ff519;
  --orch-dg-removed: #d72400da; --orch-dg-removed-bg: #f52b0018;
  overflow-x: auto;
  padding: 14px 16px 16px;
  border-top: 0.5px solid var(--ui-csc-line);
}
:where(.dark, [data-theme="dark"]) [data-orch] .orch-dg {
  --orch-dg-line: rgba(255, 255, 255, 0.24);
  --orch-dg-box-line: rgba(255, 255, 255, 0.12);
  --orch-dg-added: #5fc88a; --orch-dg-added-bg: #00f04a1f;
  --orch-dg-changed: #70b8ff; --orch-dg-changed-bg: #0077ff3a;
  --orch-dg-removed: #ff8a7a; --orch-dg-removed-bg: #ff35232b;
}
[data-orch] .orch-dg__box { fill: var(--ui-csc-card); stroke: var(--orch-dg-box-line); stroke-width: 1; }
[data-orch] .orch-dg__box[data-change="added"] { stroke: var(--orch-dg-added); }
[data-orch] .orch-dg__box[data-change="changed"] { stroke: var(--orch-dg-changed); }
[data-orch] .orch-dg__box[data-change="removed"] { stroke: var(--orch-dg-removed); stroke-dasharray: 4 3; }
[data-orch] .orch-dg__mark[data-change="added"] { fill: var(--orch-dg-added-bg); }
[data-orch] .orch-dg__mark[data-change="changed"] { fill: var(--orch-dg-changed-bg); }
[data-orch] .orch-dg__mark[data-change="removed"] { fill: var(--orch-dg-removed-bg); }
[data-orch] .orch-dg__glyph { fill: none; stroke-width: 1.4; stroke-linecap: round; }
[data-orch] .orch-dg__glyph[data-change="added"] { stroke: var(--orch-dg-added); }
[data-orch] .orch-dg__glyph[data-change="changed"] { stroke: var(--orch-dg-changed); }
[data-orch] .orch-dg__glyph[data-change="removed"] { stroke: var(--orch-dg-removed); }
[data-orch] .orch-dg__label { font-size: 13px; font-weight: 500; fill: var(--ui-csc-ink); }
[data-orch] .orch-dg__label[data-change="removed"] { text-decoration: line-through; fill: var(--ui-csc-text); }
[data-orch] .orch-dg__note { font-size: 12px; fill: var(--ui-csc-muted); }
[data-orch] .orch-dg__edge { fill: none; stroke: var(--orch-dg-line); stroke-width: 1; }
[data-orch] .orch-dg__edge[data-change="added"] { stroke: var(--orch-dg-added); }
[data-orch] .orch-dg__edge[data-change="changed"] { stroke: var(--orch-dg-changed); }
[data-orch] .orch-dg__edge[data-change="removed"] { stroke: var(--orch-dg-removed); stroke-dasharray: 4 3; }
[data-orch] .orch-dg__head { fill: var(--orch-dg-line); }
[data-orch] .orch-dg__head[data-change="added"] { fill: var(--orch-dg-added); }
[data-orch] .orch-dg__head[data-change="changed"] { fill: var(--orch-dg-changed); }
[data-orch] .orch-dg__head[data-change="removed"] { fill: var(--orch-dg-removed); }
[data-orch] .orch-dg__edge-label { font-size: 11px; fill: var(--ui-csc-muted); paint-order: stroke; stroke: var(--ui-csc-card); stroke-width: 4px; }
/* a screenshot or video in the same hairline card as the blocks */
[data-orch] .orch-shot { overflow: hidden; border-radius: 10px; background: #fff; box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
:where(.dark, [data-theme="dark"]) [data-orch] .orch-shot { background: #1c1c1e; box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4); }
[data-orch] .orch-verdicts { padding: 12px 16px 16px; border-top: 0.5px solid var(--ui-csc-line); }
[data-orch] .orch-verdicts__bar { display: flex; gap: 3px; height: 8px; border-radius: 999px; overflow: hidden; }
[data-orch] .orch-verdicts__bar > span { flex: 1; background: var(--muted-foreground, #868e96); }
[data-orch] .orch-verdicts__bar > span[data-tone="good"] { background: var(--success, #2f9e44); }
[data-orch] .orch-verdicts__bar > span[data-tone="warn"] { background: var(--warning, #f59f00); }
[data-orch] .orch-verdicts__bar > span[data-tone="bad"] { background: var(--destructive, #e03131); }
[data-orch] .orch-verdicts__tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 12px; }
[data-orch] .orch-verdicts__tile { display: grid; gap: 6px; padding: 10px 12px; color: inherit; text-decoration: none; }
[data-orch] .orch-verdicts__tile .orch-panel__sub { margin-top: 0; }
[data-orch] .orch-verdicts__no { font-weight: 650; font-variant-numeric: tabular-nums; }
[data-orch] .orch-gallery { grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); align-items: start; }
`;
