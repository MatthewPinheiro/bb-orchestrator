// cloud-switch's core, shared by the `cloud` CLI and the bb plugin's host entry: the list of AWS profiles and GCP
// configurations with their env, login state, identity and PIM gate; the swap's checks (the swap itself is a bb machine
// variable, core/machineenv.ts); the login commands;
// and the GCP revoke. No bb import.
//
// What it reads: the user's cloud-switch config (core/config.ts), the AWS config file (profiles, no secrets), `aws sts get-caller-identity`, `gcloud config
// configurations list`, `gcloud auth list`, `gcloud info` (the config folder), and the mtime of gcloud's
// application-default file (stat only). It never opens ~/.aws/sso/cache, an AWS credentials file or gcloud's
// credential databases, and runs no command that prints a token. CLI text that it passes on is redacted (mask.ts).

import { existsSync, readFileSync, statSync } from "node:fs";
import { profiles, type Profile } from "./awsconfig.ts";
import { expandPath, loadConfig, type Config, type ConfigInfo } from "./config.ts";
import { firstLine } from "./mask.ts";
import { awsEnv, awsPim, gcpDefs, gcpEnv, gcpPim, isGated, type Env, type PimGroup } from "./pim.ts";
import { nodeRun, type Reply, type Run } from "./run.ts";

export type Cloud = "aws" | "gcp";
export type Target = {
  cloud: Cloud; name: string; env: Env; gated: boolean; active: boolean;
  /** unchecked: a gated (prod or unknown-env) AWS profile whose sts call wasn't asked for (it would fetch role credentials) */
  state: "in" | "out" | "unknown" | "unchecked"; identity: string | null; why: string | null;
  account: string | null; role: string | null; project: string | null;
  /** gcp: the gcloud configuration exists (a defined one is created on first use or login) */
  created: boolean;
  pim: PimGroup[];
};
export type Listing = {
  targets: Target[];
  /** active: what the switch set (AWS_PROFILE); null: off, aws uses the default chain (the instance role) */
  aws: { config: string; source: AwsSource; active: string | null };
  /** active: what the switch set (CLOUDSDK_ACTIVE_CONFIG_NAME); gcloudActive: gcloud's own, which applies when it's off */
  gcp: { active: string | null; gcloudActive: string | null; loginConfig: string | null; adc: { present: boolean; writtenAt: number | null } };
  /** the user's config file: where it is and whether it was read; links: what it lists for the page and --help */
  config: ConfigInfo;
  links: { label: string; url: string }[];
  notes: string[];
};
/** env: AWS_CONFIG_FILE; config: one of the config file's aws.configPaths; home: ~/.aws/config */
export type AwsSource = "env" | "config" | "home";

export type Ctx = {
  run: Run;
  env: Record<string, string | undefined>;
  awsConfig: string;
  awsSource: AwsSource;
  loginConfig: string | null;
  config: Config;
  configInfo: ConfigInfo;
  /** the environment logins run with (passed to a terminal) */
  childEnv: Record<string, string>;
  mtime: (path: string) => number | null;
};

export class GateError extends Error {}
export class TargetError extends Error {}

/** Where the AWS config is: AWS_CONFIG_FILE; else the first of the config file's aws.configPaths that exists; else
 * ~/.aws/config. */
export function awsPaths(env: Record<string, string | undefined>, extra: readonly string[] = [], exists: (p: string) => boolean = existsSync): { config: string; source: AwsSource } {
  if (env.AWS_CONFIG_FILE) return { config: env.AWS_CONFIG_FILE, source: "env" };
  const found = extra.map((p) => expandPath(p, env)).find((p) => p.startsWith("/") && exists(p));
  if (found) return { config: found, source: "config" };
  return { config: `${env.HOME ?? ""}/.aws/config`, source: "home" };
}

/** The GCP workforce login config (a JSON file gcloud reads; only checked for being there, never opened here). */
/** Looked for in order: the plugin's setting, CLOUD_SWITCH_GCP_LOGIN_CONFIG, the config file's gcp.loginConfig, then
 * ~/.config/cloud-switch/gcp-login-config.json. */
export function findLoginConfig(env: Record<string, string | undefined>, setting: string | null = null, fromConfig: string | null = null, exists: (p: string) => boolean = existsSync): string | null {
  const home = env.HOME ?? "";
  const candidates = [setting, env.CLOUD_SWITCH_GCP_LOGIN_CONFIG, fromConfig && expandPath(fromConfig, env), `${home}/.config/cloud-switch/gcp-login-config.json`];
  return candidates.find((p): p is string => !!p && p.startsWith("/") && exists(p)) ?? null;
}

