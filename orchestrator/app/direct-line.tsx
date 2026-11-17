// The owner's direct line to a project's lead on its Projects row (2026-11-16, PLAN 3.4): "You:" lines with their
// state, the lead's ack note under each, and the composer. Acked means taken, not finished: the note says which. A
// dead message says it is with the CoS and offers Resend. Never a phone notification: the row's dot is the signal.
// Since 2026-11-17 the composer is always open under the project's name, wherever the project is open (the detail
// beside the list, or a row opened in place); the owner: "the message input bar should just always be there".
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { z } from "zod";
import { Markdown, experimental_useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import { CHANGED_CHANNEL, WRITES, rpcContract, type Projects, type directMessageBody, type directSeenBody, type resendBody } from "../contract.ts";
import { chatOrder, chatPreview, directState, followUpOf, seenUpTo } from "./command-center.ts";
import { age } from "./lanes.ts";
import { write } from "./store.ts";
import { when } from "./ui.tsx";

type Project = Projects[number];
const MAX = 4000;

export const directCss = /* css */ `
[data-orch] .orch-cc .compose { margin: 4px 0 0 16px; display: flex; gap: 8px; align-items: flex-end; cursor: default; }
[data-orch] .orch-cc .compose textarea { flex: 1; min-width: 0; min-height: 48px; max-height: 240px; padding: 4px 8px; border: 0; border-radius: 6px; box-shadow: inset 0 0 0 1px var(--cc-edge); background: transparent; color: var(--orch-ink); font: inherit; resize: vertical; }
[data-orch] .orch-cc .compose textarea:focus { outline: 2px solid var(--orch-ink); outline-offset: 0; }
[data-orch] .orch-cc .hint { margin-left: 16px; font-size: 12px; line-height: 16px; color: var(--orch-muted); max-width: 576px; cursor: default; }
[data-orch] .orch-cc .hint label { display: inline-flex; gap: 4px; align-items: center; margin-right: 8px; color: var(--orch-ink); cursor: pointer; }
[data-orch] .orch-cc .hint input { margin: 0; }
[data-orch] .orch-cc .compact .compose { margin: 0; align-items: center; }
[data-orch] .orch-cc .compact .compose textarea { min-height: 40px; padding: 8px 12px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--k-border, var(--cc-edge)); }
[data-orch] .orch-cc .compact .compose .btn.primary { padding: 8px 12px; border-radius: 8px; }
[data-orch] .orch-cc .compact .hint { margin: 4px 0 0; }
/* the chat log (1.10.0): sizes 12/14/16, weights 400/600; the owner's messages on the right in a tint, the lead's on the left */
[data-orch] .orch-cc .k-chat { display: flex; flex-direction: column; gap: 8px; min-width: 0; margin-bottom: 8px; }
[data-orch] .orch-cc .k-chat__bar { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 14px; line-height: 20px; color: var(--orch-ink); text-align: start; cursor: pointer; }
[data-orch] .orch-cc .k-chat__bar:hover { background: var(--orch-wash); }
[data-orch] .orch-cc .k-chat__chev { flex: none; color: var(--orch-muted); transition: transform 160ms ease; }
[data-orch] .orch-cc .k-chat__chev[data-open] { transform: rotate(90deg); }
[data-orch] .orch-cc .k-chat__h { flex: none; font-weight: 600; }
[data-orch] .orch-cc .k-chat__pre { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--orch-muted); }
[data-orch] .orch-cc .k-chat__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--k-need, #9d174d); margin-left: auto; }
[data-orch] .orch-cc .k-chat__log { display: flex; flex-direction: column; gap: 12px; max-height: 480px; overflow-y: auto; padding: 8px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--k-border, var(--cc-edge)); }
[data-orch] .orch-cc .k-chat__pair { display: flex; flex-direction: column; gap: 6px; }
[data-orch] .orch-cc .k-msg { max-width: min(640px, 85%); min-width: 0; padding: 8px 12px; border-radius: 10px; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
[data-orch] .orch-cc .k-msg[data-from="you"] { align-self: flex-end; background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.09)); }
[data-orch] .orch-cc .k-msg[data-from="lead"] { align-self: flex-start; box-shadow: inset 0 0 0 1px var(--k-border, var(--cc-edge)); }
[data-orch] .orch-cc .k-msg__b > :first-child { margin-top: 0; }
[data-orch] .orch-cc .k-msg__b > :last-child { margin-bottom: 0; }
[data-orch] .orch-cc .k-msg__who, [data-orch] .orch-cc .k-msg__re { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--orch-muted); }
[data-orch] .orch-cc .k-msg__re { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .orch-cc .k-msg__meta { margin-top: 4px; font-size: 12px; line-height: 16px; color: var(--orch-muted); }
[data-orch] .orch-cc .k-msg__new { color: var(--k-need, #9d174d); font-weight: 600; }
[data-orch] .orch-cc .k-chat__older { align-self: center; border: 0; padding: 4px 10px; border-radius: 6px; background: none; font: inherit; font-size: 12px; color: var(--orch-muted); cursor: pointer; }
[data-orch] .orch-cc .k-chat__older:hover { color: var(--orch-ink); background: var(--orch-wash); }
[data-orch] .orch-cc .k-chat__empty { margin: 0; font-size: 12px; color: var(--orch-muted); }
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

/** Chats left open, by project: a new selection or a resize remounts the detail, and the log stays as the owner left it. */
const openChats = new Set<string>();
const PAGE = 30;

/**
 * The direct line as a chat (1.10.0): a collapsible log on the project, the composer under it. Collapsed, one line
 * with the last exchange and a dot while the lead's reply is unread; it starts open while one is. Opening it is the
 * explicit act that marks the replies seen (markSeen), never a render. The log reads its own history (directHistory),
 * so the Projects read stays light; "Older" pages back with a before-cursor.
 */
export function ChatLog({ project, now, cos, busy, refetchAll, onPick, startOpen = false }: { project: Project; now: number; cos: string; busy: boolean; refetchAll: () => void; onPick: () => void; startOpen?: boolean }) {
  const slug = project.slug;
  // starts open while a reply is unread: opening the project (an explicit act, projects.tsx) marks it seen, so it must show.
  // The Scope tab (1.11.0) opens it always: the chat is what the owner came there for.
  const [open, setOpen] = useState(() => startOpen || openChats.has(slug) || !!project.direct?.unread);
  const toggle = () => {
    const next = !open;
    if (next) {
      openChats.add(slug);
      onPick();
      markSeen(project, refetchAll);
    } else openChats.delete(slug);
    setOpen(next);
  };
  const pre = chatPreview(project.direct);
  return (
    <section className="k-chat" data-chat={slug} data-open={open ? "true" : "false"}>
      <button type="button" className="k-chat__bar" aria-expanded={open} data-chat-toggle={slug} onClick={toggle}>
        <svg className="k-chat__chev" data-open={open || undefined} viewBox="0 0 16 16" width="12" height="12" aria-hidden>
          <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="k-chat__h">Chat with lead</span>
        {!open && pre ? (
          <span className="k-chat__pre" data-chat-preview="" title={pre.lead ? `You: ${pre.you}\nLead: ${pre.lead}` : `You: ${pre.you}`}>
            You: {pre.you}
            {pre.lead ? ` · Lead: ${pre.lead}` : ""}
          </span>
        ) : null}
        {pre?.unread ? <span className="k-chat__dot" data-chat-unread="" role="img" aria-label="New reply from the lead" /> : null}
      </button>
      {open ? <ChatPages project={project} now={now} cos={cos} busy={busy} refetchAll={refetchAll} /> : null}
    </section>
  );
}

/** The pages of the log, oldest at the top: the newest page, then each older one the owner asked for. */
function ChatPages({ project, now, cos, busy, refetchAll }: { project: Project; now: number; cos: string; busy: boolean; refetchAll: () => void }) {
  const [cursors, setCursors] = useState<number[]>([]);
  const log = useRef<HTMLDivElement>(null);
  const pages = [null, ...cursors];
  return (
    <div className="k-chat__log" ref={log} role="log" aria-label={`Chat with the ${project.slug} lead`}>
      {pages
        .map((before, i) => (
          <ChatPage
            key={before ?? "latest"}
            project={project}
            before={before}
            now={now}
            cos={cos}
            busy={busy}
            refetchAll={refetchAll}
            oldest={i === pages.length - 1}
            onOlder={(at) => setCursors((c) => (c.includes(at) ? c : [...c, at]))}
            box={i === 0 ? log : null}
          />
        ))
        .reverse()}
    </div>
  );
}

function ChatPage({ project, before, now, cos, busy, refetchAll, oldest, onOlder, box }: { project: Project; before: number | null; now: number; cos: string; busy: boolean; refetchAll: () => void; oldest: boolean; onOlder: (at: number) => void; box: RefObject<HTMLDivElement | null> | null }) {
  const q = experimental_useRpcQuery({ contract: rpcContract, method: "directHistory", input: { slug: project.slug, before, limit: PAGE } });
  const again = useRef(q.refetch);
  again.current = q.refetch;
  const latest = before === null;
  // the newest page follows the line live (a send, the lead's ack); older pages don't change
  useRealtime(CHANGED_CHANNEL, () => latest && void again.current());
  const ms = chatOrder(q.data?.messages ?? []);
  const last = ms[ms.length - 1];
  // the newest page keeps the log scrolled to the bottom, by the input, when a message or a reply comes in
  useLayoutEffect(() => {
    if (box?.current) box.current.scrollTop = box.current.scrollHeight;
  }, [box, last?.id, last?.note]);
  const resend = (id: string) => {
    const body: z.input<typeof resendBody> = { id };
    void write(WRITES.resend, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  if (!q.data) return latest ? <p className="k-chat__empty">{q.error ? `Can't read the chat: ${q.error.message}` : "Loading…"}</p> : null;
  const texts = new Map(ms.map((m) => [m.id, m.text]));
  return (
    <>
      {oldest && q.data.more && ms[0] ? (
        <button type="button" className="k-chat__older" data-chat-older="" onClick={() => onOlder(ms[0]!.at)}>
          Older messages
        </button>
      ) : null}
      {latest && ms.length === 0 ? <p className="k-chat__empty">No messages yet. Write to the lead below.</p> : null}
      {ms.map((m) => {
        const st = directState(m, cos);
        return (
          <div key={m.id} className="k-chat__pair" data-chat-msg={m.id} data-direct-state={m.state}>
            <div className="k-msg" data-from="you">
              {m.followUp ? (
                <div className="k-msg__re" title={texts.get(m.followUp) ?? undefined}>
                  ↳ follow-up{texts.has(m.followUp) ? ` of “${(texts.get(m.followUp) ?? "").slice(0, 60)}”` : ""}
                </div>
              ) : null}
              <div className="k-msg__b">
                <Markdown content={m.text} />
              </div>
              <div className="k-msg__meta">
                <span title={when(m.at)}>{age(m.at, now)} ago</span> · {st.dead ? <b className="warn">{st.word}</b> : <span data-chat-state="">{st.word}</span>}
                {st.dead ? (
                  <>
                    {" · "}
                    <button type="button" className="link" data-direct-resend={m.id} disabled={busy} onClick={() => resend(m.id)}>
                      Resend
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {m.note ? (
              <div className="k-msg" data-from="lead" data-chat-note={m.id}>
                <div className="k-msg__who">lead:{project.slug}</div>
                <div className="k-msg__b">
                  <Markdown content={m.note} />
                </div>
                {m.answeredAt ? (
                  <div className="k-msg__meta">
                    <span title={when(m.answeredAt)}>{age(m.answeredAt, now)} ago</span>
                    {m.unread ? <b className="k-msg__new"> · new</b> : null}
                  </div>
                ) : null}
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
export function Composer({ project, now, cos, busy, refetchAll, onFocus, compact = false }: { project: Project; now: number; cos: string; busy: boolean; refetchAll: () => void; onFocus: () => void; compact?: boolean }) {
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
  const rules = `Goes to the ${project.slug} lead; the ${cos} gets a copy. Not an approval: merges, production changes and public pushes still need their card. No secrets here.`;
  // compact (the detail, 2026-11-17): one line until typed in; the rules move to the box's title and the placeholder
  // keeps "not an approval"; the follow-up switch shows once there is a draft to follow up with
  const hint = !compact || (!!text && !!followUp) || left < 500;
  return (
    <div role="group" aria-label={`Message the ${project.slug} lead`} data-composer={project.slug} className={compact ? "compact" : undefined}>
      <div className="compose">
        <textarea
          ref={box}
          value={text}
          maxLength={MAX}
          rows={compact && !text ? 1 : 2}
          title={compact ? rules : undefined}
          placeholder={compact ? `Message the ${project.slug} lead… (not an approval)` : `Message the ${project.slug} lead…`}
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
      {hint ? (
      <div className="hint">
        {followUp && (!compact || text) ? (
          <label title={followUp.text}>
            <input type="checkbox" checked={follow} onChange={(e) => update(text, e.target.checked)} data-direct-follow={followUp.id} />
            a follow-up of your last message
          </label>
        ) : null}
        {compact ? null : rules}
        {left < 500 ? ` ${left} characters left.` : ""}
      </div>
      ) : null}
    </div>
  );
}
