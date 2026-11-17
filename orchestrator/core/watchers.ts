// The Watchers list (2026-11-17): every open PR wait and every timed job, on the Board (Activity) tab and in the CoS's
// orch_watch. Pure: the server gives it the settings and when each job last ran.
//
// PR waits are the owner's and the CoS's to change (engine watchAdd/Retarget/Move/Drop). Intervals are the owner's
// alone: a job with a setting shows its name and the exact `bb plugin config` line (the page has no settings write and
// bb has no link to a plugin setting), a fixed job is read-only, and the CoS can only list them.

/** The settings that set a job's interval. */
export const JOB_SETTINGS = ["prPollMinutes", "escalateMinutes", "resendMinutes", "sampleSeconds", "sustainSeconds"] as const;
export type JobSetting = (typeof JOB_SETTINGS)[number];
export type JobSettings = Record<JobSetting, number> & { retentionDays: number; activityRetentionDays: number; cosCompactTokens: number };

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface JobDef {
  id: string;
  what: string;
  /** "every": how often it runs; "after": how long something waits before the job acts on it (checked by `by`). */
  kind: "every" | "after";
  setting: JobSetting | null;
  unit: "min" | "s" | null;
  /** The interval in ms; null: off. */
  ms: (c: JobSettings) => number | null;
  /** The job whose runs check this one (an "after" row, or a check inside the clock's tick). */
  by?: string;
}

/** Every timed job, in the order the list shows them. `by` names the run whose last and next times it shares. */
export const JOBS: readonly JobDef[] = [
  { id: "pr-watch", what: "Read PRs and close PR waits", kind: "every", setting: "prPollMinutes", unit: "min", ms: (c) => (c.prPollMinutes > 0 ? c.prPollMinutes * MIN : null) },
  { id: "escalate", what: "Untriaged cards go to the owner", kind: "after", setting: "escalateMinutes", unit: "min", ms: (c) => c.escalateMinutes * MIN, by: "tick" },
  { id: "resend", what: "Resend unacked mail to idle agents", kind: "after", setting: "resendMinutes", unit: "min", ms: (c) => c.resendMinutes * MIN, by: "tick" },
  { id: "tick", what: "Deferrals, dead letters, status nudges", kind: "every", setting: null, unit: null, ms: () => 5 * S },
  { id: "wait-nudges", what: "Remind owners of unmet PR waits", kind: "every", setting: null, unit: null, ms: () => DAY },
  { id: "stale", what: "Tell the CoS about idle threads", kind: "every", setting: null, unit: null, ms: () => DAY },
  { id: "dead-letters", what: "Tell the CoS about new dead letters", kind: "every", setting: null, unit: null, ms: () => HOUR },
  { id: "xp", what: "Count XP from token use", kind: "every", setting: null, unit: null, ms: () => 2 * MIN },
  { id: "layout", what: "Place threads in sidebar sections", kind: "every", setting: null, unit: null, ms: () => 30 * S },
  { id: "compaction", what: "Check the CoS's context size", kind: "every", setting: null, unit: null, ms: (c) => (c.cosCompactTokens > 0 ? MIN : null) },
  { id: "retention", what: "Delete old finished rows", kind: "every", setting: null, unit: null, ms: (c) => (c.retentionDays > 0 || c.activityRetentionDays > 0 ? DAY : null) },
  { id: "sampler", what: "Sample disk, memory and CPU", kind: "every", setting: "sampleSeconds", unit: "s", ms: (c) => Math.max(5, c.sampleSeconds) * S },
  { id: "alarm", what: "An alarm must hold before it fires", kind: "after", setting: "sustainSeconds", unit: "s", ms: (c) => c.sustainSeconds * S, by: "sampler" },
  { id: "memory", what: "Reload the memory config", kind: "every", setting: null, unit: null, ms: () => MIN },
  { id: "dreams", what: "Dream batch and memory check", kind: "every", setting: null, unit: null, ms: () => MIN },
  { id: "notify-only", what: "Keep notification levels in step", kind: "every", setting: null, unit: null, ms: () => MIN },
];

export const JOB_IDS = new Set(JOBS.map((j) => j.id));

/** One job as the list shows it. */
export interface JobView {
  id: string;
  what: string;
  kind: "every" | "after";
  /** "every 5 min", "after 10 min", "every 5 s, fixed", "off". */
  interval: string;
  setting: JobSetting | null;
  value: number | null; // the setting's value
  unit: "min" | "s" | null;
  off: boolean;
  last: number | null;
  next: number | null;
  /** How the owner changes it: the exact command, for a job with a setting. */
  command: string | null;
}

