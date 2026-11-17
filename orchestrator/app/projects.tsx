// Projects as a command center (2026-11-16, the v2 row; command-center.ts and cc-lines.tsx): one summary row per project,
// ordered by attention. A row reads top-down: the name and what it is doing now; one state word (or the Needs you pill),
// the step, when the lead last said so, how many threads work; then what blocks it, what it waits on outside itself
// (two lines, the rest folded), and the latest finished thing. The lanes sit behind "N of M threads working ▸".
// Priority, Hold and Archive are in the ⋯ menu. Quiet projects fold to one line each, archived ones behind a toggle.
// Above them, the standing agents on one line. The writes go through the page gate (store.ts), like every other.
//
// The Agents tab went on 2026-11-16: what only it showed (unread, level, context window, unplanned; for the CoS and the
// Steward also model and branch) is on the lanes and the standing row now, and a live thread's branch on its project's
// Flow view.
//
// Agent lanes (2026-11-16, slice 1): under each project, one lane per live lead or thread (lanes.ts): its sprite, model,
// state and how long, what it is doing, its PR and what it waits on. "Needs me" keeps only the lanes waiting on the owner.
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { z } from "zod";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { openInBb, plainClick } from "./open-proof.ts";
import { WRITES, type Agents, type Board, type NeedsYou, type Projects, type archiveProjectBody, type directMessageBody, type holdBody, type priorityBody, type roleStartBody, type startLeadBody } from "../contract.ts";
import { ASK_STATUS_TEXT, FILTERS, FILTER_WORD, STATE_WORD, attentionOrder, blockersOf, isQuiet, leadHead, matches, nowText, outOfDateLine, pickWaits, quietLine, stateOf, statusStale, threadCount, threadSprites, waitAge, waitLine, type Filter } from "./command-center.ts";
import { WaitLineView, ccCss } from "./cc-lines.tsx";
import { ProjectRefs, RefText, RefsContext, refCss, type SharedRefs } from "./ref-text.tsx";
import { Composer, DirectLines, directCss, markSeen } from "./direct-line.tsx";
import { useMinute } from "./status-bar.tsx";
import { Badge } from "./affect/badge-clean.tsx";
import { DropdownMenu } from "./affect/dropdown-menu-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { SegmentedControl } from "./affect/segmented-control-clean.tsx";
import { MonSprite } from "./mon.tsx";
import { KIND_TONES, PRIORITIES, PRIORITY_TONES, ROLE_TONES, css, prKind, roleOf, tint, type KindKey, type Priority } from "./palette.ts";
import { accentText, accentVars } from "./accent.ts";
import { gate, useGate, write } from "./store.ts";
import { Kind, PageError, ReadState, cx, when } from "./ui.tsx";
import { useIdentity } from "./identity.ts";
import { age, buildLanes, type Lane, type LaneState } from "./lanes.ts";
import { ownerOnScreen } from "../core/owner.ts";
import { position } from "../core/status.ts";
import { ProjectDetail } from "./project-detail.tsx";
import { ProjectBook, bookCss } from "./project-book.tsx";
import { SearchBox, SearchHits, searchCss } from "./search.tsx";
import { filterHides, isWide, searchLoaded, searchedProjects } from "./source.ts";
import { ContextMeter, Level, UnreadDot } from "./agent-bits.tsx";

type Query = { data: Projects | undefined; error: { message: string } | null; refetch: () => Promise<void> };
type Project = Projects[number];

/** The priority's colour as a small dot (the word is always beside it). */
function PriorityDot({ p }: { p: Priority }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: css(PRIORITY_TONES[p]) }} />;
}

/** Opens Needs you on the owner's card (or an agent's own prompt): the view, then that card scrolled into sight. */
export type OpenCard = (selector: string) => void;

const STATE_TONE: Record<LaneState, KindKey> = { waiting: "asked", blocked: "alarm", released: "inactive", working: "done", idle: "inactive" };
const LANE_WORD: Record<LaneState, string> = { waiting: "waiting", blocked: "blocked", released: "released", working: "working", idle: "idle" };

/** The lane's state in its colour, with how long (a running lane's dot pulses). */
function StatePill({ lane, now }: { lane: Lane; now: number }) {
  const tone = KIND_TONES[STATE_TONE[lane.state]];
  const for_ = age(lane.since, now);
  return (
    <Badge dot live={lane.state === "working"} data-lane-state={lane.state} style={{ "--bg": tint(tone), "--fg": css(tone), "--dot": css(tone) } as CSSProperties}>
      {LANE_WORD[lane.state]}
      {for_ ? <span className="tabular-nums opacity-75"> {for_}</span> : null}
    </Badge>
  );
}

const toneStyle = (tone: { light: string; dark: string }) => ({ "--bg": tint(tone), "--fg": css(tone) }) as CSSProperties;

const CI_TONE: Record<string, string> = { passing: "light-dark(#15803d, #4ade80)", failing: "light-dark(#b91c1c, #fca5a5)", pending: "light-dark(#a16207, #fbbf24)" };
const REVIEW_WORD: Record<string, string> = { approved: "approved", changes_requested: "changes", review_required: "review", review_requested: "review" };
// what the Agents tab's PR chip also said (2026-11-16): why a PR can't merge, or that it can
const ATTENTION_WORD: Record<string, string> = { conflicts: "conflicts", blocked: "blocked", checks_failed: "checks failed", ready_to_merge: "ready to merge" };

/** The lane's PR: number, a CI dot, the review decision and draft or ready; opens the PR. */
export function LanePr({ pr }: { pr: NonNullable<Agents[number]["pr"]> }) {
  const nav = useBbNavigate();
  const live = pr.state === "open" || pr.state === "draft";
  // "ready to merge" says it when it is; "ready" alone is ready for review (not a draft)
  const stage = pr.state === "open" ? (pr.attention === "ready_to_merge" ? null : "ready") : pr.state;
  const review = pr.state === "open" || pr.state === "draft" ? (REVIEW_WORD[pr.review ?? ""] ?? (pr.attention === "review_requested" ? "review" : null)) : null;
  const chip = (
    // no badge dot: the one dot in the chip is CI's
    <Badge data-lane-pr={String(pr.number ?? "")} style={toneStyle(KIND_TONES[prKind(pr)])}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="font-semibold tabular-nums">#{pr.number ?? "?"}</span>
        {pr.checks ? <span role="img" aria-label={`checks ${pr.checks}`} title={`checks ${pr.checks}`} data-ci={pr.checks} className="inline-block size-2 rounded-full" style={{ background: CI_TONE[pr.checks] ?? "var(--orch-muted)" }} /> : null}
        {stage ? <span>{stage}</span> : null}
        {review ? <span data-review={pr.review ?? pr.attention ?? ""}>· {review}</span> : null}
        {live && ATTENTION_WORD[pr.attention ?? ""] ? <span data-attention={pr.attention ?? ""}>· {ATTENTION_WORD[pr.attention ?? ""]}</span> : null}
      </span>
    </Badge>
  );
  return pr.url ? (
    // opened in bb (a link pane), like every PR link on the tab; a modified click still opens a browser tab
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className="no-underline hover:underline"
      title={pr.url}
      data-open-in-bb=""
      onClick={(e) => {
        if (pr.url && plainClick(e) && openInBb(nav, { url: pr.url })) e.preventDefault();
      }}
    >
      {chip}
    </a>
  ) : (
    chip
  );
}

