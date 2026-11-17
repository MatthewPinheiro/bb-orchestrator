// The Scope tab (1.11.0): the projects in scoping mode, where the owner works out a new project with its lead directly.
// One project open at a time: the chat with its lead (the 1.10.0 chat log and composer, direct-line.tsx) beside the
// cards its lead filed and the deliverables it handed over, answerable in place with Needs you's own card and the
// Deliverables tab's own card. While the project scopes these never reach the CoS's triage, Needs you or Deliverables;
// the owner's yes on the lead's "Scoping done?" card makes the project active, and it leaves this tab.
// 1.12.0: an active project is listed too while it has open scoping tasks. The list is grouped project > task: "whole
// project" for one scoping as a whole, "task: <name>" for each open task. Opening one shows the project's chat (the same
// chat for each of its entries) beside that entry's own cards and deliverables.
// 1.13.0: a list grouped by project on the left (each entry with its planner and its count), the entry on the right: its
// header (who plans it and what happens next), its cards, then its chat (beside the cards when the pane is wide, so the
// chat stays in view while the owner answers). Narrow, the list sits above the entry.
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { WRITES, type Card, type Deliverables, type Projects, type Scope, type answerBody, type secretBody } from "../contract.ts";
import { ccCss } from "./cc-lines.tsx";
import { ChatBody, Composer, ThreadBox, directCss, markSeen } from "./direct-line.tsx";
import { CardView, useArming, via, type Act } from "./needs-you.tsx";
import { DeliverableCard, inScope } from "./deliverables.tsx";
import { answerCss } from "./answer-ui.tsx";
import { css as inboxCss } from "./affect/decision-inbox-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { Chip, kitCss } from "./kit-ui.tsx";
import { STATE_CHIP, inScopeEntry, plannerOf, scopeEntries, scopeNext, type ScopeEntry } from "./kit.ts";
import { isWide } from "./source.ts";
import { useElementWidth } from "./panes.tsx";
import { useMinute } from "./status-bar.tsx";
import { useIdentity } from "./identity.ts";
import { ownerOnScreen } from "../core/owner.ts";
import { gate, gone, useGate, write, type Hide, type WriteKind } from "./store.ts";
import { ReadState } from "./ui.tsx";
import { styleHref } from "./style-href.ts";

/** Every entry's label this page has shown, by key: the one that leaves the tab (its scoping ended) is named when it goes. */
const labels = new Map<string, string>();

type Query = { data: Scope | undefined; error: { message: string } | null; refetch: () => Promise<void> };
type Project = Projects[number];

/** At this pane width and wider, the list sits beside the entry (the Projects tab's switch, source.ts); narrower, one column. */
const listBeside = isWide;
/** From this pane width the entry's chat sits beside its cards, so it stays in view while the owner answers them. */
const CHAT_BESIDE_MIN = 1440;