/** The plugin's id in `bb plugin config <id> set <setting> <value>`. */
export const PLUGIN_ID = "orchestrator";
export const settingCommand = (setting: JobSetting, value: number | string): string => `bb plugin config ${PLUGIN_ID} set ${setting} ${value}`;

/** A duration in short words: "5 s", "2 min", "1 h", "1 day". */
export function span(ms: number): string {
  if (ms % DAY === 0) return ms === DAY ? "1 day" : `${ms / DAY} days`;
  if (ms % HOUR === 0) return `${ms / HOUR} h`;
  if (ms % MIN === 0) return `${ms / MIN} min`;
  return `${Math.round(ms / S)} s`;
}

/** The jobs with their intervals and their last and next runs. `ran`: when each job id last ran (a missing id: never). */
export function jobsView(c: JobSettings, ran: Readonly<Record<string, number | undefined>>): JobView[] {
  return JOBS.map((j) => {
    const ms = j.ms(c);
    const run = j.by ?? j.id;
    const last = ran[run] ?? null;
    const every = j.by ? JOBS.find((x) => x.id === j.by)!.ms(c) : ms;
    const value = j.setting ? c[j.setting] : null;
    const interval = ms === null ? "off" : `${j.kind} ${span(ms)}${j.setting ? "" : ", fixed"}`;
    return {
      id: j.id,
      what: j.what,
      kind: j.kind,
      interval,
      setting: j.setting,
      value,
      unit: j.unit,
      off: ms === null,
      last,
      next: ms === null || every === null ? null : last === null ? null : last + every,
      command: j.setting ? settingCommand(j.setting, value ?? "") : null,
    };
  });
}

/** Why the CoS (or anyone but the owner) can't change a job: its interval is the owner's setting, or fixed. */
export function jobRefusal(id: string, c: JobSettings): string {
  const j = JOBS.find((x) => x.id === id)!;
  const v = jobsView(c, {}).find((x) => x.id === id)!;
  return j.setting
    ? `${id} is a timed job (${v.interval}): its interval is the owner's setting ${j.setting}, which only the owner changes (${settingCommand(j.setting, "<value>")}). orch_watch only lists jobs`
    : `${id} is a timed job with a fixed interval (${v.interval}): nobody changes it from here. orch_watch only lists jobs`;
}

/** "3 min ago" / "in 2 min" / "now". */
export function rel(t: number, now: number): string {
  const d = t - now;
  const a = Math.abs(d);
  if (a < S) return "now";
  const w = a < MIN ? `${Math.round(a / S)} s` : a < HOUR ? `${Math.round(a / MIN)} min` : a < DAY ? `${Math.round(a / HOUR)} h` : `${Math.round(a / DAY)} d`;
  return d < 0 ? `${w} ago` : `in ${w}`;
}

/** One open PR wait as the list shows it. */
export interface WaitView {
  id: string;
  owner: string;
  ownerLive: boolean;
  ref: string;
  about: string;
  prUrl: string;
  when: string;
  createdAt: number;
  reading: { state: string | null; checks: string | null; review: string | null; attention: string | null; source: "bb" | "gh"; changedAt: number; readAt: number | null } | null;
}

const readingWords = (r: NonNullable<WaitView["reading"]>) =>
  [r.state, r.checks ? `checks ${r.checks}` : null, r.review && r.review !== "none" ? `review ${r.review.replace(/_/g, " ")}` : null].filter(Boolean).join(", ");

/** orch_watch's list: the waits, then the jobs, one line each. */
export function watchText(waits: readonly WaitView[], jobs: readonly JobView[], now: number): string {
  const lines: string[] = [];
  lines.push(waits.length ? `PR waits (${waits.length}):` : "No open PR waits.");
  for (const w of waits) {
    const r = w.reading;
    const seen = r ? `last read ${rel(r.readAt ?? r.changedAt, now)} via ${r.source}: ${readingWords(r)}` : "not read yet";
    lines.push(`- ${w.id} ${w.owner}${w.ownerLive ? "" : " (retired)"}: ${w.ref} until ${w.prUrl} is ${w.when} (bound ${rel(w.createdAt, now)}; ${seen})`);
  }
  lines.push(`Timed jobs (${jobs.length}), list only: intervals are the owner's settings:`);
  for (const j of jobs) {
    const when = j.off ? "" : `; last ${j.last === null ? "not yet" : rel(j.last, now)}${j.next === null ? "" : `, next ${rel(j.next, now)}`}`;
    lines.push(`- ${j.id}: ${j.what}, ${j.interval}${j.setting ? ` (${j.setting})` : ""}${when}`);
  }
  return lines.join("\n");
}
