// The command center's lines (2026-11-16, the v2 row), shared by the Projects row and the project page: the CSS and a
// wait line. Three type sizes (16 / 14 / 12), two weights (400 / 600), spacing in steps of 4, colour only on three dots:
// green (moving), red (blocked), amber (a wait older than 4 h). Every line starts on one left edge; dots hang in a 16 px
// gutter. 2026-11-17 (the shadcn pass): the dots are bb's success, destructive and warning tokens, and the tab's buttons,
// filters and confirm are app/ui's. On a narrow panel (a phone) every line wraps and nothing is cut; on a wide one a shortened line carries its
// full text as a title.
import { styleHref } from "./style-href.ts";
import type { SummaryWait } from "../contract.ts";
import { waitLine } from "./command-center.ts";
import { RefText } from "./ref-text.tsx";
import { cx } from "./ui.tsx";

export const ccCss = /* css */ `
[data-orch] .orch-cc {
  --cc-moving: var(--success);
  --cc-blocked: var(--destructive);
  --cc-old: var(--warning);
  --cc-edge: color-mix(in srgb, var(--foreground) 16%, transparent);
  container: orchcc / inline-size;
  font-size: 14px; line-height: 20px; font-weight: 400;
}
[data-orch] .orch-cc * { box-sizing: border-box; }
[data-orch] .orch-cc b, [data-orch] .orch-cc strong { font-weight: 600; }
/* the tab's own buttons start bare; a shadcn one (data-slot, 2026-11-17) keeps its look */
[data-orch] .orch-cc button:where(:not([data-slot])) { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: start; }
[data-orch] .orch-cc ul { list-style: none; margin: 0; padding: 0; }
[data-orch] .orch-cc .muted { color: var(--orch-muted); }
[data-orch] .orch-cc .small { font-size: 12px; line-height: 16px; }
[data-orch] .orch-cc .bar { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; color: var(--orch-muted); }
[data-orch] .orch-cc .bar .right { margin-left: auto; }
[data-orch] .orch-cc .standing { font-size: 12px; line-height: 16px; margin-bottom: 16px; }
[data-orch] .orch-cc .group-h { margin: 24px 0 0; padding-bottom: 8px; font-size: 12px; line-height: 16px; font-weight: 400; color: var(--orch-muted); border-bottom: 1px solid var(--orch-line); }
[data-orch] .orch-cc .proj { position: relative; padding-block: 16px; border-bottom: 1px solid var(--orch-line); display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
[data-orch] .orch-cc .ln { display: flex; align-items: baseline; gap: 8px; padding-left: 16px; position: relative; min-width: 0; }
[data-orch] .orch-cc .ln .tx { flex: 0 1 auto; min-width: 0; max-width: 576px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .orch-cc .ln .tail { margin-left: auto; flex: none; color: var(--orch-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
[data-orch] .orch-cc .lead { color: var(--orch-muted); }
[data-orch] .orch-cc .dot { position: absolute; left: 0; top: 6px; width: 8px; height: 8px; border-radius: 50%; }
[data-orch] .orch-cc .dot.moving { background: var(--cc-moving); }
[data-orch] .orch-cc .dot.blocked { background: var(--cc-blocked); }
[data-orch] .orch-cc .dot.old { background: var(--cc-old); }
[data-orch] .orch-cc .dot.none { box-shadow: inset 0 0 0 1px var(--orch-muted); }
[data-orch] .orch-cc .proj.headed { flex-direction: row; gap: 8px; align-items: flex-start; }
[data-orch] .orch-cc .proj.headed > .body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
[data-orch] .orch-cc .proj.headed > .face { flex: none; width: 32px; height: 24px; display: flex; justify-content: center; align-items: center; }
[data-orch] .orch-cc .proj.headed > .face button { display: inline-flex; }
[data-orch] .orch-cc .proj.headed { padding-left: 8px; }
/* no left bar on a loud row (2026-11-16, the owner: "remove the vertical line"): its pill or red dot says it */
[data-orch] .orch-cc .who { color: var(--orch-muted); margin-left: 8px; }
[data-orch] .orch-cc .title { font-size: 16px; line-height: 24px; }
[data-orch] .orch-cc .title .tx { max-width: none; flex: 1 1 auto; }
[data-orch] .orch-cc .name { font-weight: 600; }
[data-orch] .orch-cc .name:hover { text-decoration: underline; text-underline-offset: 4px; }
[data-orch] .orch-cc .now { margin-left: 8px; }
[data-orch] .orch-cc .acts { display: flex; gap: 4px; flex: none; font-size: 14px; line-height: 20px; align-self: center; }
[data-orch] .orch-cc .unread { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--orch-ink); margin-left: 4px; vertical-align: 1px; }
[data-orch] .orch-cc .warn { color: var(--orch-ink); font-weight: 600; }
[data-orch] .orch-cc .quiet .proj { padding-block: 8px; }
[data-orch] .orch-cc .quiet .title { font-size: 14px; line-height: 20px; }
[data-orch] .orch-cc .quiet .now { color: var(--orch-muted); }
@container orchcc (max-width: 640px) {
  [data-orch] .orch-cc .bar .right { margin-left: 0; flex-basis: 100%; }
  [data-orch] .orch-cc .ln { display: block; }
  [data-orch] .orch-cc .ln .tx { white-space: normal; overflow: visible; max-width: none; }
  [data-orch] .orch-cc .ln .tail { margin-left: 0; white-space: normal; }
  [data-orch] .orch-cc .ln .tail::before { content: " · "; }
  [data-orch] .orch-cc .title { display: flex; flex-wrap: wrap; gap: 0 8px; }
  [data-orch] .orch-cc .title .tx { flex: 1 1 100%; order: 2; }
  [data-orch] .orch-cc .title .name { display: block; padding-right: 48px; line-height: 32px; }
  [data-orch] .orch-cc .title .now { display: block; margin-left: 0; }
  [data-orch] .orch-cc .title .acts { position: absolute; right: 0; top: 16px; }
  [data-orch] .orch-cc .quiet .title .acts { top: 8px; }
}
`;

