// The thread card (2026-11-17, proposal 3): one lead or thread, one unit, two lines. The title first (what it works on);
// then its state chip (a wait on the owner is a chip that opens the card), its PR and its PR's chips, and one context
// meter. Idle threads with nothing to merge recede; five show, then "all N". The order is kit.ts threadCards.
import { useState, type MouseEvent } from "react";
import type { z } from "zod";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { WRITES, type Projects, type projectModeBody, type scopeThreadBody, type unscopeThreadBody } from "../contract.ts";
import { DropdownMenu } from "./affect/dropdown-menu-clean.tsx";
import { MonSprite } from "./mon.tsx";
import { openInBb, plainClick } from "./open-proof.ts";
import { pickableTasks, prChips, scopeActions, STATE_CHIP, taskNameFor, TASK_NAME_MAX, threadCards, ticketOf, titleOf, THREADS_SHOWN, type ScopeAction, type ThreadSpec } from "./kit.ts";
import { Chip, ChipButton, CtxMeter } from "./kit-ui.tsx";
import type { Lane } from "./lanes.ts";
import type { OpenCard } from "./projects.tsx";
import { gate, write } from "./store.ts";
import { PageError } from "./ui.tsx";

export const threadCss = /* css */ `
[data-orch] .k-threads { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 4px 0 0; list-style: none; min-width: 0; }
[data-orch] .k-thread { display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 12px; row-gap: 4px; align-items: center; padding: 8px 12px; border: 1px solid var(--k-border); border-radius: 8px; min-width: 0; }
[data-orch] .k-thread .k-face { grid-row: 1 / span 2; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; }
[data-orch] .k-thread .k-face button { border: 0; background: none; padding: 0; display: flex; cursor: pointer; }
[data-orch] .k-thread .k-l1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
[data-orch] .k-thread .k-title { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: start; cursor: pointer; min-height: 24px; }
[data-orch] .k-thread .k-l2 { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; line-height: 16px; color: var(--orch-muted); }
[data-orch] .k-thread .k-who { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .k-thread[data-rest="true"] .k-title { font-weight: 400; }
[data-orch] .k-thread[data-rest="true"] .k-face { opacity: 0.6; }
[data-orch] .k-prlink { display: inline-flex; align-items: center; gap: 4px; flex: none; text-decoration: none; color: inherit; }
[data-orch] .k-prlink .k-n { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--orch-ink); font-variant-numeric: tabular-nums; text-decoration: underline; text-decoration-color: var(--k-border); text-underline-offset: 4px; }
@container orchcc (max-width: 640px) {
  [data-orch] .k-thread .k-l1, [data-orch] .k-thread .k-l2 { flex-wrap: wrap; }
  [data-orch] .k-thread .k-who { flex-basis: 100%; }
}
[data-orch] .k-thread .k-dots.k-dots { min-height: 24px; padding: 0 6px; font-size: 14px; flex: none; }
[data-orch] .k-thread .k-below { grid-column: 1 / -1; min-width: 0; }
[data-orch] .k-pick { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding: 12px; border-radius: 8px; background: var(--k-wash); font-size: 13px; line-height: 20px; }
[data-orch] .k-pick .k-pick-h { color: var(--orch-muted); font-size: 12px; line-height: 16px; }
[data-orch] .k-pick .k-pick-row { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
[data-orch] .k-pick .k-pick-row input[type="text"] { flex: 1 1 auto; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--k-border); border-radius: 6px; background: Canvas; color: var(--orch-ink); font: inherit; }
[data-orch] .k-pick .k-pick-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .k-pick .k-pick-by { flex: none; margin-left: auto; color: var(--orch-muted); font-size: 12px; line-height: 16px; }
[data-orch] .k-pick .k-pick-acts { display: flex; justify-content: flex-end; gap: 8px; }
`;

/** What a thread card's scoping menu needs from its project (1.13.0); without it the cards draw no menu. */
export type ScopingCtl = { slug: string; mode: "scoping" | "active" | undefined; tasks: NonNullable<Projects[number]["tasks"]>; busy: boolean; refetchAll: () => void };
type Agent = Lane["agent"];

/**
 * "Scope this thread…": a new task named after the thread (editable), or one of the project's open tasks. The write makes
 * the thread that task's scoping thread (the engine opens a new one through orch_scope_task's own path).
 */
