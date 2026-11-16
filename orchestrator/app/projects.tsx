// Projects: one row per project, with its lead (Pokémon, address, status), threads and open plan cards, and the owner's
// controls: the priority (affectUI's dropdown menu), Hold/Resume and, for a project without a live lead, Start lead.
// Projects without a live lead sit in a quieter group below, and archived ones below that. Above them, the standing agents (the CoS and the Steward)
// with their Pokémon and status, or a Start button. The writes go through the page gate (store.ts), like every other.
//
// The Agents tab went on 2026-11-16: what only it showed (unread, level, context window, unplanned; for the CoS and the
// Steward also model and branch) is on the lanes and the standing row now, and a live thread's branch on its project's
// Flow view.
//
// Agent lanes (2026-11-16, slice 1): under each project, one lane per live lead or thread (lanes.ts): its sprite, model,
// state and how long, what it is doing, its PR and what it waits on. "Needs me" keeps only the lanes waiting on the owner.
import { useState, type CSSProperties, type MouseEvent } from "react";
import type { z } from "zod";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { WRITES, type Agents, type Board, type NeedsYou, type Projects, type archiveProjectBody, type holdBody, type priorityBody, type roleStartBody, type startLeadBody } from "../contract.ts";
import { Badge } from "./affect/badge-clean.tsx";
import { DropdownMenu } from "./affect/dropdown-menu-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { SegmentedControl } from "./affect/segmented-control-clean.tsx";
import { MonSprite } from "./mon.tsx";
import { KIND_TONES, PRIORITIES, PRIORITY_TONES, ROLE_TONES, css, prKind, roleOf, tint, type KindKey, type Priority } from "./palette.ts";
import { gate, useGate, write } from "./store.ts";
import { Btn, Kind, Muted, PageError, ReadState, Section, Tag, Who, cx, when } from "./ui.tsx";
import { useIdentity } from "./identity.ts";
import { age, buildLanes, projectOrder, waitsOnOwner, type Lane, type LaneState } from "./lanes.ts";
import { ownerOnScreen } from "../core/owner.ts";
import { ProjectDetail } from "./project-detail.tsx";
import { ContextMeter, Level, UnreadDot } from "./agent-bits.tsx";
import { StatusLine } from "./status-bar.tsx";

type Query = { data: Projects | undefined; error: { message: string } | null; refetch: () => Promise<void> };
type Project = Projects[number];

/** The priority's colour as a small dot (the word is always beside it). */
export function PriorityDot({ p }: { p: Priority }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: css(PRIORITY_TONES[p]) }} />;
}

function PriorityMenu({ project, busy, refetchAll }: { project: Project; busy: boolean; refetchAll: () => void }) {
  const set = (priority: Priority) => {
    if (priority === project.priority) return;
    const body: z.input<typeof priorityBody> = { slug: project.slug, priority };
    void write(WRITES.priority, body, { kind: "other", where: "projects", after: refetchAll });
  };
  return (
    <DropdownMenu
      align="end"
      title="Priority"
      items={PRIORITIES.map((p) => ({ label: PRIORITY_TONES[p].label, icon: <PriorityDot p={p} />, checked: p === project.priority, disabled: busy, data: { "data-priority-pick": p }, onSelect: () => set(p) }))}
      trigger={({ triggerProps }) => (
        <Btn tone="outline" data-priority={project.slug} disabled={busy} {...triggerProps} aria-label={`Priority of ${project.slug}: ${project.priority}`}>
          <span className="inline-flex items-center gap-1.5" style={{ color: css(PRIORITY_TONES[project.priority]) } as CSSProperties}>
            <PriorityDot p={project.priority} />
            {project.priority}
          </span>
          <span aria-hidden className="orch-muted">
            ▾
          </span>
        </Btn>
      )}
    />
  );
}

/** Opens Needs you on the owner's card (or an agent's own prompt): the view, then that card scrolled into sight. */
export type OpenCard = (selector: string) => void;

const STATE_TONE: Record<LaneState, KindKey> = { waiting: "asked", blocked: "alarm", released: "inactive", working: "done", idle: "inactive" };
const STATE_WORD: Record<LaneState, string> = { waiting: "waiting", blocked: "blocked", released: "released", working: "working", idle: "idle" };