/** opts.configPath: the plugin's setting for the config file (else CLOUD_SWITCH_CONFIG, else the default). */
export function makeCtx(env: Record<string, string | undefined> = process.env, opts: { loginConfig?: string | null; configPath?: string | null; run?: Run } = {}): Ctx {
  const loaded = loadConfig(env, opts.configPath ?? null);
  const { config, source } = awsPaths(env, loaded.config.aws.configPaths);
  const childEnv: Record<string, string> = { AWS_CONFIG_FILE: config, PYTHONUNBUFFERED: "1" };
  if (env.CLOUDSDK_CONFIG) childEnv.CLOUDSDK_CONFIG = env.CLOUDSDK_CONFIG;
  // the core names every profile and configuration itself, and reads gcloud's own active one, so the switch's two
  // variables (which this process may carry) are left out
  const runEnv = { ...env, ...childEnv, CLOUDSDK_CORE_DISABLE_PROMPTS: "1", CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: "1" } as NodeJS.ProcessEnv;
  delete runEnv.AWS_PROFILE;
  delete runEnv.CLOUDSDK_ACTIVE_CONFIG_NAME;
  return {
    run: opts.run ?? nodeRun(runEnv), env, awsConfig: config, awsSource: source, childEnv,
    loginConfig: findLoginConfig(env, opts.loginConfig ?? null, loaded.config.gcp.loginConfig ?? null),
    config: loaded.config, configInfo: loaded.info,
    mtime: (p) => { try { return Math.floor(statSync(p).mtimeMs / 1000); } catch { return null; } },
  };
}

// ---- AWS ----

const readAws = (ctx: Ctx): string | null => { try { return readFileSync(ctx.awsConfig, "utf8"); } catch { return null; } };
const accountOf = (p: Profile) => p.keys.sso_account_id ?? /^arn:aws:iam::(\d{12}):/.exec(p.keys.role_arn ?? "")?.[1];

const LOGGED_OUT: [RegExp, string][] = [
  [/Token for \S+ does not exist/i, "no SSO token: log in"],
  [/Token has expired/i, "SSO token expired: log in"],
  [/session associated with this profile has expired/i, "SSO session expired: log in"],
  [/Error loading SSO Token/i, "no SSO token: log in"],
  [/Unable to locate credentials/i, "no credentials: log in"],
];