function ScopePicker({ a, title, ctl, onDone }: { a: Agent; title: string; ctl: ScopingCtl; onDone: () => void }) {
  const tasks = pickableTasks(ctl.tasks, a.scopeTask);
  const [choice, setChoice] = useState<string>("new");
  const [name, setName] = useState(() => taskNameFor(title));
  const group = `scope-${a.threadId}`;
  const go = () => {
    const body: z.input<typeof scopeThreadBody> = choice === "new" ? { threadId: a.threadId, name: name.trim() } : { threadId: a.threadId, task: choice };
    onDone();
    void write(WRITES.scopeThread, body, { kind: "other", where: `scope:${a.threadId}`, after: ctl.refetchAll });
  };
  return (
    <div className="k-pick" role="dialog" aria-label={`Scope ${title}`} data-scope-picker={a.threadId} onKeyDown={(e) => (e.key === "Escape" ? onDone() : undefined)}>
      <div className="k-pick-h">It investigates read-only and makes no changes; the questions its lead forwards go to the Scope tab, under the task.</div>
      <label className="k-pick-row">
        <input type="radio" name={group} checked={choice === "new"} onChange={() => setChoice("new")} data-scope-new="" />
        <span>New task:</span>
        <input type="text" value={name} maxLength={TASK_NAME_MAX} autoFocus aria-label="The new task's name" data-scope-name="" onChange={(e) => (setName(e.target.value), setChoice("new"))} />
      </label>
      {tasks.map((t) => (
        <label key={t.id} className="k-pick-row">
          <input type="radio" name={group} checked={choice === t.id} onChange={() => setChoice(t.id)} data-scope-task={t.id} />
          <span className="k-pick-name" title={t.name}>
            {t.name}
          </span>
          <span className="k-pick-by">{t.planner ? `planned by ${t.planner}` : "planned by the lead"}</span>
        </label>
      ))}
      <div className="k-pick-acts">
        <button type="button" className="btn" data-scope-cancel="" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn primary" data-scope-go="" disabled={ctl.busy || (choice === "new" && !name.trim())} onClick={go}>
          Scope this thread
        </button>
      </div>
    </div>
  );
}

/** The card's ⋯ menu: the lead's switches its whole project, a thread's scopes it or stops it. Direct writes, no card. */
function ScopeMenu({ a, title, ctl, onPick }: { a: Agent; title: string; ctl: ScopingCtl; onPick: () => void }) {
  const acts = scopeActions(a, ctl.mode);
  if (!acts.length) return null;
  const run = (x: ScopeAction) => {
    const where = `scope:${a.threadId}`;
    if (x.kind === "pick") return onPick();
    if (x.kind === "project") {
      const body: z.input<typeof projectModeBody> = { slug: ctl.slug, mode: x.mode };
      return void write(WRITES.projectMode, body, { kind: "other", where, after: ctl.refetchAll });
    }
    const body: z.input<typeof unscopeThreadBody> = { threadId: a.threadId };
    void write(WRITES.unscopeThread, body, { kind: "other", where, after: ctl.refetchAll });
  };
  return (
    <DropdownMenu
      align="end"
      title={title}
      items={acts.map((x) => ({ label: x.label, description: x.kind === "stop" ? `task ${JSON.stringify(x.task.name)} stays open` : undefined, disabled: ctl.busy, data: { "data-scope-action": x.kind }, onSelect: () => run(x) }))}
      trigger={({ triggerProps }) => (
        <button type="button" className="k-more k-dots" data-thread-more={a.address} aria-label={`More for ${a.address}`} title="Scoping" disabled={ctl.busy} {...triggerProps}>
          ⋯
        </button>
      )}
    />
  );
}

type Pr = NonNullable<Lane["agent"]["pr"]>;

/** A PR's number (opens it in bb) and its chips, as one link. */
export function PrLink({ pr }: { pr: Pr }) {
  const nav = useBbNavigate();
  const chips = prChips(pr).map((c) => <Chip key={c.word} spec={c} />);
  const body = (
    <>
      <span className="k-n">#{pr.number ?? "?"}</span>
      {chips}
    </>
  );
  return pr.url ? (
    <a
      className="k-prlink"
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      title={pr.url}
      data-open-in-bb=""
      data-lane-pr={String(pr.number ?? "")}
      onClick={(e: MouseEvent) => {
        if (pr.url && plainClick(e) && openInBb(nav, { url: pr.url })) e.preventDefault();
      }}
    >
      {body}
    </a>
  ) : (
    <span className="k-prlink" data-lane-pr={String(pr.number ?? "")}>
      {body}
    </span>
  );
}

