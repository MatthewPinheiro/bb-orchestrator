// Requested 2026-11-13: "a way to also from the Orchestrator page to send a message quickly to the CoS". One line under the
// tabs on every view: type, then Send (or ⌘/Ctrl+Enter). It lands in the CoS's chat as the owner's own message.
// 1.16.0: the bar is affectUI's text area and its primary button and nothing around them (the grey slab is gone), the
// same field-with-Send as the chat with a lead. The shortcut is Send's tooltip, not words in the box.
import { useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { WRITES, type Board, type cosMessageBody } from "../contract.ts";
import { TextArea } from "./affect/text-area-clean.tsx";
import { MonSprite } from "./mon.tsx";
import { useGate, write, gate } from "./store.ts";
import { Btn } from "./ui.tsx";
import { styleHref } from "./style-href.ts";

const cosCss = /* css */ `
[data-orch] [data-cos-composer] { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
[data-orch] [data-cos-composer] .orch-cos__row { display: flex; align-items: flex-start; gap: 8px; }
[data-orch] [data-cos-composer] .orch-cos__row > .ui-tac { flex: 1 1 auto; min-width: 0; }
/* Send is 28 px beside a 36 px one-line field: 4 px down centres it on the first line, where it stays as the field grows */
[data-orch] [data-cos-composer] .orch-cos__send { flex: none; margin-top: 4px; }
[data-orch] [data-cos-composer] .orch-cos__result { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0; padding-left: 44px; font-size: 12px; line-height: 16px; color: var(--orch-muted); }
[data-orch] [data-cos-composer] .orch-cos__result[data-cos-result="error"] { color: var(--orch-danger); }
`;

/** The box's placeholder: who it reaches on a desktop page, just "Message…" on the phone-width page. */
const PLACEHOLDER = { full: "Message the Chief of Staff…", compact: "Message…" };

export function CosComposer({ agents, refetchAll, compact = false }: { agents: Board["agents"] | undefined; refetchAll: () => void; compact?: boolean }) {
  useGate();
  const navigate = useBbNavigate();
  const cos = agents?.find((a) => a.address === "cos") ?? null;
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: true; queued: boolean } | { ok: false; message: string } | null>(null);
  const busy = gate.lock !== null;

  const send = async () => {
    const t = text.trim();
    if (!t || busy || !cos) return;
    const body: z.input<typeof cosMessageBody> = { text: t };
    const out = await write(WRITES.cosMessage, body, { kind: "other", where: "cos", after: refetchAll });
    if (!out) return;
    if (out.ok) {
      setText("");
      // the CoS mid-turn (or waiting on a question to the owner): bb queues it until that turn ends
      setResult({ ok: true, queued: (out.result as { delivery?: string } | null)?.delivery === "queued" });
    } else setResult({ ok: false, message: out.message });
  };

  return (
    <section data-cos-composer="">
      <style href={styleHref("orch-cos", cosCss)} precedence="default">
        {cosCss}
      </style>
      <div className="orch-cos__row">
        <MonSprite mon={cos?.mon ?? null} address="cos" size={28} />
        <TextArea
          data-cos-text=""
          aria-label="Message the Chief of Staff"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (result) setResult(null);
          }}
          onSubmitShortcut={() => void send()}
          minRows={1}
          maxRows={6}
          maxLength={8000}
          disabled={!cos}
          // the usual hint while the agents load: "No Chief of Staff" only once the read says so (it wrapped to two lines
          // on the phone-width page, so the bar changed height as the page loaded)
          placeholder={cos || !agents ? (compact ? PLACEHOLDER.compact : PLACEHOLDER.full) : "No Chief of Staff is running: start it from the Projects tab"}
        />
        <Btn tone="primary" className="orch-cos__send" data-cos-send="" title="Send (⌘/Ctrl+Enter)" disabled={busy || !cos || text.trim() === ""} onClick={() => void send()}>
          Send
        </Btn>
      </div>
      {result ? (
        <p role="status" className="orch-cos__result" data-cos-result={result.ok ? "sent" : "error"} data-queued={result.ok && result.queued ? "" : undefined}>
          {result.ok ? (
            <>
              {result.queued ? "Queued: the CoS is mid-turn and reads it when that turn ends." : "Sent to the CoS."}
              <Btn tone="ghost" size="sm" onClick={() => cos && navigate.toThread(cos.threadId)}>
                Open its chat
              </Btn>
            </>
          ) : (
            result.message
          )}
        </p>
      ) : null}
    </section>
  );
}
