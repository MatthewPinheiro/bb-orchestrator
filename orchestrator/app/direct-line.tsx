// The owner's direct line to a project's lead on its Projects row (2026-11-16, PLAN 3.4): "You:" lines with their
// state, the lead's ack note under each, and the composer. Acked means taken, not finished: the note says which. A
// dead message says it is with the CoS and offers Resend. Never a phone notification: the row's dot is the signal.
// Since 2026-11-17 the composer is always open under the project's name, wherever the project is open (the detail
// beside the list, or a row opened in place); the owner: "the message input bar should just always be there".
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { z } from "zod";
import { WRITES, type Projects, type directMessageBody, type directSeenBody, type resendBody } from "../contract.ts";
import { directShown, directState, followUpOf, seenUpTo } from "./command-center.ts";
import { age } from "./lanes.ts";
import { write } from "./store.ts";
import { cx } from "./ui.tsx";

type Project = Projects[number];
const MAX = 4000;

export const directCss = /* css */ `
[data-orch] .orch-cc .compose { margin: 4px 0 0 16px; display: flex; gap: 8px; align-items: flex-end; cursor: default; }
[data-orch] .orch-cc .compose textarea { flex: 1; min-width: 0; min-height: 48px; max-height: 240px; padding: 4px 8px; border: 0; border-radius: 6px; box-shadow: inset 0 0 0 1px var(--cc-edge); background: transparent; color: var(--orch-ink); font: inherit; resize: vertical; }
[data-orch] .orch-cc .compose textarea:focus { outline: 2px solid var(--orch-ink); outline-offset: 0; }
[data-orch] .orch-cc .hint { margin-left: 16px; font-size: 12px; line-height: 16px; color: var(--orch-muted); max-width: 576px; cursor: default; }
[data-orch] .orch-cc .hint label { display: inline-flex; gap: 4px; align-items: center; margin-right: 8px; color: var(--orch-ink); cursor: pointer; }
[data-orch] .orch-cc .hint input { margin: 0; }
@container orchcc (max-width: 640px) {
  [data-orch] .orch-cc .compose { flex-direction: column; align-items: stretch; }
  [data-orch] .orch-cc .compose textarea { width: 100%; }
  [data-orch] .orch-cc .compose .btn { align-self: flex-end; }
}
`;

/**
 * The owner opened the project (a click on it, Details, or the composer focused): the answers it shows are seen (an
 * explicit write, never a render), up to the newest one drawn, so an answer that came in after the page drew stays new.
 */