export const STS = (profile: string | null): string[] =>
  ["sts", "get-caller-identity", ...(profile ? [`--profile=${profile}`] : []), "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "5", "--cli-read-timeout", "5"];

/** A profile's login state and identity from `aws sts get-caller-identity`. */
export function stsState(r: Reply, pim: PimGroup[]): Pick<Target, "state" | "identity" | "why"> {
  if (r.code === 0) {
    try {
      const j = JSON.parse(r.stdout);
      if (j && typeof j.Arn === "string") return { state: "in", identity: j.Arn, why: null };
    } catch { /* not an identity */ }
    return { state: "unknown", identity: null, why: "sts gave no identity" };
  }
  if (r.code === null) return { state: "unknown", identity: null, why: r.why ?? "aws did not run" };
  const out = LOGGED_OUT.find(([re]) => re.test(r.stderr));
  if (out) return { state: "out", identity: null, why: out[1] };
  if (/ForbiddenException|No access/i.test(r.stderr)) {
    const gate = pim.find((p) => p.assignment === "eligible");
    return { state: "unknown", identity: null, why: gate ? `no access to the role: activate ${gate.group} in PIM, then log in again` : "no access to the role" };
  }
  return { state: "unknown", identity: null, why: firstLine(r.stderr) || `aws exited ${r.code}` };
}

/** Which gated AWS profiles a listing may run sts for: none (the default), all (`cloud ls --check-prod`), or one by name. */
export type CheckGated = "none" | "all" | { name: string };

/** A profile's row. sts runs for a dev profile always, and for a gated one only when `check` says so: on an SSO
 * profile it fetches role credentials, which for prod must be a person's ask, never a page view on its own. */
async function awsTarget(ctx: Ctx, p: Profile, active: string | null, check: CheckGated): Promise<Target> {
  const account = accountOf(p) ?? null, role = p.keys.sso_role_name ?? null, env = awsEnv(ctx.config, account ?? undefined), pim = awsPim(ctx.config, account ?? undefined, role ?? undefined);
  const gated = isGated(env);
  const run = !gated || check === "all" || (typeof check === "object" && check.name === p.name);
  const st: Pick<Target, "state" | "identity" | "why"> = run ? stsState(await ctx.run("aws", STS(p.name)), pim)
    : { state: "unchecked", identity: null, why: `${env === "prod" ? "prod" : "env unknown"}: check on demand` };
  return { cloud: "aws", name: p.name, env, gated, active: p.name === active, ...st, account, role, project: null, created: true, pim };
}

async function listAws(ctx: Ctx, notes: string[], check: CheckGated, active: string | null): Promise<Target[]> {
  const text = readAws(ctx);
  if (text === null) { notes.push(`No AWS config at ${ctx.awsConfig}.`); return []; }
  const ps = profiles(text);
  if (active && !ps.some((p) => p.name === active)) notes.push(`AWS_PROFILE is set to ${active}, which is not in the AWS config.`);
  return Promise.all(ps.map((p) => awsTarget(ctx, p, active, check)));
}

// ---- GCP ----

type GConfig = { name: string; is_active?: boolean; properties?: { core?: { account?: string; project?: string }; auth?: { login_config_file?: string } } };

const json = <T>(r: Reply): T | null => { if (r.code !== 0) return null; try { return JSON.parse(r.stdout) as T; } catch { return null; } };
/** A workforce principal shows as its subject: principal://…/workforcePools/<pool>/subject/<subject> -> <subject>. */
export const shortAccount = (a: string) => /\/subject\/(.+)$/.exec(a)?.[1] ?? a;

export async function gcloudConfigs(ctx: Ctx): Promise<{ configs: GConfig[] | null; why: string | null }> {
  const r = await ctx.run("gcloud", ["config", "configurations", "list", "--format=json"]);
  const configs = json<GConfig[]>(r);
  return { configs: Array.isArray(configs) ? configs : null, why: configs ? null : r.why ?? (firstLine(r.stderr) || "gcloud gave no configurations") };
}

async function listGcp(ctx: Ctx, notes: string[], active: string | null): Promise<{ targets: Target[]; gcloudActive: string | null; adc: Listing["gcp"]["adc"] }> {
  const [cfg, auth, info] = await Promise.all([
    gcloudConfigs(ctx),
    ctx.run("gcloud", ["auth", "list", "--format=json"]),
    ctx.run("gcloud", ["info", "--format=value(config.paths.global_config_dir)"]),
  ]);
  if (cfg.why) notes.push(`gcloud: ${cfg.why}`);
  const held = new Set((json<{ account?: string }[]>(auth) ?? []).map((a) => a.account).filter(Boolean));
  const dir = info.code === 0 ? info.stdout.trim() : "";
  const writtenAt = dir.startsWith("/") ? ctx.mtime(`${dir}/application_default_credentials.json`) : null;
  const configs = cfg.configs ?? [], defs = gcpDefs(ctx.config);
  const names = [...defs.map((d) => d.name), ...configs.map((c) => c.name).filter((n) => !defs.some((d) => d.name === n))];
  const targets = names.map((name): Target => {
    const c = configs.find((x) => x.name === name), def = defs.find((d) => d.name === name);
    const project = c?.properties?.core?.project ?? def?.project ?? null, account = c?.properties?.core?.account ?? null;
    const env = gcpEnv(ctx.config, project ?? undefined);
    const st: Pick<Target, "state" | "identity" | "why"> = !cfg.configs ? { state: "unknown", identity: null, why: cfg.why }
      : !c ? { state: "out", identity: null, why: "not created yet: use or log in creates it" }
      : !account ? { state: "out", identity: null, why: "not logged in" }
      : held.has(account) ? { state: "in", identity: shortAccount(account), why: null }
      : { state: "out", identity: shortAccount(account), why: "its account has no credentials: log in" };
    return { cloud: "gcp", name, env, gated: isGated(env), active: name === active, ...st, account, role: null, project, created: !!c, pim: gcpPim(ctx.config, project ?? undefined) };
  });
  return { targets, gcloudActive: configs.find((c) => c.is_active)?.name ?? null, adc: { present: writtenAt !== null, writtenAt } };
}

/** active: what the switch has set (from its record, where bb still has the variable). */
export async function list(ctx: Ctx, active: { aws: string | null; gcp: string | null }, check: CheckGated = "none"): Promise<Listing> {
  const notes: string[] = [];
  const [aws, gcp] = await Promise.all([listAws(ctx, notes, check, active.aws), listGcp(ctx, notes, active.gcp)]);
  return {
    targets: [...aws, ...gcp.targets],
    aws: { config: ctx.awsConfig, source: ctx.awsSource, active: active.aws },
    gcp: { active: active.gcp, gcloudActive: gcp.gcloudActive, loginConfig: ctx.loginConfig, adc: gcp.adc },
    config: ctx.configInfo,
    links: ctx.config.links,
    notes,
  };
}

/** One AWS profile, checked now with sts (the page's Check on a gated row). Read-only, so no confirm. */
export async function checkAws(ctx: Ctx, name: string, active: string | null = null): Promise<Target> {
  const text = readAws(ctx);
  if (text === null) throw new TargetError(`no AWS config at ${ctx.awsConfig}`);
  const p = profiles(text).find((x) => x.name === name);
  if (!p) throw new TargetError(`no AWS profile ${name}`);
  return awsTarget(ctx, p, active, { name });
}

// ---- gate ----

/** Prod (or an env the config doesn't give) needs an explicit confirm: `true` (the CLI's --yes-prod) or the target's
 * own name (the page's second step names it). */
export function checkGate(t: { cloud: Cloud; name: string; env: Env }, confirm: string | true | undefined): void {
  if (!isGated(t.env) || confirm === true || confirm === t.name) return;
  throw new GateError(`${t.cloud} ${t.name} is ${t.env === "prod" ? "PROD" : "not known to be dev"}: confirm it (CLI: --yes-prod)`);
}

// ---- swap ----

/** The checks before the switch sets a variable: the target exists, the prod gate, and a defined GCP configuration is
 * created (never activated: CLOUDSDK_ACTIVE_CONFIG_NAME picks it). Writes no AWS file. */
export async function prepareUse(ctx: Ctx, cloud: Cloud, name: string, confirm?: string | true): Promise<{ name: string; created: boolean }> {
  if (cloud === "aws") {
    const text = readAws(ctx);
    if (text === null) throw new TargetError(`no AWS config at ${ctx.awsConfig}`);
    const p = profiles(text).find((x) => x.name === name);
    if (!p) throw new TargetError(`no AWS profile ${name}`);
    checkGate({ cloud, name, env: awsEnv(ctx.config, accountOf(p)) }, confirm);
    return { name, created: false };
  }
  const t = await gcpTarget(ctx, name);
  checkGate({ cloud, name, env: gcpEnv(ctx.config, t.project ?? undefined) }, confirm);
  return { name, created: await ensureGcp(ctx, name, t) };
}

/** The GCP target named: an existing configuration, or one cloud-switch defines. */
async function gcpTarget(ctx: Ctx, name: string): Promise<{ project: string | null; exists: boolean; loginConfig: string | null; configs: GConfig[] }> {
  const { configs, why } = await gcloudConfigs(ctx);
  if (!configs) throw new TargetError(`gcloud: ${why}`);
  const c = configs.find((x) => x.name === name), def = gcpDefs(ctx.config).find((d) => d.name === name);
  if (!c && !def) throw new TargetError(`no gcloud configuration ${name}`);
  return { project: c?.properties?.core?.project ?? def?.project ?? null, exists: !!c, loginConfig: c?.properties?.auth?.login_config_file ?? ctx.loginConfig, configs };
}

const must = async (ctx: Ctx, args: string[]) => {
  const r = await ctx.run("gcloud", args);
  if (r.code !== 0) throw new TargetError(`gcloud ${args.slice(0, 3).join(" ")}: ${r.why ?? (firstLine(r.stderr) || `exit ${r.code}`)}`);
};

/** Creates a defined configuration (without activating it), with its project and the login config. */
export async function ensureGcp(ctx: Ctx, name: string, t: { project: string | null; exists: boolean; loginConfig: string | null }): Promise<boolean> {
  if (t.exists) return false;
  await must(ctx, ["config", "configurations", "create", name, "--no-activate"]);
  if (t.project) await must(ctx, ["config", "set", "project", t.project, `--configuration=${name}`]);
  if (t.loginConfig) await must(ctx, ["config", "set", "auth/login_config_file", t.loginConfig, `--configuration=${name}`]);
  return true;
}

// ---- login ----

export type LoginPlan = { steps: string[][]; env: Record<string, string>; title: string };

export async function planLogin(ctx: Ctx, cloud: Cloud, name: string, confirm?: string | true): Promise<LoginPlan> {
  if (cloud === "aws") {
    const text = readAws(ctx);
    const p = text === null ? undefined : profiles(text).find((x) => x.name === name);
    if (!p) throw new TargetError(`no AWS profile ${name}`);
    checkGate({ cloud, name, env: awsEnv(ctx.config, accountOf(p)) }, confirm);
    return { steps: [["aws", "sso", "login", `--profile=${name}`, "--use-device-code", "--no-browser"]], env: ctx.childEnv, title: `Log in · aws ${name}` };
  }
  const t = await gcpTarget(ctx, name);
  checkGate({ cloud, name, env: gcpEnv(ctx.config, t.project ?? undefined) }, confirm);
  if (!t.loginConfig) throw new TargetError("no GCP login config found: set gcp.loginConfig in the config file, CLOUD_SWITCH_GCP_LOGIN_CONFIG, or the plugin's gcpLoginConfig setting to its full path");
  if (!t.project) throw new TargetError(`gcloud configuration ${name} has no project`);
  await ensureGcp(ctx, name, t);
  const c = `--configuration=${name}`, lc = `--login-config=${t.loginConfig}`;
  // CLI login, then the project, then ADC (ADC's trailing check runs against the project)
  return {
    steps: [
      ["gcloud", "auth", "login", lc, "--no-launch-browser", c],
      ["gcloud", "config", "set", "project", t.project, c],
      ["gcloud", "auth", "application-default", "login", lc, "--no-launch-browser", c],
    ],
    env: ctx.childEnv,
    title: `Log in · gcp ${name}`,
  };
}

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** One argv that runs a plan in a terminal: `env K=V… <step>`, or for several steps `env K=V… bash -c '<a> && <b> …'`. */
export function terminalArgv(plan: LoginPlan): string[] {
  const env = ["env", ...Object.entries(plan.env).map(([k, v]) => `${k}=${v}`)];
  if (plan.steps.length === 1) return [...env, ...plan.steps[0]];
  return [...env, "bash", "-c", `${plan.steps.map((s) => s.map(shq).join(" ")).join(" && ")} && echo && echo ${shq(`cloud-switch: ${plan.title} done.`)}`];
}

/** The verification URL and user code `aws sso login --use-device-code --no-browser` prints (PrintOnlyHandler). */
export function parseDeviceCode(text: string): { url: string; code: string; completeUrl: string | null } | null {
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
  const url = /following URL:\s*\n\s*(https:\/\/\S+)/.exec(t)?.[1];
  const code = /enter the code:\s*\n\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)/.exec(t)?.[1];
  if (!url || !code) return null;
  const completeUrl = /autofill the code upon loading:\s*\n\s*(https:\/\/\S+)/.exec(t)?.[1] ?? null;
  return { url, code, completeUrl };
}