/** The lane's state in its colour, with how long (a running lane's dot pulses). */
function StatePill({ lane, now }: { lane: Lane; now: number }) {
  const tone = KIND_TONES[STATE_TONE[lane.state]];
  const for_ = age(lane.since, now);
  return (
    <Badge dot live={lane.state === "working"} data-lane-state={lane.state} style={{ "--bg": tint(tone), "--fg": css(tone), "--dot": css(tone) } as CSSProperties}>
      {STATE_WORD[lane.state]}
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
    <a href={pr.url} target="_blank" rel="noreferrer" className="no-underline hover:underline" title={pr.url}>
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
  const name = a.role === "lead" ? "lead" : `thread ${a.address.split(":")[2] ?? ""}`;
  return (
    <li data-lane={a.address} data-lane-wait={lane.wait?.on ?? ""} className={cx("flex min-w-0 items-start gap-2.5 py-2", lane.state === "released" && "opacity-60")}>
      <button type="button" data-open-thread={a.threadId} title={`Open ${a.address}`} onClick={() => navigate.toThread(a.threadId)} className="flex shrink-0 cursor-pointer border-0 bg-transparent p-0">
        <MonSprite mon={a.form ?? a.mon} address={a.address} size={28} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" onClick={() => navigate.toThread(a.threadId)} title={a.address} className="orch-mono cursor-pointer border-0 bg-transparent p-0 font-medium" style={{ color: role ? css(ROLE_TONES[role]) : undefined }}>
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
const onSurface = (e: MouseEvent<HTMLElement>) => {
  const t = e.target as HTMLElement;
  return e.currentTarget.contains(t) && !t.closest("button, a, input, textarea, select, label, [role^=menu], [role=group], [role=dialog], [role=listbox], [role=option]");
};

function ProjectRow({ project, busy, refetchAll, quiet, lanes, openCard, onOpen }: { project: Project; busy: boolean; refetchAll: () => void; quiet?: boolean; lanes?: Lane[]; openCard: OpenCard; onOpen: (slug: string) => void }) {
  const held = project.heldAt !== null;
  const archived = project.archivedAt !== null;
  const [confirming, setConfirming] = useState(false);
  const you = ownerOnScreen(useIdentity().ownerName).name;
  const archive = () => {
    setConfirming(false);
    const body: z.input<typeof archiveProjectBody> = { slug: project.slug };
    void write(WRITES.archiveProject, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  const hold = () => {
    const body: z.input<typeof holdBody> = { slug: project.slug, held: !held };
    void write(WRITES.hold, body, { kind: "other", where: "projects", after: refetchAll });
  };
  const lead = project.lead;
  // the lead's own lane shows its address and state
  const leadLine = lead && !lanes?.some((l) => l.agent.threadId === lead.threadId) ? lead : null;
  const plans = !archived && project.openPlans > 0;
  const startLead = () => {
    const body: z.input<typeof startLeadBody> = { slug: project.slug };
    void write(WRITES.startLead, body, { kind: "other", where: `lead:${project.slug}`, after: refetchAll });
  };
  return (
    <li
      data-project={project.slug}
      data-held={held ? "true" : "false"}
      data-archived={archived ? "true" : "false"}
      data-waits-on-owner={waitsOnOwner(lanes) ? "true" : "false"}
      onClick={(e) => (onSurface(e) ? onOpen(project.slug) : undefined)}
      className="flex cursor-pointer flex-wrap items-center gap-3 py-3"
    >
      {lead ? <MonSprite mon={lead.mon} address={lead.address} size={40} /> : null}
      {/* the name keeps room for itself: on a phone the buttons wrap to the row below rather than squeeze it, and it
          breaks only at its hyphens, never inside a word */}
      <div className="min-w-[min(100%,14rem)] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-open-project={project.slug} title={`Open ${project.slug}`} onClick={() => onOpen(project.slug)} className={cx("cursor-pointer border-0 bg-transparent p-0 text-left text-inherit hover:underline", quiet ? "orch-muted" : "font-medium")}>
            {project.slug}
            <span aria-hidden className="orch-muted font-normal">
              {" "}
              ›
            </span>
          </button>
          {archived ? <Tag data-archived-at="">Archived {when(project.archivedAt)}</Tag> : null}
          {held ? (
            <Kind of="held" data-on-hold="">
              On hold since {when(project.heldAt)}
            </Kind>
          ) : null}
        </div>
        {archived ? null : <StatusLine status={project.status} ownerName={you} />}
        {/* the lanes show the lead and threads, so the line keeps only what they don't: open plan cards */}
        {leadLine || plans ? (
          <div className="orch-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {leadLine ? (
              <>
                <Who address={leadLine.address} nowrap />
                <Tag>{leadLine.status}</Tag>
              </>
            ) : null}
            {plans ? (
              <Kind of="asked" data-open-plans={String(project.openPlans)}>
                {project.openPlans} open plan {project.openPlans === 1 ? "card" : "cards"}
              </Kind>
            ) : null}
          </div>
        ) : null}
        <PageError where={`lead:${project.slug}`} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {lead ? null : (
          <Btn tone="outline" data-start-lead={project.slug} disabled={busy || held} title={held ? "Resume the project first" : archived ? `Bring ${project.slug} back with a new lead` : `Start lead:${project.slug}`} onClick={startLead}>
            Start lead
          </Btn>
        )}
        {archived ? null : (
          <>
            <PriorityMenu project={project} busy={busy} refetchAll={refetchAll} />
            <Btn tone={held ? "primary" : "outline"} data-hold={project.slug} disabled={busy} onClick={hold}>
              {held ? "Resume" : "Hold"}
            </Btn>
            <Btn tone="ghost" data-archive-project={project.slug} disabled={busy || confirming} onClick={() => setConfirming(true)}>
              Archive…
            </Btn>
          </>
        )}
      </div>
      {confirming ? (
        <div role="group" aria-label={`Archive ${project.slug}`} data-archive-confirm={project.slug} className="orch-wash flex w-full flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            Archive <span className="font-medium">{project.slug}</span>? {lead ? `Its lead and ${project.threads} ${project.threads === 1 ? "thread" : "threads"} are archived` : "Its threads are archived"}, and their open cards withdrawn. Worktrees go after bb's grace period; branches, deliverables and outputs stay. Start lead brings it back.
          </span>
          <Btn tone="ghost" data-archive-cancel="" onClick={() => setConfirming(false)}>
            Cancel
          </Btn>
          <Btn tone="danger" data-archive-go={project.slug} disabled={busy} onClick={archive}>
            Archive project
          </Btn>
        </div>
      ) : null}
      {lanes && lanes.length > 0 ? <Lanes lanes={lanes} openCard={openCard} /> : null}
    </li>
  );
}

const STANDING = [
  { role: "cos", label: null }, // the cosTitle setting
  { role: "steward", label: "Steward" },
] as const;

/** The CoS and the Steward: each with its Pokémon and status, or Start when none is live (an archived one isn't). */
function StandingAgents({ agents, full, busy, refetchAll }: { agents: Board["agents"] | undefined; full: Agents | undefined; busy: boolean; refetchAll: () => void }) {
  const { cosTitle } = useIdentity();
  return (
    <div data-standing="" className="orch-wash flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2">
      <span className="orch-muted text-xs">Standing agents</span>
      {STANDING.map(({ role, label: fixed }) => {
        const label = fixed ?? cosTitle;
        const a = agents?.find((x) => x.address === role && x.status !== "archived");
        // what the Agents tab showed for it (2026-11-16): model, branch, level, context and unread
        const f = a ? full?.find((x) => x.threadId === a.threadId) : undefined;
        const start = () => {
          const body: z.input<typeof roleStartBody> = { role };
          void write(WRITES.roleStart, body, { kind: "other", where: `role:${role}`, after: refetchAll });
        };
        return (
          <div key={role} data-standing-role={role} className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              {a ? (
                <>
                  <MonSprite mon={a.mon} address={a.address} size={32} boost={false} />
                  <Who address={a.address} nowrap>
                    {label}
                  </Who>
                  {f?.unread ? <UnreadDot /> : null}
                  <Tag>{a.status}</Tag>
                </>
              ) : agents ? (
                <>
                  <Who address={role} nowrap>
                    {label}
                  </Who>
                  <Btn tone="outline" data-start-role={role} disabled={busy} onClick={start}>
                    Start
                  </Btn>
                </>
              ) : (
                <Muted>{label}: …</Muted>
              )}
            </div>
            {f ? (
              <div data-standing-detail={role} className="orch-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {f.title && f.title !== label ? <span className="text-inherit">{f.title}</span> : null}
                {f.model ? <span className="orch-mono">{f.model}</span> : null}
                {f.branch ? (
                  <span className="orch-mono [overflow-wrap:anywhere]" title="branch">
                    {f.branch}
                  </span>
                ) : null}
                <Level a={f} />
                <ContextMeter a={f} />
              </div>
            ) : null}
            <PageError where={`role:${role}`} />
          </div>
        );
      })}
    </div>
  );
}


type Filter = "all" | "mine";

export function ProjectsView({
  q,
  refetchAll,
  agents,
  lanesFrom,
  needs,
  openCard,
  detail,
  onDetail,
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
}) {
  useGate();
  const you = ownerOnScreen(useIdentity().ownerName);
  const [filter, setFilter] = useState<Filter>("all");
  const open = onDetail;
  const busy = gate.lock !== null;
  const all = q.data;
  if (!all) return <ReadState q={q} what="the projects" />;
  const lanes = buildLanes(lanesFrom, needs);
  const shownProject = detail ? all.find((p) => p.slug === detail) : undefined;
  if (shownProject) return <ProjectDetail project={shownProject} lanes={lanes.get(shownProject.slug)} onBack={() => open(null)} openCard={openCard} ownerName={you.name} />;
  const mine = filter === "mine";
  // with "Needs me" on, only the lanes (and so the projects) waiting on the owner
  const shownLanes = (slug: string) => {
    const l = lanes.get(slug);
    return mine ? l?.filter((x) => x.state === "waiting") : l;
  };
  const order = projectOrder(lanes);
  const live = all.filter((p) => p.archivedAt === null && (!mine || waitsOnOwner(lanes.get(p.slug))));
  const led = live.filter((p) => p.lead).sort(order);
  const unled = live.filter((p) => !p.lead).sort(order);
  const archived = mine ? [] : all.filter((p) => p.archivedAt !== null).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const waiting = all.filter((p) => p.archivedAt === null && waitsOnOwner(lanes.get(p.slug))).length;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <StandingAgents agents={agents} full={lanesFrom} busy={busy} refetchAll={refetchAll} />
      <div data-needs-me-filter={filter} className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<Filter>
          size="sm"
          aria-label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "mine", label: "Needs me", count: waiting || undefined },
          ]}
        />
        {/* the Agents tab's total (2026-11-16): every live agent, the CoS and the Steward included */}
        {lanesFrom ? (
          <span data-agent-count={lanesFrom.length} className="orch-muted text-xs tabular-nums">
            {lanesFrom.length} live {lanesFrom.length === 1 ? "agent" : "agents"}
          </span>
        ) : null}
      </div>
      <ReadState q={q} what="the projects" />
      <PageError where="projects" />
      {all.length === 0 ? <EmptyState title="No projects yet" text="A project shows up here once a lead registers for it." icon={null} /> : null}
      {mine && live.length === 0 ? <EmptyState data-needs-me-empty="" title={`Nothing waits on ${you.name}`} text="No lead or thread is waiting for an answer." icon={null} /> : null}
      {led.length > 0 ? (
        <Section title="Projects" count={led.length} data-group="led">
          <ul className="orch-rows m-0 list-none p-0">
            {led.map((p) => (
              <ProjectRow key={p.slug} project={p} busy={busy} refetchAll={refetchAll} lanes={shownLanes(p.slug)} openCard={openCard} onOpen={open} />
            ))}
          </ul>
        </Section>
      ) : null}
      {unled.length > 0 ? (
        <Section title="No lead" count={unled.length} data-group="no-lead">
          <ul className="orch-rows m-0 list-none p-0">
            {unled.map((p) => (
              <ProjectRow key={p.slug} project={p} busy={busy} refetchAll={refetchAll} quiet lanes={shownLanes(p.slug)} openCard={openCard} onOpen={open} />
            ))}
          </ul>
        </Section>
      ) : null}
      {archived.length > 0 ? (
        <Section title="Archived" count={archived.length} data-group="archived">
          <ul className="orch-rows m-0 list-none p-0">
            {archived.map((p) => (
              <ProjectRow key={p.slug} project={p} busy={busy} refetchAll={refetchAll} quiet openCard={openCard} onOpen={open} />
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