/** What the lane waits on: the owner (a link to the card), CI or a reviewer. Nothing when it waits on nothing. */
function WaitChip({ lane, now, openCard }: { lane: Lane; now: number; openCard: OpenCard }) {
  const { ownerName } = useIdentity();
  const w = lane.wait;
  if (!w) return null;
  if (w.on === "owner") {
    const sel = w.cardId ? `[data-card="${w.cardId}"]` : `[data-interaction="${w.threadId}"]`;
    const tone = KIND_TONES.asked;
    return (
      <button type="button" data-wait="owner" data-wait-card={w.cardId ?? ""} onClick={() => openCard(sel)} className="cursor-pointer rounded-full border-0 bg-transparent p-0 text-inherit">
        <Badge style={{ "--bg": tint(tone), "--fg": css(tone) } as CSSProperties}>
          <span className="whitespace-nowrap font-semibold">
            waits on {ownerOnScreen(ownerName).name}
            {age(lane.since, now) ? <span className="tabular-nums font-normal opacity-75"> {age(lane.since, now)}</span> : null} ↗
          </span>
        </Badge>
      </button>
    );
  }
  return (
    <span data-wait={w.on} className="orch-muted whitespace-nowrap text-xs">
      waits on {w.on === "ci" ? "CI" : "review"}
    </span>
  );
}