const scopeCss = /* css */ `
[data-orch] .orch-scope { padding-bottom: 32px; }
[data-orch] .orch-scope__grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
[data-orch] .orch-scope[data-layout="list-detail"] .orch-scope__grid { grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 32px; }
/* the list (1.13.0): grouped by project like the Projects list, one row per entry with its planner and its open cards */
[data-orch] .orch-scope__list { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
[data-orch] .orch-scope__group { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
[data-orch] .orch-scope__proj { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding: 0 12px 4px; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--orch-ink); }
[data-orch] .orch-scope__proj .mode { font-size: 12px; line-height: 16px; font-weight: 400; color: var(--orch-muted); white-space: nowrap; }
[data-orch] .orch-scope .orch-scope__entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; row-gap: 2px; align-items: center; width: 100%; min-height: 56px; padding: 8px 12px; border-radius: 8px; text-align: start; font: inherit; color: var(--orch-ink); cursor: pointer; }
[data-orch] .orch-scope .orch-scope__entry:hover { background: var(--k-wash, var(--orch-wash)); }
[data-orch] .orch-scope .orch-scope__entry[aria-current="true"] { background: color-mix(in srgb, var(--orch-ink) 8%, transparent); box-shadow: inset 0 0 0 1px var(--k-border, var(--orch-line)); }
[data-orch] .orch-scope .orch-scope__entry .what { min-width: 0; font-size: 14px; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .orch-scope .orch-scope__entry[aria-current="true"] .what { font-weight: 600; }
[data-orch] .orch-scope .orch-scope__entry .orch-scope__by { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .orch-scope .orch-scope__entry .k-chip { justify-self: end; }
/* the entry: its header, then its cards, then its chat (beside the cards when the pane is wide) */
[data-orch] .orch-scope .orch-scope__entrybox { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
[data-orch] .orch-scope__head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
[data-orch] .orch-scope__title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; font-size: 16px; line-height: 24px; }
[data-orch] .orch-scope__title .name { font-weight: 600; }
[data-orch] .orch-scope__title .sep { color: var(--orch-muted); }
[data-orch] .orch-scope__title .task { min-width: 0; overflow-wrap: anywhere; }
[data-orch] .orch-scope__next { margin: 0; font-size: 14px; line-height: 20px; color: var(--orch-ink); }
[data-orch] .orch-scope__route { margin: 0; font-size: 12px; line-height: 16px; color: var(--orch-muted); }
[data-orch] .orch-scope__gone { margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 16px; color: var(--orch-muted); background: var(--orch-wash); }
[data-orch] .orch-scope__body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
[data-orch] .orch-scope__body[data-side="true"] { grid-template-columns: minmax(0, 1fr) minmax(360px, 1fr); }
[data-orch] .orch-scope__body[data-side="true"] > [data-scope-chat] { position: sticky; top: 8px; }
[data-orch] .orch-scope__col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
[data-orch] .orch-scope__h { margin: 0; font-size: 12px; line-height: 16px; font-weight: 400; color: var(--orch-muted); }
[data-orch] .orch-scope__none { margin: 0; font-size: 14px; color: var(--orch-muted); }
[data-orch] .orch-scope__by { font-size: 12px; line-height: 16px; color: var(--orch-muted); }
[data-orch] .orch-scope__by[data-planner="thread"] { color: var(--orch-ink); }
[data-orch] .orch-scope__chat-h { display: flex; align-items: center; gap: 8px; min-height: 32px; }
[data-orch] .orch-scope__chat-h h3 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }
[data-orch] .orch-scope__views { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--orch-wash); }
[data-orch] .orch-scope .orch-scope__views button { padding: 2px 10px; border-radius: 6px; font-size: 12px; line-height: 20px; color: var(--orch-muted); }
[data-orch] .orch-scope .orch-scope__views button[aria-pressed="true"] { color: var(--orch-ink); font-weight: 600; background: light-dark(#fff, rgba(255, 255, 255, 0.12)); box-shadow: 0 0 0 1px var(--k-border, var(--orch-line)); }
[data-orch] .orch-scope__open { margin-left: auto; font-size: 12px; }
`;

/** The open cards first the "Scoping done?" one, then oldest first (the order the lead filed them in). */
const ordered = (cards: Card[]) => [...cards].sort((a, b) => Number(!!b.scopingDone) - Number(!!a.scopingDone) || (a.askedAt < b.askedAt ? -1 : 1));

/** What the list and the header call an entry: the part of the project it scopes. */
const entryWord = (e: ScopeEntry) => (e.task ? `Task: ${e.task.name}` : "Whole project");
/** The list row's planner: short, the address and the full line in its title. */
const plannerShort = (e: ScopeEntry) => {
  const p = plannerOf(e);
  return p.kind === "lead" ? p.text : `Planned by ${p.name} · ${p.state}`;
};

