// The lead's status (2026-11-16, core/status.ts), drawn two ways: the step bar at the top of a project's page (numbered
// steps with the current one lit, "Step 3 of 5: <title>", what it waits on, linked where it can be, its blockers and
// when it was published) and one line on the Projects list ("step 3/5 · waiting on PR 1301"). Both say "stale" once
// the lead hasn't published for 2 h; a minute timer keeps that true on a page left open.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { Projects } from "../contract.ts";
import { isStale, position, statusLine, stepHeadline, waitTarget } from "../core/status.ts";
import { Badge } from "./affect/badge-clean.tsx";
import { KIND_TONES, css, tint, type Tone } from "./palette.ts";
import { age, type Lane } from "./lanes.ts";
import { cx } from "./ui.tsx";
import type { OpenCard } from "./projects.tsx";

type Status = NonNullable<Projects[number]["status"]>;

/** Date.now(), again each minute: "stale" and "12m ago" move on while the page stays open. */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const DONE = KIND_TONES.done;
const CURRENT = KIND_TONES.merge;
const STALE = KIND_TONES.deferred;
const BLOCKER = KIND_TONES.alarm;
const WAIT = KIND_TONES.asked;
const chip = (t: Tone): CSSProperties => ({ "--bg": tint(t), "--fg": css(t) }) as CSSProperties;