// ---- revoke ----

export async function revokeGcp(ctx: Ctx, confirm: boolean): Promise<{ steps: { command: string; ok: boolean; message: string }[] }> {
  if (confirm !== true) throw new GateError("revoking signs every gcloud account and ADC out of this machine: confirm it (CLI: --yes)");
  const steps = [];
  for (const [args, nothing] of [
    [["auth", "revoke", "--all", "--quiet"], /No credentials|no credentialed accounts/i],
    [["auth", "application-default", "revoke", "--quiet"], /nothing to revoke/i],
  ] as [string[], RegExp][]) {
    const r = await ctx.run("gcloud", args);
    const command = `gcloud ${args.join(" ")}`;
    if (r.code === 0) steps.push({ command, ok: true, message: /nothing to revoke/i.test(r.stderr + r.stdout) ? "nothing to revoke" : "revoked" });
    else if (r.code !== null && nothing.test(r.stderr)) steps.push({ command, ok: true, message: "nothing to revoke" });
    else steps.push({ command, ok: false, message: r.why ?? (firstLine(r.stderr) || `exit ${r.code}`) });
  }
  return { steps };
}

// ---- whoami ----

/** Who a bare aws / gcloud call in this shell is: AWS_PROFILE (else the default chain) and CLOUDSDK_ACTIVE_CONFIG_NAME
 * (else gcloud's own active configuration), as this process carries them. */
export async function whoami(ctx: Ctx): Promise<{ aws: { profile: string | null; identity: string | null; why: string | null }; gcp: { config: string | null; account: string | null; project: string | null } }> {
  const profile = ctx.env.AWS_PROFILE || null;
  const [sts, cfg] = await Promise.all([ctx.run("aws", STS(profile)), gcloudConfigs(ctx)]);
  const st = stsState(sts, []);
  const name = ctx.env.CLOUDSDK_ACTIVE_CONFIG_NAME || cfg.configs?.find((c) => c.is_active)?.name || null;
  const g = cfg.configs?.find((c) => c.name === name) ?? null;
  return {
    aws: { profile, identity: st.identity, why: st.why },
    gcp: { config: name, account: g?.properties?.core?.account ? shortAccount(g.properties.core.account) : null, project: g?.properties?.core?.project ?? null },
  };
}
