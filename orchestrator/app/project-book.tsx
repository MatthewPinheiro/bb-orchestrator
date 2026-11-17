// One project as a source of truth (2026-11-16, layout B): seven sections, each line with its age and its source.
// Goal (the lead's status, flagged when stale or contradicted), Now (the live lanes), Needs <owner>, Blocked by (since
// the lead first said it), PRs in flight (and merged today), Decided (the owner's own answers on it) and Done. On a wide
// tab it fills the panel beside the list, two columns under the goal; narrower, it opens in place under the project's
// row. Decided, Done, the merges and the blockers' start are read for this project only (core/book.ts), refreshed on
// the same change signal as the list, so the two sides never disagree.
import { useCallback, useContext, useRef, type MouseEvent, type ReactNode } from "react";
import { experimental_useRpcQuery, useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import { CHANGED_CHANNEL, rpcContract, type NeedsYou, type ProjectBook as Book, type Projects } from "../contract.ts";
import { position } from "../core/status.ts";
import { outOfDateLine, statusStale, waitLine } from "./command-center.ts";
import { WaitLineView } from "./cc-lines.tsx";
import { PrChip, RefText, RefsContext } from "./ref-text.tsx";
import { openInBb, plainClick, type Openable } from "./open-proof.ts";
import { panel } from "./refs.ts";
import { age, type Lane } from "./lanes.ts";
import { blockerLines, dayStart, mergedToday, mergedTodayCount, needLines, otherWaits, prsInFlight, type NeedLine } from "./source.ts";

type Project = Projects[number];

export const bookCss = /* css */ `
[data-orch] .orch-cc .book { display: flex; flex-direction: column; gap: 24px; cursor: default; min-width: 0; }
[data-orch] .orch-cc .book .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px 48px; }
[data-orch] .orch-cc .book .col { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
[data-orch] .orch-cc .book .sec { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
[data-orch] .orch-cc .book .sec-h { margin: 0 0 4px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--orch-muted); }
[data-orch] .orch-cc .book .empty { color: var(--orch-muted); padding-left: 16px; }
[data-orch] .orch-cc .book .goal { padding-left: 16px; }
[data-orch] .orch-cc .book .ln .tx { max-width: none; }
[data-orch] .orch-cc .book .ln .tx.wrap { white-space: normal; }
[data-orch] .orch-cc .book .answer { font-weight: 600; }
[data-orch] .orch-cc .book .lanes { margin-left: 0; }
[data-orch] .orch-cc .ln .tx > button.ref, [data-orch] .orch-cc .ln .tx > .rest > button.ref { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
/* A lead-in (the project's name, the Needs you pill) then the words: the words shorten on their own. Without this the
   line's ellipsis hides a long question button whole (an ellipsis drops an inline-block entirely), leaving "name …". */
[data-orch] .orch-cc .ln .tx.fit { display: flex; align-items: baseline; }
[data-orch] .orch-cc .ln .tx.fit > * { flex: none; }
[data-orch] .orch-cc .ln .tx.fit > .rest { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@container orchcc (max-width: 640px) {
  [data-orch] .orch-cc .ln .tx > button.ref, [data-orch] .orch-cc .ln .tx > .rest > button.ref { white-space: normal; overflow: visible; }
  [data-orch] .orch-cc .ln .tx.fit { display: block; }
  [data-orch] .orch-cc .ln .tx.fit > .rest { display: inline; white-space: normal; overflow: visible; }
}
[data-orch] .orch-cc.narrow-book .book .cols { grid-template-columns: minmax(0, 1fr); }
`;

/** A link to something the page knows, opened in bb (openInBb): a card, a deliverable, a PR. */
export function OpenRef({ open, children, title, data }: { open: Openable; children: ReactNode; title: string; data: string }) {
  const nav = useBbNavigate();
  const click = (e: MouseEvent) => {
    if (plainClick(e) && openInBb(nav, open)) e.preventDefault();
  };
  return open.url ? (
    <a className="ref" href={open.url} target="_blank" rel="noopener noreferrer" data-ref={data} data-open-in-bb="" title={title} onClick={click}>
      {children}
    </a>
  ) : (
    <button type="button" className="ref" data-ref={data} data-open-in-bb="" title={title} onClick={click}>
      {children}
    </button>
  );
}

const stamp = (t: number) => new Date(t).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Section({ name, head, children }: { name: string; head: ReactNode; children: ReactNode }) {
  return (
    <section className="sec" data-book-section={name}>
      <h4 className="sec-h">{head}</h4>
      {children}
    </section>
  );
}

function Goal({ p, now, askStatus }: { p: Project; now: number; askStatus: (() => void) | null }) {
  const s = p.status;
  const out = outOfDateLine(p);
  const stale = statusStale(p, now) && p.heldAt === null;
  if (!s)
    return (
      <Section name="goal" head="Goal">
        <div className="empty" data-no-status="">
          {p.lead ? "No status from the lead yet" : "No lead"}
          {askStatus ? (
            <>
              {" · "}
              <button type="button" className="link" data-ask-status={p.slug} onClick={askStatus}>
                Ask for status
              </button>
            </>
          ) : null}
        </div>
      </Section>
    );
  const pos = position(s);
  return (
    <Section name="goal" head="Goal">
      <div className="goal" data-goal="">
        <RefText text={s.goal} />
      </div>
      <div className="ln quietly">
        <span className="tx">
          {pos.total ? `step ${pos.at} of ${pos.total}${pos.title && pos.kind !== "done" ? `: ${pos.title}` : ""}` : "no steps"}
        </span>
        <span className="tail">lead said {age(s.updatedAt, now)} ago</span>
      </div>
      {/* a stale or contradicted status is flagged, never drawn as current */}
      {out ? (
        <div className="ln" data-status-outdated="">
          <i className="dot old" />
          <span className="tx">{out}: a line it names is over, so that line is hidden</span>
        </div>
      ) : stale ? (
        <div className="ln" data-status-stale="true">
          <i className="dot old" />
          <span className="tx">
            <b className="warn">Status is {age(s.updatedAt, now)} old</b>: the lead hasn't said since
            {askStatus ? (
              <>
                {" · "}
                <button type="button" className="link" data-ask-status={p.slug} onClick={askStatus}>
                  Ask for status
                </button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
    </Section>
  );
}

function NeedRow({ l, now, cos, openCard }: { l: NeedLine; now: number; cos: string; openCard: (selector: string) => void }) {
  if (l.kind === "wait") {
    const w = waitLine(l.wait, now, cos);
    return (
      <div className="ln" data-need="wait" data-wait-source={l.wait.source}>
        {w.old ? <i className="dot old" /> : null}
        <span className="tx" title={w.text}>
          <RefText text={w.text} exact={l.wait.ref} />
          {l.noCard ? <span className="lead"> (no card)</span> : null}
        </span>
        <span className="tail">{w.tail}</span>
      </div>
    );
  }
  const sel = l.kind === "card" ? `[data-card="${l.id}"]` : `[data-interaction="${l.threadId}"]`;
  return (
    <div className="ln need" data-need={l.kind}>
      <span className="tx" title={l.text}>
        <button type="button" className="q ref" data-open-card={l.kind === "card" ? l.id : ""} onClick={() => openCard(sel)}>
          {l.text}
        </button>
        {l.kind === "prompt" ? <span className="lead"> · a prompt in {l.address.replace(/^thread:[^:]+:/, "thread ")}</span> : null}
      </span>
      {l.since ? <span className="tail">asked {age(l.since, now)} ago · live</span> : <span className="tail">live</span>}
    </div>
  );
}

/** The seven sections of one project. `lanesView`: the Now section's lanes, drawn by the tab (projects.tsx). */
export function ProjectBook({
  project: p,
  lanes,
  now,
  cards,
  cos,
  ownerName,
  openCard,
  askStatus,
  lanesView,
  wide,
}: {
  project: Project;
  lanes: Lane[] | undefined;
  now: number;
  cards: NeedsYou["cards"];
  cos: string;
  ownerName: string;
  openCard: (selector: string) => void;
  askStatus: (() => void) | null;
  lanesView: ReactNode;
  wide: boolean;
}) {
  const q = experimental_useRpcQuery({ contract: rpcContract, method: "projectBook", input: { slug: p.slug, dayStart: dayStart(now) } });
  const refetch = useRef(q.refetch);
  refetch.current = q.refetch;
  useRealtime(
    CHANGED_CHANNEL,
    useCallback(() => void refetch.current(), []),
  );
  const shared = useContext(RefsContext);
  const book: Book | undefined = q.data;
  const needs = needLines(p, lanes, cards);
  const others = otherWaits(p);
  const blockers = blockerLines(p, book);
  const prs = prsInFlight(p);
  const today = mergedToday(book, now);
  const todayCount = mergedTodayCount(book, now);
  const live = (lanes ?? []).filter((l) => l.state !== "released");
  const working = live.filter((l) => l.state === "working").length;
  const loading = !book ? <div className="empty">{q.error ? `Couldn't read it: ${q.error.message}` : "Reading…"}</div> : null;

  const goal = <Goal p={p} now={now} askStatus={askStatus} />;
  const nowSec = (
    <Section name="now" head={`Now · ${working} of ${live.length} working`}>
      {live.length ? lanesView : <div className="empty">No live lead or threads</div>}
    </Section>
  );
  const needSec = (
    <Section name="needs" head={`Needs ${ownerName}`}>
      {needs.length ? needs.map((l, i) => <NeedRow key={`${l.kind}|${i}`} l={l} now={now} cos={cos} openCard={openCard} />) : <div className="empty">Nothing waits on {ownerName === "you" ? "you" : ownerName}</div>}
    </Section>
  );
  const blockedSec = (
    <Section name="blocked" head="Blocked by · waiting on">
      {blockers.map((b, i) => (
        <div key={`b${i}`} className="ln blocker" data-blocker="">
          <i className="dot blocked" />
          <span className="tx" title={`Blocked by ${b.text}`}>
            <RefText text={b.text} />
          </span>
          {b.since ? (
            <span className="tail" data-blocker-since={b.bound ? "at-least" : b.first ? "first-said" : "status"}>
              {b.bound ? `for over ${age(b.since, now)} · lead said` : b.first ? `since ${age(b.since, now)} · lead said` : `lead said ${age(b.since, now)} ago`}
            </span>
          ) : null}
        </div>
      ))}
      {others.map((w, i) => (
        <WaitLineView key={`w${w.kind}|${w.ref ?? i}`} w={w} now={now} cos={cos} />
      ))}
      {!blockers.length && !others.length ? <div className="empty">Nothing blocks it</div> : null}
    </Section>
  );
  const prSec = (
    <Section name="prs" head={`PRs in flight · ${prs.length}${todayCount ? ` · ${todayCount} merged today` : ""}`}>
      {prs.map((x) => (
        <div key={x.url} className="ln" data-pr-line={x.number}>
          <span className="tx">
            <OpenRef open={{ url: x.url }} title={x.url} data="pr">
              PR #{x.number}
            </OpenRef>
            <PrChip pr={x} />
          </span>
          <span className="tail">live</span>
        </div>
      ))}
      {today.map((m, i) => (
        <div key={`m${i}`} className="ln quietly" data-merged-today="">
          <span className="tx">
            {m.url ? (
              <OpenRef open={{ url: m.url }} title={m.url} data="pr">
                PR {m.number ? `#${m.number}` : ""}
              </OpenRef>
            ) : (
              `PR ${m.number ? `#${m.number}` : ""}`
            )}{" "}
            merged
          </span>
          <span className="tail">{age(m.at, now)} ago · live</span>
        </div>
      ))}
      {!prs.length && !today.length ? <div className="empty">No open PRs</div> : null}
    </Section>
  );
  const decidedSec = (
    <Section name="decided" head={`Decided · ${ownerName === "you" ? "your" : `${ownerName}'s`} answers`}>
      {loading ??
        (book!.decided.length ? (
          book!.decided.map((d) => (
            <div key={d.id} className="ln" data-decided={d.id}>
              <span className="tx" title={`${d.title} → ${d.answer}`}>
                {shared?.cards.has(d.id) ? (
                  <OpenRef open={panel("board", `[data-decision="${d.id}"]`)} title="Open the answered card in Activity" data="card">
                    {d.title}
                  </OpenRef>
                ) : (
                  d.title
                )}{" "}
                → <span className="answer">{d.answer}</span>
              </span>
              <span className="tail">{stamp(d.at)}</span>
            </div>
          ))
        ) : (
          <div className="empty">No answers on this project yet</div>
        ))}
    </Section>
  );
  const doneSec = (
    <Section name="done" head="Done">
      {loading ??
        (book!.done.length ? (
          book!.done.map((d, i) => (
            <div key={`${d.kind}|${d.ref ?? i}`} className="ln" data-done-line={d.kind}>
              <span className="tx" title={d.text}>
                {d.kind === "deliverable" && d.ref && shared?.deliverables.has(d.ref) ? (
                  <OpenRef open={panel("deliverables", `[data-deliverable="${d.ref}"], [data-tree-key="d:${d.ref}"]`, d.ref)} title="Open in Deliverables" data="deliverable">
                    {d.text}
                  </OpenRef>
                ) : d.kind === "merged" && d.ref ? (
                  <OpenRef open={{ url: d.ref }} title={d.ref} data="pr">
                    {d.text}
                  </OpenRef>
                ) : (
                  <RefText text={d.text} />
                )}
                {d.kind === "deliverable" ? <span className="lead"> · {d.state === "approved" ? "approved" : "in your review"}</span> : null}
              </span>
              <span className="tail">
                {age(d.at, now)} ago · {d.kind === "report" ? "thread said" : "live"}
              </span>
            </div>
          ))
        ) : (
          <div className="empty">Nothing finished yet</div>
        ))}
    </Section>
  );
  return (
    <div className="book" data-book={p.slug}>
      {goal}
      {wide ? (
        <div className="cols">
          <div className="col">
            {needSec}
            {blockedSec}
            {nowSec}
          </div>
          <div className="col">
            {prSec}
            {decidedSec}
            {doneSec}
          </div>
        </div>
      ) : (
        <>
          {needSec}
          {blockedSec}
          {nowSec}
          {prSec}
          {decidedSec}
          {doneSec}
        </>
      )}
    </div>
  );
}
