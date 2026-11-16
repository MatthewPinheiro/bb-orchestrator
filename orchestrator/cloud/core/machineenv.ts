// The swap: bb machine environment variables. The active AWS profile is AWS_PROFILE and the active gcloud configuration
// is CLOUDSDK_ACTIVE_CONFIG_NAME, set one row at a time (`bb machine env set NAME`, value on stdin, or the SDK's
// setMachineEnvironmentVariable), never by replacing the whole table. Off is `unset`: aws falls back to the default
// chain (the runner's instance role), gcloud to its own active configuration.
//
// bb never shows these values back (list masks them), so cloud-switch keeps its own record of what it set, in a small
// file on the machine the bb server runs on (the runner, for the runner's bb).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Cloud = "aws" | "gcp";
export const VARS: Record<Cloud, string> = { aws: "AWS_PROFILE", gcp: "CLOUDSDK_ACTIVE_CONFIG_NAME" };
export const NOTE = "Applies to new threads, terminals and commands; running agent sessions keep theirs until restarted; pass --profile/--configuration to be explicit.";
export const BB_NOTE = "set by cloud-switch";

// The runner's own bb. A bare `bb` inside a thread can point at another bb, so the CLI always names this one.
export const RUNNER_BB = { url: "http://127.0.0.1:38886", daemonPort: "38887" };

export type Scope = { aws: string | null; gcp: string | null };
export type Rec = { global: Scope; projects: Record<string, Scope> };
const EMPTY: Scope = { aws: null, gcp: null };

export const recordPath = (env: Record<string, string | undefined>) => join(env.HOME ?? "", ".local/state/cloud-switch/machine-env.json");

export function readRecord(path: string): Rec {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return { global: { ...EMPTY, ...j.global }, projects: j.projects ?? {} };
  } catch { return { global: { ...EMPTY }, projects: {} }; }
}

/** rec with `cloud`'s variable set to name (null: unset), globally or for one project. Pure. */
export function withChoice(rec: Rec, cloud: Cloud, name: string | null, project: string | null = null): Rec {
  if (!project) return { ...rec, global: { ...rec.global, [cloud]: name } };
  return { ...rec, projects: { ...rec.projects, [project]: { ...EMPTY, ...rec.projects[project], [cloud]: name } } };
}

export function writeRecord(path: string, rec: Rec): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

export type EnvList = { variables: { name: string }[]; inheritedVariables?: { name: string }[] };
export type Active = { [c in Cloud]: { set: boolean; value: string | null } };

/** What is set now: bb's list says which variables exist (values masked), the record says what cloud-switch set them
 * to. For a project, its own row wins over the inherited global one. set && value null: set outside cloud-switch. */
export function activeFrom(rec: Rec, list: EnvList, project: string | null = null): Active {
  const own = new Set(list.variables.map((v) => v.name)), inherited = new Set((list.inheritedVariables ?? []).map((v) => v.name));
  const one = (c: Cloud) => {
    const n = VARS[c];
    if (project && own.has(n)) return { set: true, value: rec.projects[project]?.[c] ?? null };
    if (project ? inherited.has(n) : own.has(n)) return { set: true, value: rec.global[c] };
    return { set: false, value: null };
  };
  return { aws: one("aws"), gcp: one("gcp") };
}

// ---- the CLI's way in: the bb CLI, pointed at the runner's bb ----

/** The bb CLI's environment: the caller's, minus every BB_* (a thread's BB_CLI, ids, URL), plus the runner's bb. */
export function bbEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !k.startsWith("BB_")) out[k] = v;
  out.BB_SERVER_URL = env.CLOUD_SWITCH_BB_SERVER_URL || RUNNER_BB.url;
  out.BB_HOST_DAEMON_PORT = env.CLOUD_SWITCH_BB_HOST_DAEMON_PORT || RUNNER_BB.daemonPort;
  return out;
}

/** `bb machine env set|unset NAME [--project id]` argv (set reads the value from stdin). */
export const bbArgs = (op: "set" | "unset", cloud: Cloud, project: string | null): string[] =>
  ["machine", "env", op, VARS[cloud], ...(project ? ["--project", project] : []), ...(op === "set" ? ["--note", BB_NOTE] : []), "--json"];
