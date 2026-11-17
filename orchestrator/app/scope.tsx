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
// 1.16.0: built from the affectUI kit. Each list entry is a Card (interactive; the open one, selected) with its count as
// a Badge; the entry's header is one Card (what, who plans it, what happens next); the routing rule is the Scoping
// chip's tooltip, not a paragraph. The cards column keeps Needs you's and Deliverables' own cards, on this tab's type
// and spacing rules.
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { WRITES, type Card, type Deliverables, type Projects, type Scope, type answerBody, type secretBody } from "../contract.ts";
import { ccCss } from "./cc-lines.tsx";
import { ChatBody, ChatCard, Composer, ThreadBox, directCss, markSeen } from "./direct-line.tsx";
import { CardView, useArming, via, type Act } from "./needs-you.tsx";
import { DeliverableCard, inScope } from "./deliverables.tsx";
import { answerCss } from "./answer-ui.tsx";
import { css as inboxCss } from "./affect/decision-inbox-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { Badge } from "./affect/badge-clean.tsx";
import { Card as KitCard, CardHeader } from "./affect/card-clean.tsx";
import { Chip, kitCss } from "./kit-ui.tsx";
import { STATE_CHIP, inScopeEntry, plannerOf, scopeEntries, scopeNext, type ScopeEntry } from "./kit.ts";
import { isWide } from "./source.ts";
import { useElementWidth } from "./panes.tsx";
import { useMinute } from "./status-bar.tsx";
import { useIdentity } from "./identity.ts";
import { ownerOnScreen } from "../core/owner.ts";
import { gate, gone, useGate, write, type Hide, type WriteKind } from "./store.ts";
import { Btn, ReadState } from "./ui.tsx";
import { SegmentedControl } from "./affect/segmented-control-clean.tsx";
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
/* the list: grouped by project; each entry an affectUI card with its planner under its name and its open cards as a count */
[data-orch] .orch-scope__list { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
/* a pane too narrow for the list beside the entry: the groups sit side by side where two fit, so the entry and its chat come sooner */
[data-orch] .orch-scope[data-layout="column"] .orch-scope__list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; align-items: start; }
[data-orch] .orch-scope__group { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
[data-orch] .orch-scope__proj { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding: 0 4px; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--orch-ink); }
[data-orch] .orch-scope__proj .mode { font-size: 12px; line-height: 16px; font-weight: 400; color: var(--orch-muted); white-space: nowrap; }
[data-orch] .orch-scope .orch-scope__entry { --ui-crdc-pad: 12px; }
[data-orch] .orch-scope .orch-scope__entry .ui-crdc__title { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .orch-scope .orch-scope__entry[data-selected] .ui-crdc__title { font-weight: 600; }
[data-orch] .orch-scope .orch-scope__entry .ui-crdc__desc { font-size: 12px; line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .orch-scope .orch-scope__entry .ui-crdc__action { height: 24px; }
/* a count of what waits on the owner: the tab's one solid accent, on the kit's badge */
[data-orch] .orch-scope .orch-scope__n { --bg: var(--k-need); --fg: Canvas; font-weight: 600; }
/* the entry: its header card, then its cards, then its chat (beside the cards when the pane is wide) */
[data-orch] .orch-scope .orch-scope__entrybox { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
[data-orch] .orch-scope .orch-scope__head { gap: 8px; }
[data-orch] .orch-scope .orch-scope__head .ui-crdc__head { align-items: center; }
[data-orch] .orch-scope .orch-scope__head .ui-crdc__title { font-size: 16px; line-height: 24px; font-weight: 400; }
[data-orch] .orch-scope .orch-scope__head .ui-crdc__title .name { font-weight: 600; }
[data-orch] .orch-scope .orch-scope__head .ui-crdc__title .sep { color: var(--orch-muted); }
[data-orch] .orch-scope .orch-scope__head .ui-crdc__desc { font-size: 12px; line-height: 16px; }
[data-orch] .orch-scope .orch-scope__head .ui-crdc__action { height: 24px; align-self: flex-start; }
[data-orch] .orch-scope__next { margin: 0; font-size: 14px; line-height: 20px; color: var(--orch-ink); }
[data-orch] .orch-scope__gone { margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 16px; color: var(--orch-muted); background: var(--orch-wash); }
[data-orch] .orch-scope__body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
[data-orch] .orch-scope__body[data-side="true"] { grid-template-columns: minmax(0, 1fr) minmax(360px, 1fr); }
[data-orch] .orch-scope__body[data-side="true"] > [data-scope-chat] { position: sticky; top: 8px; }
[data-orch] .orch-scope__col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
[data-orch] .orch-scope__h { margin: 0; padding: 0 4px; font-size: 12px; line-height: 16px; font-weight: 400; color: var(--orch-muted); }
[data-orch] .orch-scope__none { margin: 0; font-size: 14px; color: var(--orch-muted); }
/* the cards column draws Needs you's and Deliverables' own cards (shared code). On this tab they follow its rules:
   14 and 12 px, 400 and 600, steps of 4, the muted grey that reads on white, and no rule down the side of a detail.
   Every rule starts at the cards column: the chat beside it draws the host's own transcript, which stays as bb draws it */
[data-orch] .orch-scope [data-scope-cards] :is(.ui-dic, .ui-dic__title, .ui-dic__detail, .ui-dic__btn, .orch-details__toggle, .text-sm, .ui-csc__title-text, .orch-panel__text) { font-size: 14px; }
[data-orch] .orch-scope [data-scope-cards] :is(.ui-dic__title, .ui-dic__btn, .ui-csc__title-text, .font-medium) { font-weight: 600; }
[data-orch] .orch-scope [data-scope-cards] :is(.orch-panel__text, .orch-details__toggle) { font-weight: 400; }
[data-orch] .orch-scope [data-scope-cards] .ui-dic__item[data-open] { padding: 16px; }
[data-orch] .orch-scope [data-scope-cards] .ui-dic__btn { gap: 4px; padding: 4px 12px; }
[data-orch] .orch-scope [data-scope-cards] .orch-meta { gap: 4px 8px; margin-top: 4px; color: var(--orch-muted); }
[data-orch] .orch-scope [data-scope-cards] .orch-when { color: var(--orch-muted); }
[data-orch] .orch-scope [data-scope-cards] .orch-mono { gap: 4px; }
[data-orch] .orch-scope [data-scope-cards] .orch-tile__badges { gap: 8px; margin-top: 8px; }
[data-orch] .orch-scope [data-scope-cards] .orch-md { padding: 0; border: 0; font-size: 14px; }
[data-orch] .orch-scope [data-scope-cards] .orch-md :where(p, li, td, th, blockquote, h1, h2, h3, h4) { font-size: 14px !important; }
[data-orch] .orch-scope [data-scope-cards] .orch-md :where(p, ul, ol) { margin-bottom: 8px !important; }
[data-orch] .orch-scope [data-scope-cards] .orch-md :where(ul, ol) { padding-left: 20px !important; }
[data-orch] .orch-scope [data-scope-cards] .orch-md :where(li) { margin: 0 !important; }
[data-orch] .orch-scope [data-scope-cards] .orch-md :where(h1, h2, h3, h4) { font-weight: 600; }
[data-orch] .orch-scope [data-scope-cards] .orch-md > :last-child, [data-orch] .orch-scope [data-scope-cards] .orch-md > * > :last-child { margin-bottom: 0 !important; }
[data-orch] .orch-scope [data-scope-cards] .orch-other__send { right: 8px; bottom: 8px; }
[data-orch] .orch-scope [data-scope-cards] .orch-panel__row { padding-block: 12px; }
[data-orch] .orch-scope [data-scope-cards] .orch-panel__sub { margin-top: 4px; }
/* a deliverable's "Open link": a 24 px target (a link inside a sentence stays a link in a sentence) */
[data-orch] .orch-scope [data-scope-cards] [data-proof] > a { display: inline-flex; align-items: center; min-height: 24px; }
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
      <div ref={setRoot} data-scope-tab="" data-scope-empty="" className="orch-cc orch-scope">
        {styles}
        <EmptyState
          title="Nothing is scoping"
          text={`A project in scoping mode, or one part of an active project that its lead scopes, shows here: its cards and the chat with its lead, before any build thread starts. What it files reaches only ${you.name}.`}
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
  const routing = `What is filed here reaches only ${you.name}: no CoS triage, no standing rule.${entry.task && open.whole === false ? ` Only this task scopes here; the rest of ${open.slug} goes the normal way.` : ""}`;

  const listNav = (
    <nav className="orch-scope__list" aria-label="Scoping">
      {groups.map(({ p, entries: es }) => (
        <div key={p.slug} className="orch-scope__group" role="group" aria-label={p.slug} data-scope-group={p.slug}>
          <div className="orch-scope__proj">
            <span>{p.slug}</span>
            {p.whole === false ? <span className="mode">active</span> : null}
          </div>
          {es.map((e) => {
            const n = openCount(e);
            const current = e.key === entry.key;
            return (
              <KitCard key={e.key} interactive selected={current} className="orch-scope__entry">
                <CardHeader
                  titleAs="p"
                  title={
                    <button type="button" data-scope-pick={e.key} aria-current={current ? "true" : undefined} onClick={() => pick(e)}>
                      {entryWord(e)}
                    </button>
                  }
                  description={
                    <span data-planner={plannerOf(e).kind} data-scope-planner={e.key} title={plannerOf(e).text}>
                      {plannerShort(e)}
                    </span>
                  }
                  action={n ? <Badge count={n} className="orch-scope__n" data-scope-open={String(n)} role="img" title={`${n} waiting on you`} aria-label={`${n} waiting on you`} /> : null}
                />
              </KitCard>
            );
          })}
        </div>
      ))}
    </nav>
  );
  const head = (
    <KitCard as="section" className="orch-scope__head" data-scope-project={open.slug} data-scope-entry={entry.key}>
      <CardHeader
        titleAs="h2"
        title={
          <>
            <span className="name">{open.slug}</span> <span className="sep">›</span> <span className="task">{entryWord(entry)}</span>
          </>
        }
        description={
          <span data-planner={planner.kind} data-scope-head-planner="">
            {planner.text}
          </span>
        }
        action={<Chip spec={STATE_CHIP.scoping} title={routing} data-scope-state="" />}
      />
      <p className="orch-scope__next" data-scope-next="">
        {scopeNext(entry, { cards, delivered: delivered.length, hasLead: !!project?.lead })}
      </p>
    </KitCard>
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
            <ChatCard slug={project.slug}>
              <ChatBody project={project} now={now} cos={cosTitle} busy={gate.lock !== null} refetchAll={refetchAll} />
            </ChatCard>
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
    <ChatCard slug={project.slug} data-scope-chat-view={shown}>
      <div className="k-chat__bar">
        {planner.kind === "thread" ? (
          <SegmentedControl
            size="sm"
            variant="tray"
            aria-label="Whose chat"
            value={shown}
            onChange={setView}
            options={[
              { value: "lead", label: <span data-scope-view="lead">Lead</span> },
              { value: "thread", label: <span data-scope-view="thread" title={planner.text}>Scoping thread</span> },
            ]}
          />
        ) : (
          <h3 className="ui-crdc__title">Chat with the lead</h3>
        )}
        {shown === "thread" && planner.kind === "thread" ? (
          <Btn tone="ghost" size="sm" className="tail" title={`Open ${planner.address} in bb`} data-open-thread={planner.threadId} onClick={() => navigate.toThread(planner.threadId)}>
            Open in bb
          </Btn>
        ) : null}
      </div>
      {shown === "thread" && planner.kind === "thread" ? (
        <ThreadBox threadId={planner.threadId} label={planner.address} height={height} note={`${planner.name}'s thread. It reports to the ${project.slug} lead.`} />
      ) : (
        <ChatBody project={project} now={now} cos={cos} busy={busy} refetchAll={refetchAll} height={height} />
      )}
      <Composer project={project} now={now} cos={cos} busy={busy} refetchAll={refetchAll} onFocus={onFocus} via={planner.kind === "thread" ? "The lead passes it to the scoping thread" : undefined} />
    </ChatCard>
  );
}
