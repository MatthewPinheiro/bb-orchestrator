// The cheat sheet (?), the bottom-of-page note, and the selection's look. All drawn fixed or as outlines, so no card moves.
// 2026-11-17: the cheat sheet is shadcn's Dialog with a Table of Kbd keys, and every colour is bb's own token. The Dialog
// renders outside the panel, so app.tsx's key handler also takes keys while the focus is in it ([data-key-help]).
import { styleHref } from "./style-href.ts";
import { KEYMAP } from "./keys.ts";
import { keyState, emitKeys, useKeys } from "./key-state.ts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { Kbd } from "./ui/kbd.tsx";
import { Table, TableBody, TableCell, TableRow } from "./ui/table.tsx";

export const keysCss = `
[data-orch] [data-card][data-selected], [data-orch] [data-deliverable][data-selected] { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 8px; }
[data-orch] [data-key] { position: relative; }
[data-orch] [data-key]::after { content: attr(data-key); position: absolute; top: -8px; left: -6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; font-size: 12px; font-weight: 500; line-height: 16px; text-align: center; background: var(--primary); color: var(--primary-foreground); pointer-events: none; }
`;

export function ShortcutUi() {
  useKeys();
  return (
    <>
      <style href={styleHref("orch-keys", keysCss)} precedence="default">
        {keysCss}
      </style>
      {keyState.note ? (
        <div role="status" data-key-note="" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-sm text-background shadow-lg">
          {keyState.note}
        </div>
      ) : null}
      <Dialog
        open={keyState.help}
        onOpenChange={(open) => {
          keyState.help = open;
          emitKeys();
        }}
      >
        <DialogContent data-key-help="" className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
            <DialogDescription>Single keys are off while you type in a box. Esc closes this.</DialogDescription>
          </DialogHeader>
          <Table>
            <TableBody>
              {KEYMAP.map((k) => (
                <TableRow key={k.keys} className="hover:bg-transparent">
                  <TableCell className="w-0 align-top">
                    <Kbd>{k.keys}</Kbd>
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {k.does}
                    <span className="text-muted-foreground"> · {k.where}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  );
}