function Updated({ s, now }: { s: Status; now: number }) {
  const stale = isStale(s, now);
  const ago = age(s.updatedAt, now);
  const at = new Date(s.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return stale ? (
    <Badge data-status-stale="true" style={chip(STALE)}>
      <span className="whitespace-nowrap" title={`Published ${at}`}>
        stale · {ago} ago
      </span>
    </Badge>
  ) : (
    <span data-status-stale="false" className="orch-muted whitespace-nowrap text-xs" title={`Published ${at}`}>
      updated {ago} ago
    </span>
  );
}

/** One step: a numbered dot (a tick when done, a dash when skipped) and, from tablet width, its title under it. */
function Step({ n, step, last }: { n: number; step: Status["steps"][number]; last: boolean }) {
  const cur = step.state === "current";
  const done = step.state === "done";
  const skipped = step.state === "skipped";
  const tone = cur ? CURRENT : done ? DONE : null;
  const dot: CSSProperties = cur
    ? { background: css(CURRENT), color: "Canvas", boxShadow: `0 0 0 3px ${tint(CURRENT)}` }
    : done
      ? { background: tint(DONE), color: css(DONE), border: `1.5px solid ${css(DONE)}` }
      : { color: "var(--orch-muted)", border: `1.5px ${skipped ? "dashed" : "solid"} var(--orch-muted)` };
  return (
    <li data-step={n} data-step-state={step.state} aria-current={cur ? "step" : undefined} className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div className="flex w-full items-center">
        <span aria-hidden className="h-px flex-1" style={{ background: n === 1 ? "transparent" : "var(--orch-line)" }} />
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
          style={dot}
          title={`${n}. ${step.title} (${step.state})`}
        >
          {done ? "✓" : skipped ? "–" : n}
        </span>
        <span aria-hidden className="h-px flex-1" style={{ background: last ? "transparent" : "var(--orch-line)" }} />
      </div>
      <span
        className={cx("hidden w-full truncate px-1 text-center text-xs sm:block", cur ? "font-semibold" : "orch-muted", skipped && "line-through")}
        style={tone && cur ? { color: css(tone) } : undefined}
        title={step.title}
      >
        {step.title}
      </span>
    </li>
  );
}

/** What it waits on, linked: a PR or URL opens it, a thread address opens the thread, the owner's card opens on Needs you. */
function Waiting({ s, ownerName, lanes, openCard }: { s: Status; ownerName: string; lanes: Lane[] | undefined; openCard: OpenCard }) {
  const navigate = useBbNavigate();
  const w = s.waitingOn;
  const target = waitTarget(w, ownerName);
  if (!target) return null;
  const label = w.label && w.label !== target ? w.label : null;
  const body = (
    <Badge style={chip(WAIT)}>
      <span className="whitespace-nowrap">
        waiting on <span className="font-semibold">{target}</span>
      </span>
    </Badge>
  );
  const url = w.ref && /^https?:\/\//.test(w.ref) ? w.ref : null;
  const thread = w.kind === "thread" && w.ref ? (lanes?.find((l) => l.agent.address === w.ref)?.agent.threadId ?? (w.ref.startsWith("thr_") ? w.ref : null)) : null;
  const card = w.kind === "owner" && w.ref && /^d-/.test(w.ref) ? w.ref : null;
  const link = url ? (
    <a href={url} target="_blank" rel="noreferrer" className="no-underline hover:underline" title={url} data-status-wait-link="url">
      {body} ↗
    </a>
  ) : thread ? (
    <button type="button" data-status-wait-link="thread" title={`Open ${w.ref}`} onClick={() => navigate.toThread(thread)} className="cursor-pointer border-0 bg-transparent p-0 text-inherit">
      {body} ↗
    </button>
  ) : card ? (
    <button type="button" data-status-wait-link="card" title="Open the card" onClick={() => openCard(`[data-card="${card}"]`)} className="cursor-pointer border-0 bg-transparent p-0 text-inherit">
      {body} ↗
    </button>
  ) : (
    body
  );
  return (
    <div data-status-wait={w.kind} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {link}
      {label ? <span className="orch-muted min-w-0 text-xs [overflow-wrap:anywhere]">{label}</span> : null}
    </div>
  );
}

/** The step bar at the top of a project's page. Without a status, one quiet line says so. */
export function StatusBar({ status, ownerName, lanes, openCard }: { status: Status | null; ownerName: string; lanes: Lane[] | undefined; openCard: OpenCard }) {
  const now = useMinute();
  if (!status) {
    return (
      <p data-status-bar="none" className="orch-muted m-0 text-xs">
        No status from the lead yet.
      </p>
    );
  }
  const p = position(status);
  const headline = stepHeadline(status) || status.goal;
  const stale = isStale(status, now);
  return (
    <section
      data-status-bar=""
      data-status-step={p.kind === "none" ? "" : `${p.at}/${p.total}`}
      aria-label="Lead status"
      className="orch-wash flex min-w-0 flex-col gap-2 px-3 py-3"
      style={stale ? { outline: `1px dashed color-mix(in srgb, ${css(STALE)} 60%, transparent)` } : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 data-status-headline="" className="m-0 min-w-0 text-base font-semibold [overflow-wrap:anywhere]" style={p.kind === "current" ? { color: css(CURRENT) } : undefined}>
          {headline}
        </h2>
        <Updated s={status} now={now} />
      </div>
      {status.goal && headline !== status.goal ? <p className="orch-muted m-0 min-w-0 text-xs [overflow-wrap:anywhere]">Goal: {status.goal}</p> : null}
      {status.steps.length ? (
        <ol data-status-steps="" aria-label="Steps" className="m-0 flex w-full min-w-0 list-none p-0">
          {status.steps.map((s, i) => (
            <Step key={i} n={i + 1} step={s} last={i === status.steps.length - 1} />
          ))}
        </ol>
      ) : null}
      <Waiting s={status} ownerName={ownerName} lanes={lanes} openCard={openCard} />
      {status.blockers.length ? (
        <ul data-status-blockers={status.blockers.length} className="m-0 flex list-none flex-col gap-1 p-0">
          {status.blockers.map((b, i) => (
            <li key={i} className="flex min-w-0 items-start gap-1.5 text-xs">
              <span aria-hidden style={{ color: css(BLOCKER) }}>
                ⚠
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-semibold" style={{ color: css(BLOCKER) }}>
                  Blocker:
                </span>{" "}
                {b}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The Projects list's line under a project's name: "step 3/5 · waiting on PR 1301", and stale when it is. */
export function StatusLine({ status, ownerName }: { status: Status | null; ownerName: string }): ReactNode {
  const now = useMinute();
  if (!status) return null;
  const text = statusLine(status, ownerName);
  const stale = isStale(status, now);
  if (!text && !stale) return null;
  return (
    <div data-status-line={text} data-status-stale={stale ? "true" : "false"} className="orch-muted mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {text ? <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span> : null}
      {status.blockers.length ? (
        <span className="whitespace-nowrap" style={{ color: css(BLOCKER) }}>
          ⚠ {status.blockers.length} {status.blockers.length === 1 ? "blocker" : "blockers"}
        </span>
      ) : null}
      {stale ? (
        <Badge style={chip(STALE)}>
          <span className="whitespace-nowrap">stale · {age(status.updatedAt, now)} ago</span>
        </Badge>
      ) : null}
    </div>
  );
}