/** `focus`: the entry (scopeKey) a link elsewhere (a project's "Answer") asked to open here. */
export function ScopeView({ q, projects, deliverables, refetchAll, mons, accents, focus = null }: { q: Query; projects: Projects | undefined; deliverables: Deliverables | undefined; refetchAll: () => void; mons: ReadonlyMap<string, string | null>; accents?: ReadonlyMap<string, string | null>; focus?: string | null }) {
  useGate();
  const { ownerName, cosTitle } = useIdentity();
  const you = ownerOnScreen(ownerName);
  const now = useMinute();
  const [width, measure] = useElementWidth();
  const [picked, setPicked] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const arming = useArming(root);
  useEffect(() => {
    if (focus) setPicked(focus);
  }, [focus]);
  // the first entry, once the data is in, is the one shown: pinned, so when its scoping ends the tab says so and stays in
  // its project, as for an entry the owner picked
  const first = q.data ? (scopeEntries(q.data.projects)[0]?.key ?? null) : null;
  useEffect(() => {
    if (picked === null && first) setPicked(first);
  }, [picked, first]);
  const styles = (
    <>
      <style href={styleHref("orch-cc", ccCss)} precedence="default">
        {ccCss}
      </style>
      <style href={styleHref("orch-cc-direct", directCss)} precedence="default">
        {directCss}
      </style>
      <style href={styleHref("orch-kit", kitCss)} precedence="default">
        {kitCss}
      </style>
      <style href={styleHref("ui-decision-inbox-clean", inboxCss)} precedence="default">
        {inboxCss}
      </style>
      <style href={styleHref("orch-answer", answerCss)} precedence="default">
        {answerCss}
      </style>
      <style href={styleHref("orch-scope", scopeCss)} precedence="default">
        {scopeCss}
      </style>
    </>
  );
  const setRoot = (el: HTMLDivElement | null) => {
    root.current = el;
    measure(el);
  };
  if (!q.data)
    return (
      <div ref={setRoot} data-scope-tab="">
        <ReadState q={q} what="the scoping projects" />
      </div>
    );
  const list = q.data.projects;
  if (list.length === 0)
    return (
      <div ref={setRoot} data-scope-tab="" data-scope-empty="">
        {styles}
        <EmptyState
          title="Nothing is scoping"
          text={`A new project can start in scoping mode: ${you.name} and its lead settle its goal, constraints and first plan here, in a chat beside its cards, before any build thread starts. The CoS starts one with orch_new_project (mode scoping) or switches a project with orch_project_mode. A lead can also scope one part of an active project: it opens a scoping task, and that task's cards wait here while the rest goes the normal way.`}
        />
      </div>
    );
  const entries = scopeEntries(list);
  for (const e of entries) labels.set(e.key, `${e.slug} › ${entryWord(e)}`);
  // the entry picked, else (it left the tab: its scoping ended) another of its project, else the first
  const pickedSlug = picked?.split("/")[0] ?? null;
  const entry = entries.find((e) => e.key === picked) ?? entries.find((e) => e.slug === pickedSlug) ?? entries[0]!;
  const left = picked && !entries.some((e) => e.key === picked) ? labels.get(picked) ?? null : null;
  const open = list.find((p) => p.slug === entry.slug)!;
  const task = entry.task?.id ?? null;
  const project = projects?.find((p) => p.slug === open.slug);
  const pick = (e: ScopeEntry) => {
    setPicked(e.key);
    const p = projects?.find((x) => x.slug === e.slug);
    if (p) markSeen(p, refetchAll); // choosing the entry shows its project's chat, so the lead's replies there are seen
  };
  const openCount = (e: ScopeEntry) => {
    const p = list.find((x) => x.slug === e.slug)!;
    return p.cards.filter((c) => !gone.has(`${c.id}@${c.rev}`) && inScopeEntry(p, e.task?.id ?? null, c.scopeTask)).length;
  };
  const groups = list.map((p) => ({ p, entries: entries.filter((e) => e.slug === p.slug) })).filter((g) => g.entries.length);

  // the same write as Needs you's, under the same page lock and arming
  const send = (card: Card, kind: WriteKind, hide: Hide, path: string, body: unknown) => {
    if (gate.lock) return;
    if (!arming.check(card.id, card.rev)) return;
    void write(path, body, { card: { id: card.id, rev: card.rev, hide }, kind, after: refetchAll });
  };
  const act: Act = {
    answer(card, _list, option, note) {
      const body: z.input<typeof answerBody> = { id: card.id, rev: card.rev, option, text: note.trim() ? note : null, via: via() };
      send(card, "answer", "both", WRITES.answer, body);
    },
    secret(card, _list, value) {
      const body: z.input<typeof secretBody> = { id: card.id, rev: card.rev, value, via: via() };
      send(card, "answer", "both", WRITES.secret, body);
    },
    // a scoping card is never deferred: it waits here until answered
    defer: () => undefined,
    bringBack: () => undefined,
  };
  const cards = ordered(open.cards.filter((c) => !gone.has(`${c.id}@${c.rev}`) && inScopeEntry(open, task, c.scopeTask)));
  const delivered = (deliverables ?? []).filter((d) => d.project === open.slug && inScope(d) && inScopeEntry(open, task, d.scopeTask)).sort((a, b) => b.updatedAt - a.updatedAt);
  const wide = listBeside(width);
  const side = width >= CHAT_BESIDE_MIN;
  const planner = plannerOf(entry);
  const routing = `What is filed here reaches only ${you.name}: no CoS triage, no standing rule.`;

  const listNav = (
    <nav className="orch-scope__list" aria-label="Scoping">
      {groups.map(({ p, entries: es }) => (
        <div key={p.slug} className="orch-scope__group" role="group" aria-label={p.slug} data-scope-group={p.slug}>
          <div className="orch-scope__proj">
            <span>{p.slug}</span>
            <span className="mode">{p.whole === false ? `active · ${es.length} ${es.length === 1 ? "task" : "tasks"} scoping` : "scoping as a whole"}</span>
          </div>
          {es.map((e) => {
            const n = openCount(e);
            return (
              <button key={e.key} type="button" className="orch-scope__entry" data-scope-pick={e.key} aria-current={e.key === entry.key ? "true" : undefined} onClick={() => pick(e)}>
                <span className="what">{entryWord(e)}</span>
                {n ? <Chip spec={{ tone: "need", icon: "you", word: `${n} for you` }} data-scope-open={String(n)} /> : <span className="orch-scope__by">nothing open</span>}
                <span className="orch-scope__by" data-planner={plannerOf(e).kind} data-scope-planner={e.key} title={plannerOf(e).text}>
                  {plannerShort(e)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
  const head = (
    <div className="orch-scope__head" data-scope-project={open.slug} data-scope-entry={entry.key}>
      <div className="orch-scope__title">
        <span className="name">{open.slug}</span>
        <span className="sep">›</span>
        <span className="task">{entryWord(entry)}</span>
        <Chip spec={STATE_CHIP.scoping} title={routing} data-scope-state="" />
      </div>
      <span className="orch-scope__by" data-planner={planner.kind} data-scope-head-planner="">
        {planner.text}
      </span>
      <p className="orch-scope__next" data-scope-next="">
        {scopeNext(entry, { cards, delivered: delivered.length, hasLead: !!project?.lead })}
      </p>
      <p className="orch-scope__route">
        {routing}
        {entry.task && open.whole === false ? ` Only this task scopes here; the rest of ${open.slug} goes the normal way.` : ""}
      </p>
    </div>
  );
  const cardsCol = (
    <section className="orch-scope__col" data-scope-cards={open.slug} data-scope-cards-task={task ?? ""} aria-label={entry.task ? `${open.slug}'s cards for ${entry.task.name}` : `${open.slug}'s cards`}>
      {cards.length || delivered.length ? (
        <h3 className="orch-scope__h" data-scope-waiting="">
          Waiting on you: {cards.length ? `${cards.length} ${cards.length === 1 ? "card" : "cards"}` : ""}
          {cards.length && delivered.length ? ", " : ""}
          {delivered.length ? `${delivered.length} to review` : ""}
        </h3>
      ) : null}
      {cards.length ? (
        <section className="ui-dic">
          <div className="ui-dic__card" data-list="scope">
            {cards.map((c) => (
              <CardView key={c.id} card={c} list="cards" presets={[]} isArmed={arming.isArmed(c.id, c.rev)} act={act} mon={mons.get(c.origin) ?? null} monType={accents?.get(open.slug) ?? null} />
            ))}
          </div>
        </section>
      ) : null}
      {delivered.map((d) => (
        <DeliverableCard key={d.id} d={d} refetchAll={refetchAll} outputs={[]} outputsAfter={() => undefined} />
      ))}
    </section>
  );
  const chatCol = (
    <section className="orch-scope__col" data-scope-chat={open.slug} aria-label={`Chat with the ${open.slug} lead`}>
      {project?.lead ? (
        <ScopeChat
          key={entry.key}
          project={project}
          entry={entry}
          now={now}
          cos={cosTitle}
          refetchAll={refetchAll}
          height={side ? "clamp(320px, calc(100vh - 470px), 640px)" : undefined}
          onFocus={() => {
            setPicked(entry.key);
            markSeen(project, refetchAll);
          }}
        />
      ) : (
        <>
          <p className="orch-scope__none" data-scope-no-lead="">
            {project ? `No lead is running for ${open.slug}: start it from Projects, and the chat opens here.` : "Loading the chat…"}
          </p>
          {project?.direct?.messages.length ? (
            <div className="direct" data-direct-line={project.slug}>
              <ChatBody project={project} now={now} cos={cosTitle} busy={gate.lock !== null} refetchAll={refetchAll} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
  return (
    <div ref={setRoot} data-scope-tab="" data-scope-width={width}>
      {styles}
      <div className="orch-cc orch-scope" data-layout={wide ? "list-detail" : "column"} data-chat={side ? "side" : "below"} style={wide ? undefined : { maxWidth: 800, marginInline: "auto" }}>
        <div className="orch-scope__grid">
          {listNav}
          <div className="orch-scope__entrybox">
            {left ? (
              <p className="orch-scope__gone" data-scope-left="">
                {left} is no longer scoping: it left this tab, and anything still open under it went the normal way.
              </p>
            ) : null}
            {head}
            <div className="orch-scope__body" data-side={side ? "true" : "false"}>
              {cardsCol}
              {chatCol}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * An entry's chat (1.13.0): the lead's own thread; while a scoping thread plans the task, a switch to watch that
 * thread's own transcript instead ("Lead" | "Scoping thread"). The composer under it always writes to the lead (a
 * tracked direct message): the scoping thread hears from its lead, so the hint says the lead passes it on.
 */
function ScopeChat({ project, entry, now, cos, refetchAll, onFocus, height }: { project: Project; entry: ScopeEntry; now: number; cos: string; refetchAll: () => void; onFocus: () => void; height?: string }) {
  const navigate = useBbNavigate();
  const planner = plannerOf(entry);
  const [view, setView] = useState<"lead" | "thread">("lead");
  const shown = planner.kind === "thread" ? view : "lead";
  const busy = gate.lock !== null;
  return (
    <div className="direct" data-direct-line={project.slug} data-scope-chat-view={shown}>
      <div className="orch-scope__chat-h">
        {planner.kind === "thread" ? (
          <div className="orch-scope__views" role="group" aria-label="Whose chat">
            <button type="button" aria-pressed={shown === "lead"} data-scope-view="lead" onClick={() => setView("lead")}>
              Lead
            </button>
            <button type="button" aria-pressed={shown === "thread"} data-scope-view="thread" title={planner.text} onClick={() => setView("thread")}>
              Scoping thread
            </button>
          </div>
        ) : (
          <h3>Chat with the lead</h3>
        )}
        {shown === "thread" && planner.kind === "thread" ? (
          <button type="button" className="link orch-scope__open" data-open-thread={planner.threadId} onClick={() => navigate.toThread(planner.threadId)}>
            Open {planner.address} in bb
          </button>
        ) : null}
      </div>
      {shown === "thread" && planner.kind === "thread" ? (
        <ThreadBox threadId={planner.threadId} label={planner.address} height={height} note={`${planner.name}, the scoping thread for ${JSON.stringify(entry.task?.name ?? "")}. It reports to the ${project.slug} lead.`} />
      ) : (
        <ChatBody project={project} now={now} cos={cos} busy={busy} refetchAll={refetchAll} height={height} />
      )}
      <Composer project={project} now={now} cos={cos} busy={busy} refetchAll={refetchAll} onFocus={onFocus} via={planner.kind === "thread" ? "Goes to the lead, who passes it to the scoping thread" : undefined} />
    </div>
  );
}