const OLD_TITLE = "waited on for more than 4 hours";
const SOURCE_TITLE = { lead: "lead said: from the lead's own status", live: "live: read from cards, mail and pull requests just now" } as const;

/** One "Waiting on" line: the amber dot when old, the words, then its age and source. */
export function WaitLineView({ w, now, cos }: { w: SummaryWait; now: number; cos: string }) {
  const l = waitLine(w, now, cos);
  const full = `Waiting on ${l.text}${l.note ? ` (${l.note})` : ""}`;
  return (
    <div className="ln" data-wait-line={w.kind} data-wait-source={w.source}>
      {l.old ? <i className="dot old" title={OLD_TITLE} /> : null}
      <span className="tx" title={full}>
        <span className="lead">Waiting on</span>{" "}
        <RefText text={l.text} exact={w.ref} />
        {l.note ? <b className="warn"> ({l.note})</b> : null}
      </span>
      <span className="tail" title={SOURCE_TITLE[l.source]}>
        {l.tail}
      </span>
    </div>
  );
}

/** The project page's every wait, in the row's words (the row shows two). */
export function AllWaits({ waits, now, cos }: { waits: SummaryWait[]; now: number; cos: string }) {
  if (!waits.length) return null;
  return (
    <section data-all-waits={waits.length} className={cx("orch-cc", "flex flex-col gap-1")}>
      <style href={styleHref("orch-cc", ccCss)} precedence="default">
        {ccCss}
      </style>
      {waits.map((w, i) => (
        <WaitLineView key={`${w.kind}|${w.ref ?? i}`} w={w} now={now} cos={cos} />
      ))}
    </section>
  );
}
