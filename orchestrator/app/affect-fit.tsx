// The fit layer (2026-11-17). affectUI's clean kit draws at 13 px and weight 500, with 2, 5, 6, 7 and 10 px steps. The
// owner's rules for these surfaces are three sizes (12 / 14 / 16), two weights (400 / 600) and a 4 px grid. This block
// brings the kit's components onto those rules through their own CSS variables and a few scoped rules, so the vendored
// files stay as they came and the surfaces can be built from the kit instead of look-alikes.
// It reaches three places only: the Projects and Scope tabs (.orch-cc), the tab strip (a pane's header) and the bar to
// the CoS. Every other tab keeps the kit as it is.
import { styleHref } from "./style-href.ts";

const S = "[data-orch] :is(.orch-cc, [data-pane] > header, [data-cos-composer])";

export const fitCss = /* css */ `
/* the kit's theme hooks: its ink and its muted grey are the plugin's (the kit's own muted is too faint on white) */
${S} { --aui-ink: var(--orch-ink); --aui-muted: var(--orch-muted); }

/* Button: 14 px (12 px small), 600, padding and gap on the grid */
${S} .ui-buttonc { --px: 12px; --gap: 4px; --fs: 14px; --lh: 20px; font-weight: 600; }
${S} .ui-buttonc[data-size="sm"] { --px: 8px; --fs: 12px; --lh: 16px; }
${S} .ui-buttonc[data-size="lg"] { --gap: 8px; }
${S} .ui-buttonc[data-icon-left] { padding-left: calc(var(--px) - 4px); }
${S} .ui-buttonc[data-icon-right] { padding-right: calc(var(--px) - 4px); }
${S} .ui-buttonc[data-icon-only] { padding: 0; }

/* Badge: 12 px, 400 (a loud one says so with its fill, not its weight), 20 px high */
${S} .ui-bdgc, ${S} .ui-bdgc[data-size="md"] { --h: 20px; --pad: 8px; --lead: 4px; --mark: 12px; gap: 4px; font-size: 12px; line-height: 16px; font-weight: 400; }
${S} .ui-bdgc[data-count] { padding: 0 4px; }
${S} .ui-bdgc__dot { margin: 0; }
/* its coloured words, a shade darker in light mode: at 12 px on their own tint the kit's read under 4.5 to 1 */
${S} .ui-bdgc { --ui-bdgc-info-fg: light-dark(#0059b3, #70b8ff); --ui-bdgc-success-fg: light-dark(#006b27, #5fc88a); --ui-bdgc-warning-fg: light-dark(#8f4b00, #ffb35c); --ui-bdgc-danger-fg: light-dark(#b31e00, #ff8a7a); --ui-bdgc-purple-fg: light-dark(#7a2bc4, #c9a2f5); }

/* Card: 14 px body, a 14 px / 600 title, 4 px between title and description */
${S} .ui-crdc { font-size: 14px; }
${S} .ui-crdc__titles { gap: 4px; }
${S} .ui-crdc__title { font-size: 14px; font-weight: 600; }
${S} .ui-crdc__desc { font-size: 14px; }
/* a card that is one click target: its title's button, which the kit stretches over the card, is 24 px high by itself */
${S} .ui-crdc[data-interactive] .ui-crdc__title { line-height: 24px; }

/* Segmented control: one weight for every option (the control measures its labels, so a heavier chosen one would move
   them), 12 px counts, 24 px options in a 4 px tray */
/* (a touch screen keeps the kit's own larger sizes: its 40 px options, its 16 px field text) */
@media not (pointer: coarse) {
  ${S} .ui-segc { --ui-segc-h: 32px; }
  ${S} .ui-tac { --fs: 14px; --lh: 20px; }
  ${S} .ui-tfc, ${S} .ui-tfc[data-size] { --fs: 14px; }
}
${S} .ui-segc { --ui-segc-px: 12px; --ui-segc-fs: 14px; --ui-segc-lh: 20px; --ui-segc-pad: 4px; --ui-segc-gap: 8px; font-weight: 400; }
${S} .ui-segc[data-size="sm"] { --ui-segc-px: 8px; --ui-segc-fs: 12px; --ui-segc-lh: 16px; --ui-segc-gap: 4px; }
${S} .ui-segc .ui-segc__content { gap: 4px; }
${S} .ui-segc .ui-segc__count, ${S} .ui-segc .ui-segc__badge { height: 16px; padding: 0 4px; font-size: 12px; line-height: 16px; font-weight: 400; }
${S} .orch-tab-label { column-gap: 4px; }

/* Text area and text field: 14 px, 8 / 12 px inside, 4 px to the label, 8 px to the line under it */
${S} .ui-tac { gap: 4px; font-size: 14px; }
${S} .ui-tac__input { padding: 8px 12px; }
${S} .ui-tac__head, ${S} .ui-tfc__head { gap: 8px; }
${S} .ui-tac__label, ${S} .ui-tfc__label { font-weight: 600; }
${S} .ui-tfc, ${S} .ui-tfc[data-size] { --px: 12px; gap: 4px; font-size: 14px; }
${S} .ui-tfc[data-size="sm"] { --px: 8px; }
${S} .ui-tfc__box { gap: 8px; }

/* Empty state: a 14 px / 600 title over 14 px words; its frame as the kit draws it, its two odd steps on the grid */
${S} .ui-estc { font-size: 14px; }
${S} .ui-estc__title { font-weight: 600; }
${S} .ui-estc__action { margin-top: 16px; }
@media (max-width: 560px) { ${S} .ui-estc:not([data-bare]) { padding: 36px 16px 40px; } }

/* Checkbox: 14 px, the box 8 px from its words */
@media not (pointer: coarse) { ${S} .ui-chkc { font-size: 14px; } }
${S} .ui-chkc__row { gap: 8px; }

/* Menu: 14 px rows, a 600 mark on the chosen one, steps on the grid */
${S} .ui-dmc { --ui-dmc-danger: var(--orch-danger); }
${S} .ui-dmc__panel { font-size: 14px; }
${S} .ui-dmc__title { padding: 4px 12px; font-weight: 600; }
/* its title and an item's second line in the muted grey that reads (the kit's faint stays for a disabled item) */
${S} .ui-dmc__title, ${S} .ui-dmc__item:not([aria-disabled="true"]) .ui-dmc__desc { color: var(--orch-muted); }
${S} .ui-dmc__list { gap: 0; }
${S} .ui-dmc__item { gap: 8px; padding: 0 12px; }
${S} .ui-dmc__item[data-rich] { padding: 4px 12px; }
${S} .ui-dmc__item[aria-checked="true"] { font-weight: 600; }
${S} .ui-dmc__label { gap: 0; }
${S} .ui-dmc__sep { margin: 4px 8px; }
${S} .ui-dmc__empty { padding: 4px 8px; }
`;

/** The fit layer's style block: once, at the app's root. */
export function AffectFit() {
  return (
    <style href={styleHref("orch-affect-fit", fitCss)} precedence="default">
      {fitCss}
    </style>
  );
}
