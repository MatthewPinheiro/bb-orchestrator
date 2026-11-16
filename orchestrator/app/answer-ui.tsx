// The answer parts of a Needs you card, in affectUI's clean style (2026-11-13: "make this look more affectui
// like"; "other should just be an open text box and command enter should send it"). Short answers are the decision
// inbox's chips, the recommended one the dark chip. Answers that explain themselves are affectUI Card tiles: the
// answer, a quiet line under it, a Recommended badge. Context waits behind a quiet "More", instead of a box with its own
// scrollbar. "Other" is a text box that is always open; ⌘/Ctrl+Enter in it sends.
import { useState, type ReactNode } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { Badge } from "./affect/badge-clean.tsx";
import { Card, CardHeader } from "./affect/card-clean.tsx";
import { TextArea } from "./affect/text-area-clean.tsx";
import { cx } from "./ui.tsx";

export type Opt = {
  key: string;
  label: string;
  detail?: string | null;
  recommended?: boolean;
  /** Multi-pick: whether it is ticked (undefined for an option that answers at once) */
  pressed?: boolean;
  /** data-* attributes for the button (the tests and the arming read them) */
  data: Record<string, string | undefined>;
  onPick: () => void;
};

/** Tiles when any answer explains itself or is long; chips otherwise. Recommended first. */
export function Options({ options, disabled, label = "Options" }: { options: Opt[]; disabled: boolean; label?: string }) {
  const sorted = [...options].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
  const tiles = sorted.some((o) => (o.detail && o.detail.trim() !== "") || o.label.length > 32);
  if (!tiles) {
    return (
      <div role="group" aria-label={label} className="ui-dic__actions">
        {sorted.map((o) => (
          <button
            key={o.key}
            type="button"
            className={cx("ui-dic__btn", (o.pressed ?? o.recommended) && "ui-dic__btn--primary")}
            aria-pressed={o.pressed}
            disabled={disabled}
            onClick={o.onPick}
            {...o.data}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="group" aria-label={label} className="orch-tiles" data-tiles="">
      {sorted.map((o) => (
        <Card key={o.key} interactive={!disabled} selected={o.pressed} className="orch-tile" data-disabled={disabled || undefined}>
          <CardHeader
            titleAs="p"
            title={
              <button type="button" aria-pressed={o.pressed} disabled={disabled} onClick={o.onPick} {...o.data}>
                {o.label}
              </button>
            }
            description={o.detail || undefined}
          >
            {/* under the text, so a narrow tile never squeezes its title beside the badge */}
            {o.recommended || o.pressed ? (
              <span className="orch-tile__badges">
                {o.recommended ? <Badge tone="info">Recommended</Badge> : null}
                {o.pressed ? <Badge tone="neutral">Picked</Badge> : null}
              </span>
            ) : null}
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

/** Context, and the parts that explain rather than act: always closed behind a quiet "More" (2026-11-14, no prose on cards). */
export function Details({ markdown, children }: { markdown: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="orch-details" data-context="" data-open={open ? "" : undefined}>
      <button type="button" className="orch-details__toggle" data-more="" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-open={open || undefined}>
          <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {open ? "Less" : "More"}
      </button>
      {open ? (
        <div className="orch-md">
          {markdown ? <Markdown content={markdown} /> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** "Other": always open. ⌘/Ctrl+Enter sends from inside it; the Send button is for phones. */
export function OtherBox({ value, onChange, onSend, disabled, placeholder, sendLabel = "Send" }: { value: string; onChange: (v: string) => void; onSend: () => void; disabled: boolean; placeholder: string; sendLabel?: string }) {
  return (
    <div className="orch-other">
      <TextArea
        data-note=""
        aria-label="Your own answer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!disabled && value.trim() !== "") onSend();
          }
        }}
        // a fixed height (minRows = maxRows): typing never grows the card and moves the ones below
        minRows={2}
        maxRows={2}
        maxLength={4000}
        placeholder={placeholder}
      />
      <button type="button" className="ui-dic__btn orch-other__send" data-note-send="" disabled={disabled || value.trim() === ""} onClick={onSend}>
        {sendLabel}
      </button>
    </div>
  );
}

export const answerCss = /* css */ `
[data-orch] .orch-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 2px 0 0; font-size: 12px; line-height: 16px; color: var(--ui-dic-muted); overflow-wrap: anywhere; }
[data-orch] .orch-when { flex: none; width: 7rem; text-align: right; white-space: nowrap; font-size: 12px; line-height: 20px; color: var(--ui-dic-muted); }
[data-orch] .orch-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 8px; margin-top: 12px; }
[data-orch] .orch-tile { --ui-crdc-pad: 12px; --ui-crdc-surface: var(--ui-dic-card); }
[data-orch] .orch-tile__badges { display: flex; gap: 6px; margin-top: 6px; }
[data-orch] .orch-tile[data-disabled] { opacity: 0.6; }
[data-orch] .orch-tile .ui-crdc__head { gap: 8px; }
[data-orch] .orch-tile .ui-crdc__title button:disabled { cursor: default; }
[data-orch] .orch-details { margin-top: 8px; }
[data-orch] .orch-details__toggle { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0; border: 0; background: none; font: inherit; font-size: 12px; font-weight: 500; color: var(--ui-dic-muted); cursor: pointer; }
[data-orch] .orch-details__toggle:hover { color: var(--ui-dic-ink); }
[data-orch] .orch-details__toggle svg { transition: transform 160ms var(--ui-dic-ease); }
[data-orch] .orch-details__toggle svg[data-open] { transform: rotate(90deg); }
[data-orch] .orch-md { margin-top: 4px; padding-left: 12px; border-left: 0.5px solid var(--ui-dic-line); color: var(--ui-dic-text); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
[data-orch] .orch-md :where(p, li, td, th, blockquote) { font-size: 13px !important; line-height: 20px !important; }
[data-orch] .orch-md :where(p) { margin: 0 0 6px !important; }
[data-orch] .orch-md :where(ul, ol) { margin: 0 0 6px !important; padding-left: 18px !important; }
[data-orch] .orch-md :where(li) { margin: 2px 0 !important; }
[data-orch] .orch-md :where(h1, h2, h3, h4) { margin: 8px 0 4px !important; font-size: 13px !important; line-height: 20px !important; font-weight: 500; color: var(--ui-dic-ink); }
[data-orch] .orch-md > :last-child, [data-orch] .orch-md > * > :last-child { margin-bottom: 0 !important; }
[data-orch] .orch-q { border-top: 0.5px solid var(--ui-dic-line); }
[data-orch] .orch-other { position: relative; margin-top: 12px; }
[data-orch] .orch-other textarea { padding-right: 76px; }
[data-orch] .orch-other__send { position: absolute; right: 6px; bottom: 6px; }
[data-orch] .orch-other__send:disabled { opacity: 0.45; cursor: default; }
`;
