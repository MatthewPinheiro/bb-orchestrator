// The thread card (2026-11-17, proposal 3): one lead or thread, one unit, two lines. The title first (what it works on);
// then its state chip (a wait on the owner is a chip that opens the card), its PR and its PR's chips, and one context
// meter. Idle threads with nothing to merge recede; five show, then "all N". The order is kit.ts threadCards.
import type { MouseEvent } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { MonSprite } from "./mon.tsx";
import { openInBb, plainClick } from "./open-proof.ts";
import { prChips, threadCards, ticketOf, titleOf, THREADS_SHOWN, type ThreadSpec } from "./kit.ts";
import { Chip, ChipButton, CtxMeter } from "./kit-ui.tsx";
import type { Lane } from "./lanes.ts";
import type { OpenCard } from "./projects.tsx";

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
`;

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

function ThreadCard({ t, openCard }: { t: ThreadSpec; openCard: OpenCard }) {
  const nav = useBbNavigate();
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
      </div>
      <div className="k-l2">
        <span className="k-who" title={a.address}>
          {who}
        </span>
        {a.pr ? <PrLink pr={a.pr} /> : null}
        <CtxMeter used={a.usedTokens} window={a.contextWindow} />
      </div>
    </li>
  );
}

/** The live lanes as cards, five then "all N" (the button sits in the Now card's head: `all` and `setAll`). */
export function ThreadCards({ lanes, now, owner, openCard, all }: { lanes: Lane[] | undefined; now: number; owner: string; openCard: OpenCard; all: boolean }) {
  const cards = threadCards(lanes, now, owner);
  const shown = all ? cards : cards.slice(0, THREADS_SHOWN);
  return (
    <ul className="k-threads" data-lanes="">
      {shown.map((t) => (
        <ThreadCard key={t.lane.agent.threadId} t={t} openCard={openCard} />
      ))}
    </ul>
  );
}

