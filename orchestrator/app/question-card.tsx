// An agent's own question (Claude Code's AskUserQuestion, held by bb as a user_question interaction) drawn as a Needs
// you card (2026-11-13), in the same parts as their orchestrator cards (answer-ui.tsx; a shadcn Card since 2026-11-17). One question with
// one pick: an option answers at once. Several questions or multi-select: options toggle and "Send my answers" sends
// them together. Where the question allows his own text, "Other" is an open box; ⌘/Ctrl+Enter in it sends.
import { useState } from "react";
import type { NeedsYou } from "../contract.ts";
import type { Answers } from "../interactions.ts";
import { KIND_TONES, css } from "./palette.ts";
import { META, OtherBox, Options, WHEN } from "./answer-ui.tsx";
import { AgentFace, type Face } from "./face.tsx";
import { gate } from "./store.ts";
import { Card } from "./ui/card.tsx";
import { cn } from "./ui/utils.ts";
import { Btn, Tag, when } from "./ui.tsx";

type Interaction = NeedsYou["interactions"][number];

/** The arming and write-lock key of a question card (orchestrator cards use their decision id). */
export const ixKey = (i: { id: string }) => `ix:${i.id}`;

/** Every required question has a pick or his own text. */
export function complete(i: Interaction, picks: Answers): boolean {
  return i.questions.every((q) => !q.required || (picks[q.id]?.selected.length ?? 0) > 0 || Boolean(picks[q.id]?.freeText?.trim()));
}

const REC = /\s*\(recommended\)\s*$/i;

export function QuestionCard({ ix, isArmed, mon, onSend, onOpen }: { ix: Interaction; isArmed: boolean; mon: Face | null; onSend: (answers: Answers) => void; onOpen: () => void }) {
  const [picks, setPicks] = useState<Answers>({});
  const key = ixKey(ix);
  const lock = gate.lock;
  const busy = lock !== null;
  const mine = lock && lock.cardId === key && lock.ok !== false;
  const notice = busy ? null : gate.error?.where === key ? gate.error.message : null;
  // one question, one pick: the option is the answer
  const instant = ix.questions.length === 1 && !ix.questions[0]!.multiSelect;
  const ready = complete(ix, picks);

  const pick = (qid: string, value: string, multi: boolean) =>
    setPicks((p) => {
      const cur = p[qid]?.selected ?? [];
      const selected = multi ? (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]) : cur[0] === value ? [] : [value];
      return { ...p, [qid]: { ...p[qid], selected } };
    });
  const setText = (qid: string, text: string) => setPicks((p) => ({ ...p, [qid]: { selected: p[qid]?.selected ?? [], freeText: text } }));

  return (
    <Card role="article" data-card={key} data-rev={0} data-question-card={ix.id} data-thread={ix.threadId} data-state={mine ? "answered" : "open"} aria-busy={busy || undefined} className={cn("gap-0 p-4", mine && "opacity-80")}>
          <header className="flex items-start gap-3">
            <AgentFace face={mon} address={ix.address} size={28} />
            <div className="min-w-0 flex-1">
              <h4 className="m-0 text-sm leading-5 font-semibold [overflow-wrap:anywhere]">{ix.questions.length === 1 ? (ix.questions[0]!.shortLabel ?? ix.title) : ix.title}</h4>
              <p className={META}>
                <span className="orch-mono">{ix.address}</span>
                <span aria-hidden>·</span>
                <span>asked in its chat</span>
                {ix.questions.length > 1 ? <Tag>{`${ix.questions.length} questions`}</Tag> : null}
              </p>
            </div>
            <span data-mark={mine ? "" : undefined} className={cn(WHEN, mine && "font-medium")} style={{ color: mine ? css(KIND_TONES.done) : undefined }}>
              {mine ? "Answered ✓" : ix.since ? when(ix.since) : null}
            </span>
          </header>
          {notice ? (
            <p role="status" data-notice="" className="orch-danger m-0 mt-2 text-xs">
              {notice}
            </p>
          ) : null}

          {ix.questions.map((q, n) => {
            const sel = picks[q.id]?.selected ?? [];
            return (
              <div key={q.id} data-question={q.id} className={n > 0 ? "mt-4 border-t pt-3" : "mt-2"}>
                <p data-question-text="" className="m-0 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {ix.questions.length > 1 && q.shortLabel ? <span className="font-medium">{q.shortLabel}: </span> : null}
                  {q.prompt}
                  {q.multiSelect ? <span className="text-xs"> · pick any</span> : null}
                </p>
                <Options
                  label={q.shortLabel ?? "Options"}
                  disabled={busy}
                  options={q.options.map((o) => ({
                    key: o.value,
                    label: o.label.replace(REC, ""),
                    detail: o.description && o.description !== o.label ? o.description : null,
                    recommended: REC.test(o.label),
                    pressed: instant ? undefined : sel.includes(o.value),
                    data: { "data-ix-option": o.value, "data-armed": isArmed ? "true" : "false" },
                    onPick: () => (instant ? onSend({ [q.id]: { selected: [o.value] } }) : pick(q.id, o.value, q.multiSelect)),
                  }))}
                />
                {q.allowFreeText ? (
                  <OtherBox
                    value={picks[q.id]?.freeText ?? ""}
                    onChange={(v) => setText(q.id, v)}
                    disabled={busy}
                    // one question: the text is the answer. Several: ⌘↵ sends them all once each is answered.
                    onSend={() => (instant ? onSend({ [q.id]: { selected: [], freeText: picks[q.id]!.freeText! } }) : ready && onSend(picks))}
                    sendLabel={instant ? "Send" : "Send all"}
                    placeholder={instant ? "Other: your own answer. ⌘↵ sends" : "Other: your own answer. ⌘↵ sends all answers"}
                  />
                ) : null}
              </div>
            );
          })}

          <footer className="mt-3 flex items-center gap-2">
            <Btn tone="ghost" data-ix-open="" onClick={onOpen}>
              Open its chat
            </Btn>
            <span className="ml-auto" />
            {!instant ? (
              <Btn data-ix-send="" disabled={busy || !ready} onClick={() => onSend(picks)}>
                Send my answers
              </Btn>
            ) : null}
          </footer>
    </Card>
  );
}
