// The cheat sheet (?), the bottom-of-page note, and the selection's look. All drawn fixed or as outlines, so no card moves.
import { styleHref } from "./style-href.ts";
import { useEffect, useRef } from "react";
import { KEYMAP } from "./keys.ts";
import { keyState, emitKeys, useKeys } from "./key-state.ts";

export const keysCss = `
[data-orch] [data-card][data-selected], [data-orch] [data-deliverable][data-selected] { outline: 2px solid var(--orch-accent, #4f7cff); outline-offset: 2px; border-radius: 8px; }
[data-orch] [data-key] { position: relative; }
[data-orch] [data-key]::after { content: attr(data-key); position: absolute; top: -7px; left: -5px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; font-size: 10px; line-height: 14px; text-align: center; background: var(--orch-accent, #4f7cff); color: #fff; pointer-events: none; }
[data-orch] [data-key-note] { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 50; padding: 6px 12px; border-radius: 8px; font-size: 13px; background: #222; color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
[data-orch] [data-key-help] { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(0,0,0,.45); }
[data-orch] [data-key-help] > div { max-width: min(520px, 92vw); max-height: 88vh; overflow: auto; padding: 16px 20px; border-radius: 12px; background: Canvas; color: CanvasText; box-shadow: 0 8px 40px rgba(0,0,0,.4); }
[data-orch] [data-key-help] table { border-collapse: collapse; width: 100%; font-size: 13px; }
[data-orch] [data-key-help] td { padding: 4px 8px 4px 0; vertical-align: top; }
[data-orch] [data-key-help] kbd { font: 600 12px ui-monospace, monospace; padding: 1px 6px; border: 1px solid currentColor; border-radius: 4px; white-space: nowrap; opacity: .85; }
`;

export function ShortcutUi() {
  useKeys();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (keyState.help) box.current?.focus();
  });
  return (
    <>
      <style href={styleHref("orch-keys", keysCss)} precedence="default">
        {keysCss}
      </style>
      {keyState.note ? (
        <div role="status" data-key-note="">
          {keyState.note}
        </div>
      ) : null}
      {keyState.help ? (
        <div data-key-help="" onClick={() => ((keyState.help = false), emitKeys())}>
          <div ref={box} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <h2 className="m-0 mb-2 text-base">Keyboard shortcuts</h2>
            <table>
              <tbody>
                {KEYMAP.map((k) => (
                  <tr key={k.keys}>
                    <td>
                      <kbd>{k.keys}</kbd>
                    </td>
                    <td>
                      {k.does}
                      <span className="opacity-60"> · {k.where}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 mt-3 text-xs opacity-70">Single keys are off while you type in a box. Esc closes this.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
