// The Scope tab (1.11.0): the projects in scoping mode, where the owner works out a new project with its lead directly.
// One project open at a time: the chat with its lead (the 1.10.0 chat log and composer, direct-line.tsx) beside the
// cards its lead filed and the deliverables it handed over, answerable in place with Needs you's own card and the
// Deliverables tab's own card. While the project scopes these never reach the CoS's triage, Needs you or Deliverables;
// the owner's yes on the lead's "Scoping done?" card makes the project active, and it leaves this tab.
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { WRITES, type Card, type Deliverables, type Projects, type Scope, type answerBody, type secretBody } from "../contract.ts";
import { ccCss } from "./cc-lines.tsx";
import { ChatLog, Composer, directCss, markSeen } from "./direct-line.tsx";
import { CardView, useArming, via, type Act } from "./needs-you.tsx";
import { DeliverableCard, inScope } from "./deliverables.tsx";
import { answerCss } from "./answer-ui.tsx";
import { css as inboxCss } from "./affect/decision-inbox-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { Chip, kitCss } from "./kit-ui.tsx";
import { STATE_CHIP } from "./kit.ts";
import { useElementWidth } from "./panes.tsx";
import { useMinute } from "./status-bar.tsx";
import { useIdentity } from "./identity.ts";
import { ownerOnScreen } from "../core/owner.ts";
import { gate, gone, useGate, write, type Hide, type WriteKind } from "./store.ts";
import { ReadState } from "./ui.tsx";
import { styleHref } from "./style-href.ts";

type Query = { data: Scope | undefined; error: { message: string } | null; refetch: () => Promise<void> };
type Project = Projects[number];

/** Side by side from this pane width; under it the chat sits above the cards. */
const SIDE_MIN = 1000;

const scopeCss = /* css */ `
[data-orch] .orch-scope { display: flex; flex-direction: column; gap: 16px; padding-bottom: 32px; }
[data-orch] .orch-scope__pick { display: flex; flex-wrap: wrap; gap: 4px; }
[data-orch] .orch-scope__pick button { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 12px; border-radius: 8px; font-size: 14px; color: var(--orch-muted); }
[data-orch] .orch-scope__pick button:hover { background: var(--orch-wash); }
[data-orch] .orch-scope__pick button[aria-current="true"] { color: var(--orch-ink); font-weight: 600; background: color-mix(in srgb, var(--orch-ink) 8%, transparent); box-shadow: inset 0 0 0 1px var(--k-border, var(--orch-line)); }
[data-orch] .orch-scope__n { font-size: 12px; font-weight: 400; color: var(--orch-muted); }
[data-orch] .orch-scope__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
[data-orch] .orch-scope__head .name { font-size: 16px; line-height: 24px; font-weight: 600; }
[data-orch] .orch-scope__head .what { font-size: 12px; line-height: 16px; color: var(--orch-muted); }
[data-orch] .orch-scope__body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
[data-orch] .orch-scope__body[data-side="true"] { grid-template-columns: minmax(360px, 1fr) minmax(0, 1fr); }
[data-orch] .orch-scope__col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
[data-orch] .orch-scope__h { margin: 0; font-size: 12px; line-height: 16px; font-weight: 400; color: var(--orch-muted); }
[data-orch] .orch-scope__none { margin: 0; font-size: 14px; color: var(--orch-muted); }
`;

/** The open cards first the "Scoping done?" one, then oldest first (the order the lead filed them in). */
const ordered = (cards: Card[]) => [...cards].sort((a, b) => Number(!!b.scopingDone) - Number(!!a.scopingDone) || (a.askedAt < b.askedAt ? -1 : 1));

/** `focus`: the project a link elsewhere (a project's "Answer") asked to open here. */
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
          title="No project is scoping"
          text={`A new project can start in scoping mode: ${you.name} and its lead settle its goal, constraints and first plan here, in a chat beside its cards, before any build thread starts. The CoS starts one with orch_new_project (mode scoping) or switches a project with orch_project_mode.`}
        />
      </div>
    );
  const open = list.find((p) => p.slug === picked) ?? list[0]!;
  const project = projects?.find((p) => p.slug === open.slug);
  const pick = (slug: string) => {
    setPicked(slug);
    const p = projects?.find((x) => x.slug === slug);
    if (p) markSeen(p, refetchAll); // choosing the project shows its chat, so the lead's replies there are seen
  };

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
  const cards = ordered(open.cards.filter((c) => !gone.has(`${c.id}@${c.rev}`)));
  const delivered = (deliverables ?? []).filter((d) => d.project === open.slug && inScope(d)).sort((a, b) => b.updatedAt - a.updatedAt);
  const side = width >= SIDE_MIN;
  return (
    <div ref={setRoot} data-scope-tab="" data-scope-width={width}>
      {styles}
      <div className="orch-cc orch-scope" data-layout={side ? "side" : "column"} style={side ? undefined : { maxWidth: 800, marginInline: "auto" }}>
        {list.length > 1 ? (
          <nav className="orch-scope__pick" aria-label="Scoping projects">
            {list.map((p) => (
              <button key={p.slug} type="button" data-scope-pick={p.slug} aria-current={p.slug === open.slug ? "true" : undefined} onClick={() => pick(p.slug)}>
                {p.slug}
                <span className="orch-scope__n">{p.cards.length ? `${p.cards.length} open` : "nothing open"}</span>
              </button>
            ))}
          </nav>
        ) : null}
        <div className="orch-scope__head" data-scope-project={open.slug}>
          <span className="name">{open.slug}</span>
          <Chip spec={STATE_CHIP.scoping} data-scope-state="" />
          <span className="what">
            {cards.length} open {cards.length === 1 ? "card" : "cards"}
            {delivered.length ? `, ${delivered.length} to review` : ""}. They reach only {you.name} here: no CoS triage, no standing rule.
          </span>
        </div>
        <div className="orch-scope__body" data-side={side ? "true" : "false"}>
          <section className="orch-scope__col" data-scope-chat={open.slug} aria-label={`Chat with the ${open.slug} lead`}>
            {project?.lead ? (
              <div className="direct" data-direct-line={open.slug}>
                <ChatLog key={open.slug} startOpen project={project} now={now} cos={cosTitle} busy={gate.lock !== null} refetchAll={refetchAll} onPick={() => setPicked(open.slug)} />
                <Composer
                  project={project}
                  now={now}
                  cos={cosTitle}
                  busy={gate.lock !== null}
                  refetchAll={refetchAll}
                  onFocus={() => {
                    setPicked(open.slug);
                    markSeen(project, refetchAll);
                  }}
                />
              </div>
            ) : (
              <p className="orch-scope__none" data-scope-no-lead="">
                {project ? `No lead is running for ${open.slug} yet: start it from Projects, and the chat opens here.` : "Loading the chat…"}
              </p>
            )}
          </section>
          <section className="orch-scope__col" data-scope-cards={open.slug} aria-label={`${open.slug}'s cards`}>
            <h3 className="orch-scope__h">From the lead</h3>
            {cards.length === 0 && delivered.length === 0 ? <p className="orch-scope__none">Nothing open: the lead's questions, plans and deliverables show up here.</p> : null}
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
        </div>
      </div>
    </div>
  );
}