export function markSeen(project: Project, refetchAll: () => void) {
  const upTo = seenUpTo(project.direct);
  if (upTo === null) return;
  const body: z.input<typeof directSeenBody> = { slug: project.slug, upTo };
  void write(WRITES.directSeen, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
}

/** The "You:" lines, newest first, each with the lead's note under it once the lead acks. */
export function DirectLines({ project, now, cos, busy, refetchAll }: { project: Project; now: number; cos: string; busy: boolean; refetchAll: () => void }) {
  const shown = directShown(project.direct, now);
  const lastNote = shown.find((m) => m.note)?.id;
  // every unread answer is drawn here, so opening the project only marks seen what the owner could read
  const resend = (id: string) => {
    const body: z.input<typeof resendBody> = { id };
    void write(WRITES.resend, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  return (
    <>
      {shown.map((m) => {
        const st = directState(m, cos);
        return (
          <div key={m.id} data-direct={m.id} data-direct-state={m.state}>
            <div className="ln">
              <span className="tx" title={m.text}>
                <span className="lead">You:</span> {m.text}
              </span>
              <span className="tail">
                {age(m.at, now)} ago · {st.dead ? <b className="warn">{st.word}</b> : st.word}
                {st.dead ? (
                  <>
                    {" · "}
                    <button type="button" className="link" data-direct-resend={m.id} disabled={busy} onClick={() => resend(m.id)}>
                      Resend
                    </button>
                  </>
                ) : null}
              </span>
            </div>
            {m.note ? (
              <div className={cx("ln", m.id === lastNote && "note2")} data-direct-note={m.id}>
                <span className="tx" title={m.note}>
                  <span className="lead">Lead's note:</span> {m.note}
                </span>
                {m.answeredAt ? <span className="tail">{age(m.answeredAt, now)} ago</span> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * Each project's draft, outside the rows, shared by every composer drawn for it: a new selection remounts the detail,
 * a resize across the wide layout swaps it for a row, a row moving to or from Quiet remounts, and a send can finish
 * after any of these; whichever composer is on screen shows the one draft, so a sent message never lingers in another.
 * `follow` is the checkbox, kept with the words. `sending` is the words on their way, kept only while what is typed
 * after them only adds to them: on success those words go and the rest stays; a draft cleared or rewritten meanwhile
 * stays whole. `sentLast` is the message just sent: the next follow-up until the page's read lists it, then dropped
 * (the read is the truth after that). Every change bumps one version, the store's snapshot, so a change to either map
 * redraws every composer.
 */
type Draft = { text: string; followUp: { id: string; text: string } | null; follow: boolean; sending: string | null };
const drafts = new Map<string, Draft>();
const sentLast = new Map<string, { id: string; text: string }>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const setDraft = (slug: string, d: Draft | null) => {
  if (d) drafts.set(slug, d);
  else drafts.delete(slug);
  changed();
};

/**
 * The composer, always open: the message, an optional follow-up, and what it is not (an approval). While the box is
 * empty the follow-up is the latest message (while in force), so after a send it is the one just sent; the first
 * keystroke fixes it, and a newer message elsewhere never retargets a draft. It never takes focus by itself.
 */
export function Composer({ project, now, cos, busy, refetchAll, onFocus }: { project: Project; now: number; cos: string; busy: boolean; refetchAll: () => void; onFocus: () => void }) {
  const slug = project.slug;
  useSyncExternalStore(subscribe, () => version);
  const draft = drafts.get(slug) ?? null;
  const latest = followUpOf(project.direct, now);
  const sent = sentLast.get(slug);
  // the message just sent, until the page's read lists it (typing before that must not fix an older target)
  const listed = !!sent && !!project.direct?.messages.some((m) => m.id === sent.id);
  useEffect(() => {
    if (listed && sentLast.get(slug) === sent) sentLast.delete(slug);
  }, [listed, sent, slug]);
  const live = sent && !listed ? sent : latest ? { id: latest.id, text: latest.text } : null;
  const followUp = draft ? draft.followUp : live;
  const follow = draft ? draft.follow : true;
  const text = draft?.text ?? "";
  const update = (t: string, f = follow) => {
    const sending = draft?.sending && t.startsWith(draft.sending) ? draft.sending : null;
    setDraft(slug, t || !f ? { text: t, followUp, follow: f, sending } : null);
  };
  const box = useRef<HTMLTextAreaElement>(null);
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const body: z.input<typeof directMessageBody> = { slug, text: t, followUp: follow && followUp ? followUp.id : null };
    if (draft) setDraft(slug, { ...draft, sending: text });
    const out = await write(WRITES.directMessage, body, { kind: "other", where: `lead:${slug}`, after: refetchAll });
    const cur = drafts.get(slug);
    if (!out?.ok) {
      if (cur?.sending) setDraft(slug, { ...cur, sending: null });
      return;
    }
    const justSent = typeof out.result === "string" ? { id: out.result, text: t } : null;
    if (justSent) sentLast.set(slug, justSent);
    // only the words sent go: what was added after them while the send was on its way stays, and a draft cleared or
    // rewritten meanwhile stays whole; either is a new message, following up the one just sent
    const rest = !cur ? "" : cur.sending === text ? cur.text.slice(text.length).replace(/^\s+/, "") : cur.text;
    setDraft(slug, rest && cur ? { text: rest, followUp: justSent ?? cur.followUp, follow: cur.follow, sending: null } : null);
    box.current?.focus(); // the Send button it was on is disabled now: back to the box, for the next message
  };
  const left = MAX - text.length;
  return (
    <div role="group" aria-label={`Message the ${project.slug} lead`} data-composer={project.slug}>
      <div className="compose">
        <textarea
          ref={box}
          value={text}
          maxLength={MAX}
          rows={2}
          placeholder={`Message the ${project.slug} lead…`}
          aria-label={`Message to lead:${project.slug}`}
          onFocus={onFocus}
          onChange={(e) => update(e.target.value)}
          // Esc leaves the text box and keeps the draft (the app's rule for every text box)
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <button type="button" className="btn primary" data-direct-send={project.slug} disabled={busy || !text.trim()} onClick={() => void send()}>
          Send to lead
        </button>
      </div>
      <div className="hint">
        {followUp ? (
          <label title={followUp.text}>
            <input type="checkbox" checked={follow} onChange={(e) => update(text, e.target.checked)} data-direct-follow={followUp.id} />
            a follow-up of your last message
          </label>
        ) : null}
        Goes to the {project.slug} lead; the {cos} gets a copy. Not an approval: merges, production changes and public pushes still need their card. No secrets here.
        {left < 500 ? ` ${left} characters left.` : ""}
      </div>
    </div>
  );
}
