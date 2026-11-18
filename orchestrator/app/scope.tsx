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
// 1.16.0: each list entry is a Card (interactive; the open one, selected) with its count as a Badge (app/ui's since the
// 2026-11-17 shadcn pass); the entry's header is one Card (what, who plans it, what happens next); the routing rule is the Scoping
// chip's tooltip, not a paragraph. The cards column keeps Needs you's and Deliverables' own cards, on this tab's type
// and spacing rules.
// 2026-11-17: while nothing in the entry waits on the owner, one status card stands where the cards would (who is
// scoping, what they are on now, what is done so far, what comes next), in a slim column beside the chat when the pane
// is wide, so no column stands blank. With anything waiting the entry is as before.
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { ChevronRight } from "lucide-react";
import { WRITES, type Card, type Deliverables, type Projects, type Scope, type answerBody, type secretBody } from "../contract.ts";
import { ccCss } from "./cc-lines.tsx";
import { ChatBody, ChatCard, Composer, ThreadBox, directCss, markSeen } from "./direct-line.tsx";
import { CardView, useArming, via, type Act } from "./needs-you.tsx";
import { DeliverableCard, inScope } from "./deliverables.tsx";
import { answerCss } from "./answer-ui.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card as UiCard, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx";
import { Item, ItemGroup } from "./ui/item.tsx";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.tsx";
import { cn } from "./ui/utils.ts";
import { Chip, kitCss } from "./kit-ui.tsx";
import { STATE_CHIP, inScopeEntry, plannerOf, scopeDone, scopeEntries, scopeNext, scopeQuiet, scopeStatus, type ScopeEntry, type ScopeStatus } from "./kit.ts";
import { entryTitle, plannerName } from "./scope-names.ts";
import { projectTitle } from "../core/model.ts";
import { MonSprite } from "./mon.tsx";
import { OpenRef } from "./project-book.tsx";
import { panel } from "./refs.ts";
import { age } from "./lanes.ts";
import { isWide } from "./source.ts";
import { useElementWidth } from "./panes.tsx";
import { useMinute } from "./status-bar.tsx";
import { useIdentity } from "./identity.ts";
import { ownerOnScreen } from "../core/owner.ts";
import { gate, gone, useGate, write, type Hide, type WriteKind } from "./store.ts";
import { Btn, EmptyState, ReadState } from "./ui.tsx";
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
/* the list: grouped by project, each project under its name and its lead's avatar, each entry one card of one height */
[data-orch] .orch-scope__list { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
/* a pane too narrow for the list beside the entry: the groups sit side by side where two fit, so the entry and its chat come sooner */
[data-orch] .orch-scope[data-layout="column"] .orch-scope__list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; align-items: start; }
[data-orch] .orch-scope__group { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
/* the entry: its header card, then its cards, then its chat (beside the cards when the pane is wide) */
[data-orch] .orch-scope .orch-scope__entrybox { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
[data-orch] .orch-scope .orch-scope__fixed { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
[data-orch] .orch-scope__body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
[data-orch] .orch-scope__body[data-side="true"] { grid-template-columns: minmax(0, 1fr) minmax(360px, 1fr); }
[data-orch] .orch-scope__body[data-side="true"] > [data-scope-chat] { position: sticky; top: 8px; }
/* 2026-11-17, the owner: the list and the header stay put, only what is under the header scrolls (as on Projects). Wide,
   the tab takes the pane's height (panes.tsx [data-fits-pane]): the list scrolls on its own when it is taller, the
   entry's header card stays, and the body (its cards or status card, and the chat) is the one region that scrolls, from
   the top again for each entry (keyed by it). The chat beside the cards stays in view in it (sticky). One column keeps
   the one scroll of the pane */
[data-orch] [data-fits-pane] > .orch-scope { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; padding-bottom: 0; }
[data-orch] [data-fits-pane] .orch-scope__grid { flex: 1 1 0; min-height: 0; grid-template-rows: minmax(0, 1fr); align-items: stretch; }
[data-orch] [data-fits-pane] .orch-scope__list { min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding-bottom: 32px; }
[data-orch] [data-fits-pane] .orch-scope__entrybox { min-height: 0; }
/* the header keeps the body's scrollbar room (stable gutter), so its right edge lines up with the cards' */
[data-orch] [data-fits-pane] .orch-scope__fixed { flex: none; overflow: hidden; scrollbar-gutter: stable; margin: -2px; padding: 2px; }
[data-orch] [data-fits-pane] .orch-scope__body { flex: 1 1 0; min-height: 200px; overflow-y: auto; scrollbar-gutter: stable; padding-bottom: 32px; }
/* nothing waits (2026-11-17): the status card in a column about the list's width, the chat in all the rest */
[data-orch] .orch-scope__body[data-quiet="true"][data-side="true"] { grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); }
[data-orch] .orch-scope__col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
`;

/** The open cards first the "Scoping done?" one, then oldest first (the order the lead filed them in). */
const ordered = (cards: Card[]) => [...cards].sort((a, b) => Number(!!b.scopingDone) - Number(!!a.scopingDone) || (a.askedAt < b.askedAt ? -1 : 1));

/** What the gone-notice calls an entry: its project's name and its title. */
const entryWord = (e: ScopeEntry) => entryTitle(e).title;

/**
 * Who plans an entry, in one format everywhere (2026-11-17, the owner's Scope ask): the planner's avatar (the lead's or
 * the scoping thread's Pokémon; its letter with Pokémon off) and a short name, then its state and the task's slug, muted.
 * 2026-11-18, the owner: a long thread name ran past the card's edge and under its count. The words are one line now that
 * ends in an ellipsis inside the card; the full line is the tooltip.
 */
function PlannerLine({ e, mon, size = 20, slug = true, ...data }: { e: ScopeEntry; mon: (address: string) => string | null; size?: 20 | 24; slug?: boolean; [d: `data-${string}`]: string | undefined }) {
  const p = plannerName(e);
  const s = slug ? entryTitle(e).slug : null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={`${plannerOf(e).text}${s ? ` · ${s}` : ""}`} {...data}>
      <MonSprite mon={mon(p.address)} address={p.address} size={size} boost={false} />
      <span className="min-w-0 truncate">
        <span className="font-medium text-foreground">{p.name}</span>
        {p.state ? ` · ${p.state}` : null}
        {s ? <span className="font-mono"> · {s}</span> : null}
      </span>
    </span>
  );
}

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
  for (const e of entries) labels.set(e.key, `${projectTitle(e.slug)} › ${entryWord(e)}`);
  // the entry picked, else (it left the tab: its scoping ended) another of its project, else the first
  const pickedSlug = picked?.split("/")[0] ?? null;
  const entry = entries.find((e) => e.key === picked) ?? entries.find((e) => e.slug === pickedSlug) ?? entries[0]!;
  const left = picked && !entries.some((e) => e.key === picked) ? labels.get(picked) ?? null : null;
  const open = list.find((p) => p.slug === entry.slug)!;
  const task = entry.task?.id ?? null;
  const project = projects?.find((p) => p.slug === open.slug);
  // an avatar's Pokémon: a lead's from its project (as in the sidebar), a scoping thread's from the board
  const monOf = (address: string) => projects?.find((x) => `lead:${x.slug}` === address)?.lead?.mon ?? mons.get(address) ?? null;
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
  // nothing waits: the status card in place of the cards, beside the chat whenever the list is beside the entry
  const quiet = scopeQuiet({ cards: cards.length, delivered: delivered.length });
  const side = quiet ? wide : width >= CHAT_BESIDE_MIN;
  const planner = plannerOf(entry);
  const next = scopeNext(entry, { cards, delivered: delivered.length, hasLead: !!project?.lead });
  const routing = `What is filed here reaches only ${you.name}: no CoS triage, no standing rule.${entry.task && open.whole === false ? ` Only this task scopes here; the rest of ${open.slug} goes the normal way.` : ""}`;

  const listNav = (
    <nav className="orch-scope__list" aria-label="Scoping">
      {groups.map(({ p, entries: es }) => (
        <div key={p.slug} className="orch-scope__group" role="group" aria-label={projectTitle(p.slug)} data-scope-group={p.slug}>
          {/* the project as the sidebar names it, beside its lead's avatar */}
          <h3 className="m-0 flex min-w-0 items-center gap-2 px-1 text-sm font-semibold" title={p.slug}>
            <MonSprite mon={monOf(`lead:${p.slug}`)} address={`lead:${p.slug}`} size={24} boost={false} />
            <span className="truncate">{projectTitle(p.slug)}</span>
            {p.whole === false ? <span className="shrink-0 text-xs font-normal text-muted-foreground">active</span> : null}
          </h3>
          <ItemGroup className="gap-2">
            {es.map((e) => {
              const n = openCount(e);
              const current = e.key === entry.key;
              return (
                <div key={e.key} role="listitem" data-selected={current ? "true" : undefined}>
                  <Button
                    variant="outline"
                    className={cn("h-auto w-full justify-between gap-3 rounded-lg bg-card px-3 py-2.5 text-left font-normal whitespace-normal shadow-xs", current && "border-ring bg-accent")}
                    data-scope-pick={e.key}
                    aria-current={current ? "true" : undefined}
                    onClick={() => pick(e)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium">{entryTitle(e).title}</span>
                      <PlannerLine e={e} mon={monOf} data-planner={plannerOf(e).kind} data-scope-planner={e.key} />
                    </span>
                    {n ? (
                      <Badge className="h-5 min-w-5 shrink-0 rounded-full px-1.5 tabular-nums" data-scope-open={String(n)} role="img" title={`${n} waiting on you`} aria-label={`${n} waiting on you`}>
                        {n}
                      </Badge>
                    ) : null}
                  </Button>
                </div>
              );
            })}
          </ItemGroup>
        </div>
      ))}
    </nav>
  );
  const head = (
    <UiCard role="region" aria-label={`${projectTitle(open.slug)} › ${entryTitle(entry).title}`} className="orch-scope__head gap-3 py-4" data-scope-project={open.slug} data-scope-entry={entry.key}>
      <CardHeader className="px-4">
        <CardTitle role="heading" aria-level={2} className="flex min-w-0 items-center gap-1.5 text-base leading-6">
          <span className="shrink-0">{projectTitle(open.slug)}</span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium" title={entry.task?.name}>
            {entryTitle(entry).title}
          </span>
        </CardTitle>
        {/* min-w-0: the header's grid column can't grow past the card for a long line (2026-11-18, the owner) */}
        <CardDescription className="min-w-0">
          {/* the planner's avatar and name; the full line (and while nothing waits, the status card) say the rest */}
          <PlannerLine e={entry} mon={monOf} size={24} data-planner={planner.kind} data-scope-head-planner="" />
        </CardDescription>
        <CardAction>
          <Chip spec={STATE_CHIP.scoping} title={routing} data-scope-state="" />
        </CardAction>
      </CardHeader>
      {quiet ? null : (
        <CardContent className="px-4">
          <p className="m-0 text-sm" data-scope-next="">
            {next}
          </p>
        </CardContent>
      )}
    </UiCard>
  );
  const cardsCol = (
    <section className="orch-scope__col" data-scope-cards={open.slug} data-scope-cards-task={task ?? ""} aria-label={entry.task ? `${open.slug}'s cards for ${entry.task.name}` : `${open.slug}'s cards`}>
      {cards.length || delivered.length ? (
        <h3 className="m-0 px-1 text-xs font-normal text-muted-foreground" data-scope-waiting="">
          Waiting on you: {cards.length ? `${cards.length} ${cards.length === 1 ? "card" : "cards"}` : ""}
          {cards.length && delivered.length ? ", " : ""}
          {delivered.length ? `${delivered.length} to review` : ""}
        </h3>
      ) : null}
      {/* pass 4's cards, drawn as Needs you draws them: no frame of this tab's around them */}
      {cards.length ? (
        <div className="flex flex-col gap-3" data-list="scope">
          {cards.map((c) => (
            <CardView key={c.id} card={c} list="cards" presets={[]} isArmed={arming.isArmed(c.id, c.rev)} act={act} mon={mons.get(c.origin) ?? null} monType={accents?.get(open.slug) ?? null} />
          ))}
        </div>
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
          <p className="m-0 text-sm text-muted-foreground" data-scope-no-lead="">
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
    <div ref={setRoot} data-scope-tab="" data-scope-width={width} data-fits-pane={wide || undefined}>
      {styles}
      <div className="orch-cc orch-scope" data-layout={wide ? "list-detail" : "column"} data-chat={side ? "side" : "below"} style={wide ? undefined : { maxWidth: 800, marginInline: "auto" }}>
        <div className="orch-scope__grid">
          {listNav}
          <div className="orch-scope__entrybox">
            <div className="orch-scope__fixed" data-scope-fixed="">
              {left ? (
                <p className="m-0 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground" data-scope-left="">
                  {left} is no longer scoping: it left this tab, and anything still open under it went the normal way.
                </p>
              ) : null}
              {head}
            </div>
            <div key={entry.key} className="orch-scope__body" data-scope-scroll={entry.key} data-side={side ? "true" : "false"} data-quiet={quiet ? "true" : "false"}>
              {quiet ? (
                <StatusCard
                  entry={entry}
                  s={scopeStatus(entry, project)}
                  done={scopeDone(deliverables ?? [], open, task)}
                  next={next}
                  now={now}
                  mon={monOf}
                />
              ) : (
                cardsCol
              )}
              {chatCol}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const NOW_FROM: Record<NonNullable<ScopeStatus["now"]>["from"], string> = { report: "Last report", update: "Status update", step: "Current step" };
const DONE_SHOWN = 3;

/**
 * An entry's status while nothing waits on the owner (2026-11-17): who is scoping and whether they work (their avatar,
 * the Pokémon when that setting is on), what they are on now, the scoping deliverables already reviewed (each a link
 * to it on Deliverables; none: no row), and what comes next. shadcn's Card, Item rows and Badges.
 */
function StatusCard({ entry, s, done, next, now, mon }: { entry: ScopeEntry; s: ScopeStatus; done: Deliverables; next: string; now: number; mon: (address: string) => string | null }) {
  const address = s.who.address ?? `lead:${entry.slug}`;
  const idle = s.who.idleSince !== null ? age(s.who.idleSince, now) : null;
  const state = s.who.working ? "working" : s.who.state === "idle" && idle ? `idle ${idle}` : s.who.state;
  const label = "m-0 text-xs font-semibold text-muted-foreground";
  return (
    <UiCard role="region" className="orch-scope__status gap-4 py-4" data-scope-status={entry.key} aria-label={`${entry.slug}: who is scoping`}>
      <CardHeader className="flex items-center gap-3 px-4">
        <MonSprite mon={mon(address)} address={address} size={32} boost={false} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <CardTitle role="heading" aria-level={3} className="text-sm leading-5 [overflow-wrap:anywhere]">
            <span data-scope-who={s.who.kind}>{s.who.name}</span>
          </CardTitle>
          <CardDescription className="text-xs [overflow-wrap:anywhere]">{s.who.address ?? `No lead is running for ${entry.slug}`}</CardDescription>
        </div>
        <Badge variant={s.who.state === "stuck on an error" ? "destructive" : "outline"} className="shrink-0 self-start" data-scope-who-state={s.who.working ? "working" : s.who.state}>
          <span aria-hidden className={cn("size-1.5 rounded-full bg-current", s.who.working ? "text-(--success-foreground) motion-safe:animate-pulse" : "text-muted-foreground")} />
          {state}
        </Badge>
      </CardHeader>
      <CardContent className="px-4">
        <ItemGroup className="gap-3">
          <Item role="listitem" size="sm" className="flex-col items-stretch gap-1 p-0" data-scope-on-now={s.now?.from ?? "none"}>
            <h4 className={label}>On now</h4>
            {s.now ? (
              <div className="text-sm [overflow-wrap:anywhere]">
                {s.now.text}
                <span className="block text-xs text-muted-foreground">
                  {NOW_FROM[s.now.from]} · {age(s.now.at, now) ?? "<1m"} ago
                </span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{s.who.kind === "thread" ? "No report yet" : "No status yet"}</div>
            )}
          </Item>
          {done.length ? (
            // flex-nowrap: wrapping, a column is as wide as its widest line, so a long title would widen the card
            <Item role="listitem" size="sm" className="flex-col flex-nowrap items-stretch gap-1 p-0" data-scope-done={String(done.length)}>
              <h4 className={label}>Done so far</h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {done.slice(0, DONE_SHOWN).map((d) => (
                  <li key={d.id} className="flex min-w-0 items-center gap-2">
                    {/* a long title ends in an ellipsis and the pill stays in the card (2026-11-18, the owner) */}
                    <OpenRef open={panel("deliverables", `[data-deliverable="${d.id}"], [data-tree-key="d:${d.id}"]`, d.id)} title={`Open "${d.title}" on Deliverables`} data="deliverable">
                      {d.title}
                    </OpenRef>
                    {d.state === "approved" ? <Chip spec={{ tone: "good", icon: "check", word: "approved" }} /> : <Chip spec={{ tone: "quiet", icon: "quiet", word: "changes asked" }} />}
                  </li>
                ))}
              </ul>
              {done.length > DONE_SHOWN ? <span className="text-xs text-muted-foreground">{done.length - DONE_SHOWN} more on Deliverables</span> : null}
            </Item>
          ) : null}
          <Item role="listitem" size="sm" className="flex-col items-stretch gap-1 p-0" data-scope-then="">
            <h4 className={label}>Next</h4>
            <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{next}</div>
          </Item>
        </ItemGroup>
      </CardContent>
    </UiCard>
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
          <Tabs value={shown} onValueChange={(v) => setView(v as "lead" | "thread")}>
            <TabsList aria-label="Whose chat">
              <TabsTrigger value="lead" data-scope-view="lead">
                Lead
              </TabsTrigger>
              <TabsTrigger value="thread" data-scope-view="thread" title={planner.text}>
                Scoping thread
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <h3 className="m-0 text-sm font-semibold">Chat with the lead</h3>
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
