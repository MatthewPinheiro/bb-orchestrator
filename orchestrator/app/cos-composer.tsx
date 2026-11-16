// Requested 2026-11-13: "a way to also from the Orchestrator page to send a message quickly to the CoS". One line under the
// tabs on every view: type, then Send (or ⌘/Ctrl+Enter). It lands in the CoS's chat as the owner's own message.
import { useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { WRITES, type Board, type cosMessageBody } from "../contract.ts";
import { TextArea } from "./affect/text-area-clean.tsx";
import { MonSprite } from "./mon.tsx";
import { useGate, write, gate } from "./store.ts";
import { Btn } from "./ui.tsx";

/** The box's placeholder: the full hint with its shortcut on a desktop page, just "Message…" on the phone-width page (no ⌘/Ctrl there). */
const PLACEHOLDER = { full: "Message the Chief of Staff…  (⌘/Ctrl+Enter to send)", compact: "Message…" };

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
    <section data-cos-composer="" className="orch-wash mb-4 rounded-lg p-2.5">
      <div className="flex items-start gap-2.5">
        <MonSprite mon={cos?.mon ?? null} address="cos" size={28} />
        <div className="min-w-0 flex-1">
          <TextArea
            data-cos-text=""
            aria-label="Message the Chief of Staff"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (result) setResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            minRows={1}
            maxRows={6}
            maxLength={8000}
            disabled={!cos}
            placeholder={cos ? (compact ? PLACEHOLDER.compact : PLACEHOLDER.full) : "No Chief of Staff is running: start it from the Projects tab"}
          />
        </div>
        <Btn data-cos-send="" disabled={busy || !cos || text.trim() === ""} onClick={() => void send()}>
          Send
        </Btn>
      </div>
      {result ? (
        <p role="status" data-cos-result={result.ok ? "sent" : "error"} data-queued={result.ok && result.queued ? "" : undefined} className={result.ok ? "orch-muted m-0 mt-1.5 pl-10 text-xs" : "orch-danger m-0 mt-1.5 pl-10 text-xs"}>
          {result.ok ? (
            <>
              {result.queued ? "Queued: the CoS is mid-turn and reads it when that turn ends." : "Sent to the CoS."}{" "}
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline" onClick={() => cos && navigate.toThread(cos.threadId)}>
                Open its chat
              </button>
            </>
          ) : (
            result.message
          )}
        </p>
      ) : null}
    </section>
  );
}