/** One agent's lane: sprite and name (open its thread), model, state; under them what it does, its PR and its wait. */
function LaneRow({ lane, now, openCard }: { lane: Lane; now: number; openCard: OpenCard }) {
  const navigate = useBbNavigate();
  const a = lane.agent;
  const role = roleOf(a.address);
  const name = `${a.form ?? a.mon ? `${a.form ?? a.mon} · ` : ""}${a.role === "lead" ? "lead" : `thread ${a.address.split(":")[2] ?? ""}`}`;
  return (
    <li data-lane={a.address} data-lane-wait={lane.wait?.on ?? ""} className={cx("flex min-w-0 items-start gap-2.5 py-2", lane.state === "released" && "opacity-60")}>
      <button type="button" data-open-thread={a.threadId} title={`Open ${a.address}`} onClick={() => navigate.toThread(a.threadId)} className="flex shrink-0 cursor-pointer border-0 bg-transparent p-0">
        <MonSprite mon={a.form ?? a.mon} address={a.address} size={28} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" onClick={() => navigate.toThread(a.threadId)} title={a.address} className="orch-mono cursor-pointer border-0 bg-transparent p-0 font-medium" style={{ color: accentText(a.monType, role ? css(ROLE_TONES[role]) : undefined) }}>
            {name}
          </button>
          {a.unread ? <UnreadDot /> : null}
          {lane.model ? (
            <span data-lane-model={lane.model} title={a.model ?? undefined} className="orch-muted text-xs">
              {lane.model}
            </span>
          ) : null}
          {/* waiting on the owner is said once, by the chip that opens the card */}
          {lane.state === "waiting" ? null : <StatePill lane={lane} now={now} />}
          <WaitChip lane={lane} now={now} openCard={openCard} />
          {a.pr ? <LanePr pr={a.pr} /> : null}
          {a.flags.includes("unplanned") ? (
            <Kind of="unplanned" data-unplanned="">
              Unplanned
            </Kind>
          ) : null}
          <Level a={a} />
          <ContextMeter a={a} />
        </div>
        {lane.activity ? (
          <p data-lane-activity="" className="orch-muted m-0 mt-0.5 truncate text-xs" title={lane.activity}>
            {lane.activity}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Lanes({ lanes, openCard }: { lanes: Lane[]; openCard: OpenCard }) {
  const now = Date.now();
  return (
    <ul data-lanes="" className="orch-rows m-0 w-full min-w-0 list-none p-0 pl-2 sm:pl-12">
      {lanes.map((l) => (
        <LaneRow key={l.agent.threadId} lane={l} now={now} openCard={openCard} />
      ))}
    </ul>
  );
}

/**
 * A click on the row's own surface opens the project's page; one on its buttons, links, menus or the archive prompt
 * doesn't. A menu's items render in a portal: their clicks bubble here through React but aren't inside the row's DOM.
 */
/**
 * The tab's own width. Observed through a callback ref: the tab first renders its loading state without this element,
 * so an effect keyed on a ref object would never see it, and narrow-panel items (Ask for status, Start lead in ⋯) never showed.
 */
function useElementWidth(): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [w, setEl];
}

const onSurface = (e: MouseEvent<HTMLElement>) => {
  const t = e.target as HTMLElement;
  return e.currentTarget.contains(t) && !t.closest("button, a, input, textarea, select, label, [role^=menu], [role=group], [role=dialog], [role=listbox], [role=option], [data-lanes], [data-book]");
};

/** One column (a tab under WIDE_MIN): a row opens in place to its seven sections; `book` draws them. */
type Expand = { open: boolean; toggle: () => void; book: () => ReactNode };
type RowProps = { project: Project; lanes: Lane[] | undefined; busy: boolean; refetchAll: () => void; openCard: OpenCard; onOpen: (slug: string) => void; now: number; narrow: boolean; expand: Expand };

/** Ask for status (PLAN 1.6): only while the status is missing or old, and not while an earlier ask is unanswered. */
function askStatusFor(project: Project, now: number, refetchAll: () => void): (() => void) | null {
  if (!project.lead || project.heldAt !== null || (project.status && !statusStale(project, now))) return null;
  if (project.direct?.messages.some((m) => m.text === ASK_STATUS_TEXT && m.state !== "closed")) return null;
  return () => {
    const body: z.input<typeof directMessageBody> = { slug: project.slug, text: ASK_STATUS_TEXT, followUp: null };
    void write(WRITES.directMessage, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
}

/**
 * The ⋯ menu: priority, hold and archive. On a narrow panel it also holds what has no button there: Ask for status and
 * Start lead. (Message went on 2026-11-17: the composer is always open under the name of an open project.)
 */
function MoreMenu({ project, busy, refetchAll, narrow, onArchive, askStatus, askInMenu = false }: { project: Project; busy: boolean; refetchAll: () => void; narrow: boolean; onArchive: () => void; askStatus: (() => void) | null; askInMenu?: boolean }) {
  const held = project.heldAt !== null;
  const setPriority = (priority: Priority) => {
    if (priority === project.priority) return;
    const body: z.input<typeof priorityBody> = { slug: project.slug, priority };
    void write(WRITES.priority, body, { kind: "other", where: "projects", after: refetchAll });
  };
  const hold = () => {
    const body: z.input<typeof holdBody> = { slug: project.slug, held: !held };
    void write(WRITES.hold, body, { kind: "other", where: "projects", after: refetchAll });
  };
  const startLead = () => {
    const body: z.input<typeof startLeadBody> = { slug: project.slug };
    void write(WRITES.startLead, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  return (
    <DropdownMenu
      align="end"
      title={project.slug}
      items={[
        ...(narrow && !project.lead ? [{ label: "Start lead", disabled: busy || held, data: { "data-start-lead": project.slug }, onSelect: startLead }] : []),
        ...((narrow || askInMenu) && askStatus ? [{ label: "Ask for status", disabled: busy, data: { "data-ask-status": project.slug }, onSelect: askStatus }] : []),
        {
          label: `Priority: ${project.priority}`,
          data: { "data-priority": project.slug },
          submenu: PRIORITIES.map((p) => ({ label: PRIORITY_TONES[p].label, icon: <PriorityDot p={p} />, checked: p === project.priority, disabled: busy, data: { "data-priority-pick": p }, onSelect: () => setPriority(p) })),
        },
        { label: held ? "Resume" : "Put on hold", disabled: busy, data: { "data-hold": project.slug }, onSelect: hold },
        { label: "Archive…", danger: true, disabled: busy, data: { "data-archive-project": project.slug }, onSelect: onArchive },
      ]}
      trigger={({ triggerProps }) => (
        <button type="button" className="btn more" data-more={project.slug} title="More: priority, hold, archive" aria-label={`More for ${project.slug}`} disabled={busy} {...triggerProps}>
          ⋯
        </button>
      )}
    />
  );
}

function ArchiveConfirm({ project, busy, refetchAll, onDone }: { project: Project; busy: boolean; refetchAll: () => void; onDone: () => void }) {
  const archive = () => {
    onDone();
    const body: z.input<typeof archiveProjectBody> = { slug: project.slug };
    void write(WRITES.archiveProject, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  const n = project.summary?.threads.total ?? project.threads;
  return (
    <div role="group" aria-label={`Archive ${project.slug}`} data-archive-confirm={project.slug} className="confirm">
      <span className="tx">
        Archive <b>{project.slug}</b>? {project.lead ? `Its lead and ${n} ${n === 1 ? "thread" : "threads"} are archived` : "Its threads are archived"}, and their open cards withdrawn. Worktrees go after bb's grace period;
        branches, deliverables and outputs stay. Start lead brings it back.
      </span>
      <button type="button" className="btn" data-archive-cancel="" onClick={onDone}>
        Cancel
      </button>
      <button type="button" className="btn primary" data-archive-go={project.slug} disabled={busy} onClick={archive}>
        Archive project
      </button>
    </div>
  );
}

/** The step meter: one small bar per step, the current one in ink. */
function Meter({ steps }: { steps: NonNullable<Project["status"]>["steps"] }) {
  return (
    <span className="meter only-desktop" aria-hidden>
      {steps.map((s, i) => (
        <i key={i} className={s.state === "next" ? undefined : s.state} />
      ))}
    </span>
  );
}

/** The state line: the state word (or the Needs you pill), the step, when the lead said it, the threads, the priority. */
function MetaLine({ project, lanes, now, showLanes, onLanes, askStatus, busy }: { project: Project; lanes: Lane[] | undefined; now: number; showLanes: boolean; onLanes: () => void; askStatus: (() => void) | null; busy: boolean }) {
  const st = stateOf(project, lanes);
  const s = project.status;
  const held = project.heldAt !== null;
  const stale = statusStale(project, now);
  const threads = threadCount(project);
  const ask = askStatus ? (
    <span className="only-desktop">
      {" · "}
      <button type="button" className="link" data-ask-status={project.slug} disabled={busy} onClick={askStatus}>
        Ask for status
      </button>
    </span>
  ) : null;
  return (
    <div className="ln meta" data-state={st}>
      {/* Needs you has its own line above, Blocked its red-dotted lines: the state word here only says motion */}
      {st === "moving" ? <i className="dot moving" /> : null}
      {st === "you" ? null : (
        <span>
          <b className="state">{STATE_WORD[st]}</b>
          {held && st === "held" ? <> since {when(project.heldAt)}</> : null}
        </span>
      )}
      {!project.lead ? null : !s ? (
        <span data-no-status="">
          no status from the lead
          {ask}
        </span>
      ) : (
        <>
          {position(s).total ? (
            <span>
              <Meter steps={s.steps} />
              step {position(s).at} of {position(s).total}
            </span>
          ) : null}
          {/* an old status is flagged; on hold it is expected, so it is only dated */}
          {stale && !held ? (
            <span data-status-stale="true">
              <b className="warn">status is {age(s.updatedAt, now)} old</b>
              {ask}
            </span>
          ) : (
            // on hold an old status is only dated, on the phone too
            <span className={held ? undefined : "only-desktop"} data-status-stale="false">
              lead said {age(s.updatedAt, now)} ago
            </span>
          )}
        </>
      )}
      {threads && !held ? (
        <span>
          <button type="button" data-lanes-toggle={project.slug} aria-expanded={showLanes} onClick={onLanes} title="Show the lead's and threads' lanes">
            {threads} {showLanes ? "▾" : "▸"}
          </button>
          <ThreadSprites lanes={lanes} />
        </span>
      ) : null}
      {project.priority !== "normal" ? <span data-priority-word={project.priority}>{project.priority} priority</span> : null}
    </div>
  );
}

/** A lead's note the owner hasn't opened: in the project's name (so a narrow row keeps it on the name's line); opening the project marks it seen. */
function NoteDot({ project }: { project: Project }) {
  return project.direct?.unread ? <i className="unread" role="img" aria-label="a new note from the lead" data-note-unread={project.slug} title="a new note from the lead: open the project to read it" /> : null;
}

/** An open project's direct line: the composer under its name, then the "You:" lines and the lead's notes. */
function DirectLine({ project, now, cos, busy, refetchAll, onFocus }: { project: Project; now: number; cos: string; busy: boolean; refetchAll: () => void; onFocus: () => void }) {
  return (
    <>
      <Composer project={project} now={now} cos={cos} busy={busy} refetchAll={refetchAll} onFocus={onFocus} />
      <DirectLines project={project} now={now} cos={cos} busy={busy} refetchAll={refetchAll} />
    </>
  );
}

function ProjectRow({ project, lanes, busy, refetchAll, openCard, onOpen, now, narrow, expand }: RowProps) {
  const { cosTitle } = useIdentity();
  const [confirming, setConfirming] = useState(false);
  const direct = expand.open && !!project.lead;
  const askStatus = askStatusFor(project, now, refetchAll);
  const [showLanes, setShowLanes] = useState(false);
  const held = project.heldAt !== null;
  const s = project.status;
  const st = stateOf(project, lanes);
  const now_ = nowText(project, lanes);
  const waits = pickWaits(project.summary?.waits ?? [], now);
  const startLead = () => {
    const body: z.input<typeof startLeadBody> = { slug: project.slug };
    void write(WRITES.startLead, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  const oldest = waits.oldest;
  const head = leadHead(project);
  const outOfDate = outOfDateLine(project);
  const loud = st === "you" || st === "blocked";
  return (
    <li
      className="proj headed"
      data-project={project.slug}
      data-state={st}
      data-loud={loud ? st : undefined}
      data-held={held ? "true" : "false"}
      data-archived="false"
      data-accent={project.monType ?? undefined}
      data-expanded={expand.open ? "true" : "false"}
      style={accentVars(project.monType)}
      onClick={(e) => (onSurface(e) ? expand.toggle() : undefined)}
    >
      <Face project={project} size={32} />
      <div className="body">
      <ProjectRefs.Provider value={{ project: project.slug, prs: project.prs ?? [] }}>
      <div className="ln title">
        <span className="tx" title={`${project.slug}: ${now_}`}>
          <button type="button" className="name" data-open-project={project.slug} onClick={() => onOpen(project.slug)}>
            {project.slug}
            <NoteDot project={project} />
          </button>
          <span className="who" data-lead-name={head.name}>
            {head.name}
          </span>
          {head.type ? (
            <span className="type" data-type={project.monType ?? ""} style={{ color: accentText(project.monType) }}>
              {head.type}
            </span>
          ) : null}
          {now_ ? (
            <span className={cx("now", (statusStale(project, now) || held) && "dim")}>
              <RefText text={now_} />
            </span>
          ) : null}
        </span>
        <span className="acts">
          {project.lead ? null : (
            <button type="button" className="btn only-desktop" data-start-lead={project.slug} disabled={busy || held} title={held ? "Resume the project first" : `Start lead:${project.slug}`} onClick={startLead}>
              Start lead
            </button>
          )}
          <ExpandButton project={project} expand={expand} />
          <MoreMenu project={project} busy={busy} refetchAll={refetchAll} narrow={narrow} onArchive={() => setConfirming(true)} askStatus={askStatus} />
        </span>
      </div>
      {direct ? <DirectLine project={project} now={now} cos={cosTitle} busy={busy} refetchAll={refetchAll} onFocus={() => markSeen(project, refetchAll)} /> : null}
      {st === "you" ? <NeedsLine project={project} lanes={lanes} now={now} openCard={openCard} /> : null}
      {blockersOf(project).map((b, i) => (
        <div key={i} className="ln blocker" data-blocker="">
          <i className="dot blocked" />
          <span className="tx" title={`Blocked by ${b}`}>
            Blocked by <RefText text={b} />
          </span>
          {s ? <span className="tail">lead said {age(s.updatedAt, now)} ago</span> : null}
        </div>
      ))}
      <MetaLine project={project} lanes={lanes} now={now} showLanes={showLanes} onLanes={() => setShowLanes((x) => !x)} askStatus={askStatus} busy={busy} />
      {outOfDate ? (
        <div className="ln quietly" data-status-outdated="">
          <span className="tx">{outOfDate}</span>
        </div>
      ) : null}
      {waits.shown.map((w, i) => (
        <WaitLineView key={`${w.kind}|${w.ref ?? i}`} w={w} now={now} cos={cosTitle} />
      ))}
      {waits.more ? (
        <div className="ln quietly" data-more-waits={waits.more}>
          {oldest && oldest.since !== null && now - oldest.since >= 4 * 3_600_000 ? <i className="dot old" title="waited on for more than 4 hours" /> : null}
          <span className="tx">
            +{waits.more} more {waits.more === 1 ? "wait" : "waits"}
            {oldest && waitAge(oldest, now) ? `, the oldest ${waitAge(oldest, now)}` : ""}
          </span>
        </div>
      ) : null}
      {project.summary?.done ? (
        <div className="ln quietly" data-done={project.summary.done.kind}>
          <span className="tx" title={`Done: ${project.summary.done.text}`}>
            Done: <RefText text={project.summary.done.text} />
          </span>
          <span className="tail">{age(project.summary.done.at, now)} ago</span>
        </div>
      ) : null}
      {held ? (
        <div className="ln quietly">
          <span className="tx">Mail to this lead is held until the project resumes.</span>
        </div>
      ) : null}
      {direct ? null : <DirectLines project={project} now={now} cos={cosTitle} busy={busy} refetchAll={refetchAll} />}
      <PageError where={`lead:${project.slug}`} />
      {confirming ? <ArchiveConfirm project={project} busy={busy} refetchAll={refetchAll} onDone={() => setConfirming(false)} /> : null}
      {showLanes && lanes?.length ? (
        <div className="lanes">
          <Lanes lanes={lanes} openCard={openCard} />
        </div>
      ) : null}
      {expand.open ? <div className="in-place">{expand.book()}</div> : null}
      </ProjectRefs.Provider>
      </div>
    </li>
  );
}

/** The lead's Pokémon (shiny, as in the sidebar), opening its thread; a neutral avatar with the setting off or no lead. */
function Face({ project, size }: { project: Project; size: 24 | 32 }) {
  const navigate = useBbNavigate();
  const h = leadHead(project);
  const lead = project.lead;
  return (
    <span className="face" data-face={h.mon ?? ""}>
      {lead ? (
        <button type="button" data-open-thread={lead.threadId} title={`Open lead:${project.slug}`} onClick={() => navigate.toThread(lead.threadId)}>
          <MonSprite mon={h.mon} address={lead.address} size={size} boost={false} />
        </button>
      ) : (
        <MonSprite mon={null} address={`lead:${project.slug}`} size={size} boost={false} />
      )}
    </span>
  );
}

/** The threads' small sprites after "N of M threads working": working ones full, idle ones dimmed, six then +N. */
function ThreadSprites({ lanes }: { lanes: Lane[] | undefined }) {
  const navigate = useBbNavigate();
  const { shown, more } = threadSprites(lanes);
  if (!shown.length) return null;
  return (
    <span className="sprites only-desktop" data-sprites={shown.length}>
      {shown.map((l) => (
        <button
          key={l.agent.threadId}
          type="button"
          className={l.state === "working" ? undefined : "idle"}
          data-sprite={l.agent.address}
          data-sprite-state={l.state}
          title={`${l.agent.form ?? l.agent.mon ?? l.agent.address} · ${l.agent.address}: ${l.activity ?? l.state}`}
          onClick={() => navigate.toThread(l.agent.threadId)}
        >
          <MonSprite mon={l.agent.form ?? l.agent.mon} address={l.agent.address} size={20} boost={false} />
        </button>
      ))}
      {more ? <span className="more-n">+{more}</span> : null}
    </span>
  );
}

/** The first line under the head when the owner is waited on: the one Needs you pill and the card's question. */
function NeedsLine({ project, lanes, now, openCard }: { project: Project; lanes: Lane[] | undefined; now: number; openCard: OpenCard }) {
  const n = project.summary?.needsYou;
  const lane = lanes?.find((l) => l.state === "waiting");
  const text = n?.question ?? n?.title ?? lane?.activity ?? "waiting on you";
  const sel = n?.id ? `[data-card="${n.id}"]` : lane?.wait?.on === "owner" ? (lane.wait.cardId ? `[data-card="${lane.wait.cardId}"]` : `[data-interaction="${lane.wait.threadId}"]`) : null;
  const since = n?.since ?? lane?.since ?? null;
  const more = (n?.count ?? 0) > 1 ? ` (+${n!.count - 1} more)` : "";
  return (
    <div className="ln need" data-needs-line={n?.id ?? ""}>
      <span className="tx fit" title={`${text}${more}`}>
        <span className="pill">Needs you</span>
        <span className="rest">
          {sel ? (
            <button type="button" className="q ref" data-open-card={n?.id ?? ""} onClick={() => openCard(sel)}>
              {text}
            </button>
          ) : (
            <span className="q">{text}</span>
          )}
          {more}
        </span>
      </span>
      {since ? <span className="tail">asked {age(since, now)} ago</span> : null}
    </div>
  );
}

/** A quiet or archived project: one line, its name and a few words. */
function QuietRow({ project, busy, refetchAll, onOpen, line, narrow, now, expand }: { project: Project; busy: boolean; refetchAll: () => void; onOpen: (slug: string) => void; line: string; narrow: boolean; now: number; expand: Expand | null }) {
  const { cosTitle } = useIdentity();
  const [confirming, setConfirming] = useState(false);
  const askStatus = askStatusFor(project, now, refetchAll);
  const archived = project.archivedAt !== null;
  const direct = !!expand?.open && !!project.lead && !archived;
  const head = leadHead(project);
  const text = line + (project.priority !== "normal" && !archived ? ` · ${project.priority} priority` : "");
  const startLead = () => {
    const body: z.input<typeof startLeadBody> = { slug: project.slug };
    void write(WRITES.startLead, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  return (
    <li className="proj headed" data-project={project.slug} data-held={project.heldAt !== null ? "true" : "false"} data-archived={archived ? "true" : "false"} data-expanded={expand?.open ? "true" : "false"} style={accentVars(project.monType)} onClick={(e) => (onSurface(e) ? (expand ? expand.toggle() : onOpen(project.slug)) : undefined)}>
      <Face project={project} size={24} />
      <div className="body">
      <ProjectRefs.Provider value={{ project: project.slug, prs: project.prs ?? [] }}>
      <div className="ln title">
        <span className="tx" title={`${project.slug}: ${text}`}>
          <button type="button" className="name" data-open-project={project.slug} onClick={() => onOpen(project.slug)}>
            {project.slug}
            {archived ? null : <NoteDot project={project} />}
          </button>
          {head.mon ? <span className="who">{head.name}</span> : null}
          {head.type ? (
            <span className="type" data-type={project.monType ?? ""} style={{ color: accentText(project.monType) }}>
              {head.type}
            </span>
          ) : null}
          <span className="now">
            <RefText text={text} />
          </span>
        </span>
        <span className="acts">
          {project.lead ? null : (
            <button type="button" className={cx("btn", !archived && "only-desktop")} data-start-lead={project.slug} disabled={busy || project.heldAt !== null} title={archived ? `Bring ${project.slug} back with a new lead` : `Start lead:${project.slug}`} onClick={startLead}>
              Start lead
            </button>
          )}
          {expand ? <ExpandButton project={project} expand={expand} /> : null}
          {archived ? null : <MoreMenu project={project} busy={busy} refetchAll={refetchAll} narrow={narrow} onArchive={() => setConfirming(true)} askStatus={askStatus} askInMenu />}
        </span>
      </div>
      {direct ? <DirectLine project={project} now={now} cos={cosTitle} busy={busy} refetchAll={refetchAll} onFocus={() => markSeen(project, refetchAll)} /> : null}
      <PageError where={`lead:${project.slug}`} />
      {confirming ? <ArchiveConfirm project={project} busy={busy} refetchAll={refetchAll} onDone={() => setConfirming(false)} /> : null}
      {expand?.open ? <div className="in-place">{expand.book()}</div> : null}
      </ProjectRefs.Provider>
      </div>
    </li>
  );
}

/** Opens the row in place to its seven sections (one column), or folds it back. */
function ExpandButton({ project, expand }: { project: Project; expand: Expand }) {
  return (
    <button type="button" className="btn" data-expand={project.slug} aria-expanded={expand.open} title={expand.open ? "Fold the sections" : "Goal, now, needs, blocked, PRs, decided, done"} onClick={expand.toggle}>
      {expand.open ? "Fold ▴" : "Details ▾"}
    </button>
  );
}

const STANDING = [
  { role: "cos", label: null }, // the cosTitle setting
  { role: "steward", label: "Steward" },
] as const;

/** The CoS and the Steward on one line: each with its state, or Start when none is live (an archived one isn't). */
function StandingAgents({ agents, full, busy, refetchAll }: { agents: Board["agents"] | undefined; full: Agents | undefined; busy: boolean; refetchAll: () => void }) {
  const { cosTitle } = useIdentity();
  return (
    <div data-standing="" className="bar standing">
      <span>
        Standing agents:{" "}
        {STANDING.map(({ role, label: fixed }, i) => {
          const label = fixed ?? cosTitle;
          const a = agents?.find((x) => x.address === role && x.status !== "archived");
          const f = a ? full?.find((x) => x.threadId === a.threadId) : undefined;
          const start = () => {
            const body: z.input<typeof roleStartBody> = { role };
            void write(WRITES.roleStart, body, { kind: "other", where: `role:${role}`, after: refetchAll });
          };
          return (
            <span key={role} data-standing-role={role}>
              {i ? " · " : ""}
              {label}{" "}
              {a ? (
                <>
                  {f?.status ?? a.status}
                  {f?.unread ? <i className="unread" title="something new since you last looked" /> : null}
                </>
              ) : agents ? (
                <button type="button" className="link" data-start-role={role} disabled={busy} onClick={start}>
                  Start
                </button>
              ) : (
                "…"
              )}
            </span>
          );
        })}
      </span>
      {full ? (
        <span className="right" data-agent-count={full.length}>
          {full.length} live {full.length === 1 ? "agent" : "agents"}
        </span>
      ) : null}
      <PageError where="role:cos" />
      <PageError where="role:steward" />
    </div>
  );
}

/** Layout B (2026-11-16): the wide tab's own CSS. Selection is a background tint, never a coloured edge. */
const layoutCss = /* css */ `
[data-orch] .orch-cc .b-body { display: grid; grid-template-columns: minmax(360px, 480px) minmax(0, 1fr); gap: 32px; align-items: start; }
[data-orch] .orch-cc .plist { border-top: 1px solid var(--orch-line); }
[data-orch] .orch-cc .prow { display: flex; gap: 8px; align-items: flex-start; padding: 8px; border-bottom: 1px solid var(--orch-line); cursor: pointer; }
[data-orch] .orch-cc .prow:hover { background: color-mix(in srgb, var(--orch-ink) 4%, transparent); }
[data-orch] .orch-cc .prow[data-selected="true"] { background: color-mix(in srgb, var(--orch-ink) 8%, transparent); }
[data-orch] .orch-cc .prow .pbody { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
[data-orch] .orch-cc .prow .face { flex: none; width: 32px; height: 24px; display: flex; justify-content: center; align-items: center; }
[data-orch] .orch-cc .prow .head { display: flex; gap: 0 8px; align-items: baseline; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-orch] .orch-cc .prow .head .who, [data-orch] .orch-cc .prow .head .type { margin-left: 0; }
[data-orch] .orch-cc .prow .cnt { margin-left: auto; flex: none; text-align: right; white-space: nowrap; color: var(--orch-muted); }
[data-orch] .orch-cc .prow .ln { padding-left: 16px; }
[data-orch] .orch-cc .list-h { margin: 16px 0 0; padding: 0 8px 8px; font-size: 12px; line-height: 16px; font-weight: 400; color: var(--orch-muted); border-bottom: 1px solid var(--orch-line); }
[data-orch] .orch-cc .detail { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
[data-orch] .orch-cc .dhead { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-bottom: 16px; border-bottom: 1px solid var(--orch-line); }
[data-orch] .orch-cc .dhead .name { font-size: 16px; line-height: 24px; }
[data-orch] .orch-cc .dhead .acts { flex: 1 1 auto; justify-content: flex-end; }
[data-orch] .orch-cc .in-place { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--orch-line); }
`;

/** A project in the wide list: its lead, name and type; its state, threads and the status's age; its counts. */
function ListRow({ project, lanes, now, selected, onSelect }: { project: Project; lanes: Lane[] | undefined; now: number; selected: boolean; onSelect: () => void }) {
  const head = leadHead(project);
  const st = stateOf(project, lanes);
  const t = project.summary?.threads;
  const s = project.status;
  const needs = (project.summary?.needsYou.count ?? 0) + (lanes ?? []).filter((l) => l.state === "waiting" && l.wait?.on === "owner" && !l.wait.cardId).length;
  const blocked = blockersOf(project).length;
  const waits = project.summary?.waits.length ?? 0;
  const prs = (project.prs ?? []).filter((x) => x.state === "open" || x.state === "draft").length;
  const counts = [needs ? `${needs} for you` : "", blocked ? `${blocked} blocked` : "", waits ? `${waits} ${waits === 1 ? "wait" : "waits"}` : "", prs ? `${prs} ${prs === 1 ? "PR" : "PRs"}` : ""].filter(Boolean).join(" · ");
  const word = st === "you" ? "Needs you" : STATE_WORD[st];
  const out = !!project.summary?.statusOutOfDate;
  const stale = statusStale(project, now) && project.heldAt === null;
  return (
    <li
      className="prow"
      data-selected={selected}
      data-project={project.slug}
      data-list-row={project.slug}
      data-state={st}
      style={accentVars(project.monType)}
      onClick={(e) => ((e.target as HTMLElement).closest("button, a") ? undefined : onSelect())}
    >
      <Face project={project} size={32} />
      <div className="pbody">
        <div className="head">
          {/* a plain list: the name is the control that selects, and says which project the detail shows */}
          <button type="button" className="name" data-select-project={project.slug} aria-current={selected ? "true" : undefined} onClick={onSelect}>
            {project.slug}
          </button>
          {project.direct?.unread ? <i className="unread" data-list-unread={project.slug} title="a new note from the lead: select the project to read it" /> : null}
          {head.mon ? <span className="who">{head.name}</span> : null}
          {head.type ? (
            <span className="type small" data-type={project.monType ?? ""} style={{ color: accentText(project.monType) }}>
              {head.type}
            </span>
          ) : null}
        </div>
        <div className="ln small muted" data-list-state={st}>
          {st === "moving" ? <i className="dot moving" /> : st === "blocked" ? <i className="dot blocked" /> : out || stale ? <i className="dot old" /> : null}
          <span className="tx">
            <b className="state">{word}</b>
            {t && t.total ? ` · ${t.working} of ${t.total} working` : ""}
            {out ? " · status out of date" : stale ? " · status old" : ""}
          </span>
        </div>
      </div>
      <span className="cnt small">
        {counts || "nothing open"}
        <br />
        {s ? `lead said ${age(s.updatedAt, now)} ago` : project.lead ? "no status" : "no lead"}
      </span>
    </li>
  );
}

/**
 * The selected project, beside the list: its head and actions, the composer under its name (always open), the direct
 * line, then the seven sections. Focusing the composer pins the selection: the list's order can change under a draft,
 * and the default selection (the first project) must not swap while the owner types.
 */
function DetailPanel({ project, lanes, busy, refetchAll, openCard, onOpen, onPick, now, narrow, needs }: { project: Project; lanes: Lane[] | undefined; busy: boolean; refetchAll: () => void; openCard: OpenCard; onOpen: (slug: string) => void; onPick: () => void; now: number; narrow: boolean; needs: NeedsYou | undefined }) {
  const { cosTitle, ownerName } = useIdentity();
  const [confirming, setConfirming] = useState(false);
  const head = leadHead(project);
  const askStatus = askStatusFor(project, now, refetchAll);
  const startLead = () => {
    const body: z.input<typeof startLeadBody> = { slug: project.slug };
    void write(WRITES.startLead, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  const held = project.heldAt !== null;
  return (
    <div className="detail" data-project={project.slug} data-detail-panel={project.slug} data-held={held ? "true" : "false"} style={accentVars(project.monType)}>
      <ProjectRefs.Provider value={{ project: project.slug, prs: project.prs ?? [] }}>
        <div className="dhead">
          <Face project={project} size={32} />
          <span className="name">{project.slug}</span>
          <span className="who">{head.name}</span>
          {head.type ? (
            <span className="type" data-type={project.monType ?? ""} style={{ color: accentText(project.monType) }}>
              {head.type}
            </span>
          ) : null}
          {held ? <span className="muted">· on hold since {when(project.heldAt)}</span> : null}
          <span className="acts">
            {project.lead ? null : (
              <button type="button" className="btn" data-start-lead={project.slug} disabled={busy || held} onClick={startLead}>
                Start lead
              </button>
            )}
            <button type="button" className="btn" data-open-project={project.slug} title="The timeline, the flow and the dependencies" onClick={() => onOpen(project.slug)}>
              Timeline
            </button>
            <MoreMenu project={project} busy={busy} refetchAll={refetchAll} narrow={narrow} onArchive={() => setConfirming(true)} askStatus={askStatus} askInMenu />
          </span>
        </div>
        {project.lead ? (
          <div className="direct" data-direct-line={project.slug}>
            <DirectLine
              project={project}
              now={now}
              cos={cosTitle}
              busy={busy}
              refetchAll={refetchAll}
              onFocus={() => {
                onPick();
                markSeen(project, refetchAll);
              }}
            />
          </div>
        ) : null}
        {held ? <div className="muted">Mail to this lead is held until the project resumes.</div> : null}
        <PageError where={`lead:${project.slug}`} />
        {confirming ? <ArchiveConfirm project={project} busy={busy} refetchAll={refetchAll} onDone={() => setConfirming(false)} /> : null}
        <ProjectBook project={project} lanes={lanes} now={now} cards={needs?.cards ?? []} cos={cosTitle} ownerName={ownerOnScreen(ownerName).name} openCard={openCard} askStatus={askStatus} lanesView={lanes?.length ? <Lanes lanes={lanes} openCard={openCard} /> : null} wide />
      </ProjectRefs.Provider>
    </div>
  );
}

export function ProjectsView({
  q,
  refetchAll,
  agents,
  lanesFrom,
  needs,
  openCard,
  detail,
  onDetail,
  refs,
}: {
  q: Query;
  refetchAll: () => void;
  agents: Board["agents"] | undefined;
  lanesFrom: Agents | undefined;
  needs: NeedsYou | undefined;
  openCard: OpenCard;
  /** The open project page (projects/<slug>), null for the list. The panel keeps it, so pane focus can't close it. */
  detail: string | null;
  /** Opening or leaving a project's page: the URL follows, so a link or the browser's back button works. */
  onDetail: (slug: string | null) => void;
  /** What the references in a row's text resolve against (refs.ts); null: plain text. */
  refs: SharedRefs | null;
}) {
  useGate();
  const { ownerName, cosTitle } = useIdentity();
  const you = ownerOnScreen(ownerName);
  const [filter, setFilter] = useState<Filter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [width, root] = useElementWidth();
  const narrow = width > 0 && width <= 640;
  const wide = isWide(width);
  const now = useMinute();
  const open = onDetail;
  const busy = gate.lock !== null;
  const all = q.data;
  if (!all) return <ReadState q={q} what="the projects" />;
  const lanes = buildLanes(lanesFrom, needs);
  const shownProject = detail ? all.find((p) => p.slug === detail) : undefined;
  if (shownProject) return <ProjectDetail project={shownProject} lanes={lanes.get(shownProject.slug)} onBack={() => open(null)} openCard={openCard} ownerName={you.name} />;
  const cards = needs?.cards ?? [];
  const live = all.filter((p) => p.archivedAt === null);
  const count = (f: Filter) => live.filter((p) => matches(f, p, lanes.get(p.slug))).length;
  const hits = query.trim() ? searchLoaded(live, lanes, cards, query, (w) => waitLine(w, now, cosTitle).text) : [];
  const filtered = live.filter((p) => matches(filter, p, lanes.get(p.slug)));
  const shown = searchedProjects(filtered, hits, query).sort(attentionOrder(lanes, now));
  const main = shown.filter((p) => !isQuiet(p, lanes.get(p.slug), now));
  const quiet = shown.filter((p) => isQuiet(p, lanes.get(p.slug), now));
  const archived = filter === "all" && !query.trim() ? all.filter((p) => p.archivedAt !== null).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)) : [];
  const toggle = (p: Project) => {
    if (!opened.has(p.slug)) markSeen(p, refetchAll); // opened in place: its lead's notes are drawn under the composer
    setOpened((o) => (o.has(p.slug) ? new Set([...o].filter((x) => x !== p.slug)) : new Set([...o, p.slug])));
  };
  // a click in the wide list: the detail shows the project's direct line, so its notes are seen
  const pick = (p: Project) => {
    setPicked(p.slug);
    markSeen(p, refetchAll);
  };
  // a click on a project's name in the hits: select it beside the list, or open its row in place
  const reach = (slug: string) => {
    if (filterHides(slug, filtered)) setFilter("all");
    const p = live.find((x) => x.slug === slug);
    if (p) markSeen(p, refetchAll);
    if (wide) setPicked(slug);
    else {
      setOpened((o) => new Set([...o, slug]));
      requestAnimationFrame(() => document.querySelector(`[data-group] [data-project="${CSS.escape(slug)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  };
  const book = (p: Project) => () => (
    <ProjectBook project={p} lanes={lanes.get(p.slug)} now={now} cards={cards} cos={cosTitle} ownerName={you.name} openCard={openCard} askStatus={askStatusFor(p, now, refetchAll)} lanesView={lanes.get(p.slug)?.length ? <Lanes lanes={lanes.get(p.slug)!} openCard={openCard} /> : null} wide={false} />
  );
  const expand = (p: Project): Expand => ({ open: opened.has(p.slug), toggle: () => toggle(p), book: book(p) });
  const ordered = [...main, ...quiet];
  const selected = ordered.find((p) => p.slug === picked) ?? ordered[0];
  const top = (
    <div className="top">
      <div className="bar filters" data-needs-me-filter={filter}>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} data-filter={f} onClick={() => setFilter(f)}>
            {FILTER_WORD[f]} {f === "all" ? live.length : count(f)}
          </button>
        ))}
      </div>
      <SearchBox value={query} onChange={setQuery} />
    </div>
  );
  const empty = (
    <>
      {all.length === 0 ? <EmptyState title="No projects yet" text="A project shows up here once a lead registers for it." icon={null} /> : null}
      {filter !== "all" && !query.trim() && shown.length === 0 ? <EmptyState data-needs-me-empty="" title={filter === "you" ? `Nothing waits on ${you.name}` : `No project is ${filter === "blocked" ? "blocked" : "waiting on anything"}`} text="" icon={null} /> : null}
    </>
  );
  const archivedGroup = (rows: (p: Project) => ReactNode) =>
    archived.length ? (
      <div className="quiet" data-group="archived">
        <h3 className="group-h">
          <button type="button" data-archived-toggle="" aria-expanded={showArchived} onClick={() => setShowArchived((x) => !x)}>
            Archived · {archived.length} {showArchived ? "▾" : "▸"}
          </button>
        </h3>
        {showArchived ? <ul>{archived.map(rows)}</ul> : null}
      </div>
    ) : null;
  return (
    <RefsContext.Provider value={refs}>
    {/* measured at the pane's full width; one column keeps the reading column's width (max-w-3xl less its padding) */}
    <div ref={root} data-projects-width={width}>
    <div className={cx("orch-cc tab pb-8", !wide && "narrow-book")} data-projects-tab="" data-layout={wide ? "list-detail" : "column"} style={wide ? undefined : { maxWidth: 736, marginInline: "auto" }}>
      <style href="orch-cc" precedence="default">
        {ccCss}
      </style>
      <style href="orch-cc-refs" precedence="default">
        {refCss}
      </style>
      <style href="orch-cc-direct" precedence="default">
        {directCss}
      </style>
      <style href="orch-cc-search" precedence="default">
        {searchCss}
      </style>
      <style href="orch-cc-book" precedence="default">
        {bookCss}
      </style>
      <style href="orch-cc-layout" precedence="default">
        {layoutCss}
      </style>
      <StandingAgents agents={agents} full={lanesFrom} busy={busy} refetchAll={refetchAll} />
      {top}
      {query.trim() ? <SearchHits q={query} hits={hits} projects={live} now={now} onOpen={reach} /> : null}
      <ReadState q={q} what="the projects" />
      <PageError where="projects" />
      {empty}
      {wide ? (
        <div className="b-body">
          <div>
            {main.length ? (
              <ul className="plist" role="list" aria-label="Projects" data-group="led">
                {main.map((p) => (
                  <ListRow key={p.slug} project={p} lanes={lanes.get(p.slug)} now={now} selected={p === selected} onSelect={() => pick(p)} />
                ))}
              </ul>
            ) : null}
            {quiet.length ? (
              <div data-group="quiet">
                <h3 className="list-h">Quiet · {quiet.length} · nothing running, nothing waiting</h3>
                <ul className="plist" role="list" aria-label="Quiet projects">
                  {quiet.map((p) => (
                    <ListRow key={p.slug} project={p} lanes={lanes.get(p.slug)} now={now} selected={p === selected} onSelect={() => pick(p)} />
                  ))}
                </ul>
              </div>
            ) : null}
            {archivedGroup((p) => (
              <QuietRow key={p.slug} project={p} busy={busy} refetchAll={refetchAll} onOpen={open} line={`archived ${when(p.archivedAt)}`} narrow={narrow} now={now} expand={null} />
            ))}
          </div>
          {selected ? <DetailPanel key={selected.slug} project={selected} lanes={lanes.get(selected.slug)} busy={busy} refetchAll={refetchAll} openCard={openCard} onOpen={open} onPick={() => setPicked(selected.slug)} now={now} narrow={narrow} needs={needs} /> : <div />}
        </div>
      ) : (
        <>
          {main.length ? (
            <ul data-group="led">
              {main.map((p) => (
                <ProjectRow key={p.slug} project={p} lanes={lanes.get(p.slug)} busy={busy} refetchAll={refetchAll} openCard={openCard} onOpen={open} now={now} narrow={narrow} expand={expand(p)} />
              ))}
            </ul>
          ) : null}
          {quiet.length ? (
            <div className="quiet" data-group="quiet">
              <h3 className="group-h">Quiet · {quiet.length} · nothing running, nothing waiting</h3>
              <ul>
                {quiet.map((p) => (
                  <QuietRow key={p.slug} project={p} busy={busy} refetchAll={refetchAll} onOpen={open} line={quietLine(p, now)} narrow={narrow} now={now} expand={expand(p)} />
                ))}
              </ul>
            </div>
          ) : null}
          {archivedGroup((p) => (
            <QuietRow key={p.slug} project={p} busy={busy} refetchAll={refetchAll} onOpen={open} line={`archived ${when(p.archivedAt)}`} narrow={narrow} now={now} expand={null} />
          ))}
        </>
      )}
    </div>
    </div>
    </RefsContext.Provider>
  );
}
