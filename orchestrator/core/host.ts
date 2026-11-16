// The Steward's eyes: CPU, memory, swap and disk from /proc and statfs, and the alarm rule (a threshold crossed for
// a sustained time, firing again only when the level changes). Code only: no model looks at a gauge.
import { readFileSync, statfsSync } from "node:fs";

export interface Snapshot {
  at: string;
  memPct: number;
  swapPct: number;
  diskPct: number;
  diskPath: string;
  cpuPct: number | null; // busy share since the last sample
  load1: number;
}

export interface Thresholds {
  diskPct: number;
  swapPct: number;
  memPct: number;
  cpuPct: number;
  sustainMs: number;
}

let lastCpu: { busy: number; total: number } | null = null;

function cpuSample(): number | null {
  const line = readFileSync("/proc/stat", "utf8").split("\n")[0]!;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (n[3] ?? 0) + (n[4] ?? 0);
  const total = n.reduce((a, b) => a + b, 0);
  const cur = { busy: total - idle, total };
  const prev = lastCpu;
  lastCpu = cur;
  if (!prev || cur.total === prev.total) return null;
  return Math.round((1000 * (cur.busy - prev.busy)) / (cur.total - prev.total)) / 10;
}

export function sample(diskPath: string, now: number): Snapshot {
  const mem = Object.fromEntries(
    readFileSync("/proc/meminfo", "utf8")
      .split("\n")
      .map((l) => l.match(/^(\w+):\s+(\d+)/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], Number(m[2])]),
  ) as Record<string, number>;
  const pct = (used: number, total: number) => (total > 0 ? Math.round((1000 * used) / total) / 10 : 0);
  const fs = statfsSync(diskPath);
  const load1 = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
  return {
    at: new Date(now).toISOString(),
    memPct: pct((mem.MemTotal ?? 0) - (mem.MemAvailable ?? 0), mem.MemTotal ?? 0),
    swapPct: pct((mem.SwapTotal ?? 0) - (mem.SwapFree ?? 0), mem.SwapTotal ?? 0),
    diskPct: pct(Number(fs.blocks - fs.bfree), Number(fs.blocks - fs.bfree + fs.bavail)),
    diskPath,
    cpuPct: cpuSample(),
    load1,
  };
}

const METRICS = [
  ["disk", "diskPct"],
  ["swap", "swapPct"],
  ["memory", "memPct"],
  ["cpu", "cpuPct"],
] as const;

/** Which metrics are over their threshold right now. */
export function over(s: Snapshot, t: Thresholds): string[] {
  return METRICS.filter(([, k]) => {
    const v = s[k];
    return v !== null && v >= t[k];
  }).map(([name]) => name);
}

/**
 * The alarm rule. A metric counts once it has been over its threshold for `sustainMs` without a break; the level is
 * the sorted list of counting metrics ("ok" when none). `step` returns the new level when it changed (to fire on),
 * else null. The first level seen is a change only when it isn't "ok".
 */
export class AlarmState {
  private since = new Map<string, number>();
  level: string | null = null;

  /** After a restart: take up the last level fired, as if its metrics had already held for the sustain time. */
  restore(level: string | null, now: number, sustainMs: number): void {
    if (level === null) return;
    this.level = level;
    if (level !== "ok") for (const m of level.split("+")) this.since.set(m, now - sustainMs);
  }

  step(s: Snapshot, t: Thresholds, now: number): string | null {
    const hot = new Set(over(s, t));
    for (const m of [...this.since.keys()]) if (!hot.has(m)) this.since.delete(m);
    for (const m of hot) if (!this.since.has(m)) this.since.set(m, now);
    const counting = [...this.since.entries()].filter(([, at]) => now - at >= t.sustainMs).map(([m]) => m).sort();
    const level = counting.length ? counting.join("+") : "ok";
    const prev = this.level;
    this.level = level;
    if (prev === level) return null;
    if (prev === null && level === "ok") return null;
    return level;
  }
}

export function describe(level: string, s: Snapshot, t: Thresholds): string {
  if (level === "ok") return `Host back to normal (disk ${s.diskPct}%, swap ${s.swapPct}%, memory ${s.memPct}%).`;
  const parts = level.split("+").map((m) => {
    switch (m) {
      case "disk":
        return `disk ${s.diskPct}% ≥ ${t.diskPct}% (${s.diskPath})`;
      case "swap":
        return `swap ${s.swapPct}% ≥ ${t.swapPct}%`;
      case "memory":
        return `memory ${s.memPct}% ≥ ${t.memPct}%`;
      default:
        return `CPU ${s.cpuPct}% ≥ ${t.cpuPct}%`;
    }
  });
  return `Host alarm (${level}): ${parts.join("; ")}, for ${Math.round(t.sustainMs / 1000)} s or more.`;
}