function ThreadCard({ t, openCard, ctl }: { t: ThreadSpec; openCard: OpenCard; ctl?: ScopingCtl }) {
  const nav = useBbNavigate();
  const [picking, setPicking] = useState(false);
  const { lane: l, chip, rest } = t;
  const a = l.agent;
  const lead = a.role === "lead";
  const mon = a.form ?? a.mon;
  const open = () => nav.toThread(a.threadId);
  const title = titleOf(l.activity) ?? (lead ? "Lead" : a.address);
  const who = [mon, lead ? "lead" : `thread ${a.address.split(":")[2] ?? ""}`, ticketOf(l.activity), l.model, mon ? `Lv ${a.level}` : null].filter(Boolean).join(" · ");
  const w = l.wait;
  return (
    <li className="k-thread" data-lane={a.address} data-lane-state={l.state} data-lane-wait={w?.on ?? ""} data-rest={rest ? "true" : "false"}>
      <span className="k-face">
        <button type="button" data-open-thread={a.threadId} title={`Open ${a.address}`} onClick={open}>
          <MonSprite mon={mon} address={a.address} size={28} boost={false} />
        </button>
      </span>
      <div className="k-l1">
        <button type="button" className="k-title" title={l.activity ?? a.address} onClick={open}>
          {title}
        </button>
        {a.unread ? <i className="unread" role="img" aria-label="something new" data-lane-unread="" title="something new since you last looked" /> : null}
        {a.flags.includes("unplanned") ? <Chip spec={{ tone: "warn", icon: "wait", word: "unplanned" }} data-unplanned="" title="started outside the plan" /> : null}
        {w?.on === "owner" ? (
          <ChipButton spec={chip} title="Open the card" data-wait="owner" data-wait-card={w.cardId ?? ""} onClick={() => openCard(w.cardId ? `[data-card="${w.cardId}"]` : `[data-interaction="${w.threadId}"]`)} />
        ) : (
          <Chip spec={chip} />
        )}
        {a.scopeTask ? (
          <Chip spec={STATE_CHIP.scoping} data-thread-scoping={a.scopeTask.id} title={`The scoping thread for task ${JSON.stringify(a.scopeTask.name)}`} />
        ) : lead && ctl?.mode === "scoping" ? (
          <Chip spec={STATE_CHIP.scoping} data-thread-scoping="project" title={`${ctl.slug} is scoping as a whole`} />
        ) : null}
        {ctl ? <ScopeMenu a={a} title={title} ctl={ctl} onPick={() => setPicking(true)} /> : null}
      </div>
      <div className="k-l2">
        <span className="k-who" title={a.address}>
          {who}
        </span>
        {a.pr ? <PrLink pr={a.pr} /> : null}
        <CtxMeter used={a.usedTokens} window={a.contextWindow} />
      </div>
      {ctl && picking ? <ScopePicker a={a} title={title} ctl={ctl} onDone={() => setPicking(false)} /> : null}
      {ctl && gate.error?.where === `scope:${a.threadId}` ? (
        <div className="k-below">
          <PageError where={`scope:${a.threadId}`} />
        </div>
      ) : null}
    </li>
  );
}

/** The live lanes as cards, five then "all N" (the button sits in the Now card's head: `all` and `setAll`). */
export function ThreadCards({ lanes, now, owner, openCard, all, ctl }: { lanes: Lane[] | undefined; now: number; owner: string; openCard: OpenCard; all: boolean; ctl?: ScopingCtl }) {
  const cards = threadCards(lanes, now, owner);
  const shown = all ? cards : cards.slice(0, THREADS_SHOWN);
  return (
    <ul className="k-threads" data-lanes="">
      {shown.map((t) => (
        <ThreadCard key={t.lane.agent.threadId} t={t} openCard={openCard} ctl={ctl} />
      ))}
    </ul>
  );
}

