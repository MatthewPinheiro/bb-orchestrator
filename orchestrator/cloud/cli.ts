// The `cloud` CLI: the same core as the bb page (core/cloud.ts, core/machineenv.ts).
//
//   cloud ls [--json] [--check-prod] [--project <id>]   every AWS profile and GCP configuration: env, login, identity,
//                                                       PIM gate, and which one the switch has made active
//                                                       (prod AWS profiles show "unchecked" unless --check-prod)
//   cloud use aws|gcp <name> [--yes-prod] [--project <id>]
//                                                       set AWS_PROFILE / CLOUDSDK_ACTIVE_CONFIG_NAME in the runner's
//                                                       bb machine environment (one row; the AWS config is never written)
//   cloud off aws|gcp [--project <id>]                  unset it: aws goes back to the default chain (the instance role),
//                                                       gcloud to its own active configuration
//   cloud login aws|gcp <name> [--yes-prod]             AWS: device-code SSO login; GCP: workforce login, project, ADC
//   cloud whoami [--json]                               who a bare aws / gcloud call in this shell is
//   cloud revoke gcp [--yes]                            sign every gcloud account and ADC out of this machine
//
// The variables live in the runner's bb (127.0.0.1:38886): the bb CLI is always pointed there (core/machineenv.ts).
// Which accounts and projects are dev or prod, and their PIM groups, come from the config file (core/config.ts):
// CLOUD_SWITCH_CONFIG, else ~/.config/bb-cloud-switch/config.json.
import { spawnSync } from "node:child_process";
import { GateError, TargetError, list, makeCtx, planLogin, prepareUse, revokeGcp, whoami, type Cloud, type Target } from "./core/cloud.ts";
import { NOTE, VARS, activeFrom, bbArgs, bbEnv, readRecord, recordPath, withChoice, writeRecord, type EnvList } from "./core/machineenv.ts";
import type { PimGroup } from "./core/pim.ts";
import { firstLine, redact } from "./core/mask.ts";

const USAGE = `Usage:
  cloud ls [--json] [--check-prod] [--project <id>]
  cloud use aws|gcp <name> [--yes-prod] [--project <id>]
  cloud off aws|gcp [--project <id>]
  cloud login aws|gcp <name> [--yes-prod]
  cloud whoami [--json]
  cloud revoke gcp [--yes]

use/off set or unset ${VARS.aws} / ${VARS.gcp} in the runner's bb machine environment.
${NOTE}`;
/** The usage, with the config file's links (an Entra PIM page, a My Apps portal, ...). */
const usage = (links: { label: string; url: string }[] = []) => [USAGE, ...links.map((l) => `${l.label}: ${l.url}`)].join("\n");

class BbError extends Error {}

const pimText = (p: PimGroup) =>
  `${p.group} (${p.assignment === "active" ? "always on" : `${p.approval ? "approval" : "self-activate"}, ${p.maxDuration}`})${p.inferred ? "?" : ""}`;

function table(rows: string[][]): string {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join("  ")).join("\n");
}

const row = (t: Target) => [
  t.cloud, t.name, t.env === "prod" ? "PROD" : t.env, t.active ? "*" : "",
  t.state, t.identity ?? t.why ?? "", t.pim.map(pimText).join("; ") || "-",
];

/** The bb CLI, on the runner's bb. `input`: the value for `set` (stdin, so it is never an argument). */
function bb(args: string[], input = ""): string {
  const r = spawnSync("bb", args, { env: bbEnv(process.env), input, encoding: "utf8", timeout: 30_000 });
  if (r.error || r.status !== 0) {
    throw new BbError(`bb ${args.slice(0, 3).join(" ")} failed: ${r.error ? r.error.message : firstLine(r.stderr) || firstLine(r.stdout) || `exit ${r.status}`}`);
  }
  return r.stdout;
}

async function main(argv: string[]): Promise<number> {
  const words: string[] = [], flags = new Set<string>();
  let project: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") project = argv[++i] ?? "";
    else if (a.startsWith("--project=")) project = a.slice("--project=".length);
    else if (a.startsWith("--")) flags.add(a);
    else words.push(a);
  }
  const [cmd, cloud, name] = words;
  const known = new Set(["--json", "--check-prod", "--yes-prod", "--yes", "--help"]);
  const bad = [...flags].find((f) => !known.has(f)) ?? (project === "" || project?.startsWith("-") ? "--project needs a project id" : undefined);
  const ctx = makeCtx(process.env);
  if (!cmd || flags.has("--help") || bad) { (bad ? console.error : console.log)(bad ? `bad option: ${bad}\n${USAGE}` : usage(ctx.config.links)); return bad ? 2 : 0; }
  const confirm = flags.has("--yes-prod") ? (true as const) : undefined;
  const isCloud = (c: string | undefined): c is Cloud => c === "aws" || c === "gcp";
  const where = project ? ` for project ${project}` : "";
  const recPath = recordPath(process.env);

  switch (cmd) {
    case "ls": {
      const notes: string[] = [];
      let active: { aws: string | null; gcp: string | null } = { aws: null, gcp: null };
      // bb has the variable but cloud-switch didn't set it (or lost its record): its value is hidden, it is not off
      const outside = { aws: false, gcp: false };
      try {
        const set = JSON.parse(bb(["machine", "env", "list", ...(project ? ["--project", project] : []), "--json"])) as EnvList;
        const now = activeFrom(readRecord(recPath), set, project);
        active = { aws: now.aws.value, gcp: now.gcp.value };
        outside.aws = now.aws.set && !now.aws.value;
        outside.gcp = now.gcp.set && !now.gcp.value;
      } catch (e) { notes.push(`couldn't ask the runner's bb which variables are set: ${redact((e as Error).message)}`); }
      const hidden = "set outside cloud-switch (bb hides its value; cloud use replaces it, cloud off removes it)";
      const l = await list(ctx, active, flags.has("--check-prod") ? "all" : "none");
      l.notes.push(...notes);
      if (flags.has("--json")) { console.log(JSON.stringify(l, null, 2)); return 0; }
      console.log(table([["CLOUD", "NAME", "ENV", "ACTIVE", "STATE", "IDENTITY", "PIM GROUP"], ...l.targets.map(row)]));
      console.log(`\n${VARS.aws}${where}: ${l.aws.active ?? (outside.aws ? hidden : "unset (aws uses the default chain: this machine's instance role)")}`);
      console.log(`${VARS.gcp}${where}: ${l.gcp.active ?? (outside.gcp ? hidden : `unset (gcloud uses its own active configuration: ${l.gcp.gcloudActive ?? "none"})`)}`);
      console.log(`AWS config: ${l.aws.config} (${l.aws.source}); GCP login config: ${l.gcp.loginConfig ?? "none found"}; ADC: ${l.gcp.adc.present ? "present" : "none"}`);
      if (l.config.state === "missing") console.log(`note: no config file at ${l.config.path}: every account and project is "env unknown" (gated). Copy config.example.json there and fill it in.`);
      if (l.config.state === "invalid") console.log(`note: the config file ${l.config.path} is invalid, so it was ignored (everything is gated): ${l.config.error}`);
      for (const n of l.notes) console.log(`note: ${n}`);
      if (l.targets.some((t) => t.pim.some((p) => p.inferred))) console.log("? = PIM group the config marks as inferred");
      if (l.targets.some((t) => t.state === "unchecked")) console.log("unchecked = prod profile not asked with sts; cloud ls --check-prod asks");
      return 0;
    }
    case "use": {
      if (!isCloud(cloud) || !name) break;
      const r = await prepareUse(ctx, cloud, name, confirm);
      bb(bbArgs("set", cloud, project), `${name}\n`);
      const rec = readRecord(recPath);
      const previous = (project ? rec.projects[project]?.[cloud] : rec.global[cloud]) ?? null;
      writeRecord(recPath, withChoice(rec, cloud, name, project));
      console.log(`${VARS[cloud]}=${name}${where}${previous && previous !== name ? ` (was ${previous})` : ""}${r.created ? `; created gcloud configuration ${name}` : ""}.`);
      console.log(NOTE);
      return 0;
    }
    case "off": {
      if (!isCloud(cloud) || name) break;
      bb(bbArgs("unset", cloud, project));
      writeRecord(recPath, withChoice(readRecord(recPath), cloud, null, project));
      console.log(`${VARS[cloud]} unset${where}: ${cloud === "aws" ? "aws uses the default chain (this machine's instance role)" : "gcloud uses its own active configuration"}.`);
      console.log(NOTE);
      return 0;
    }
    case "login": {
      if (!isCloud(cloud) || !name) break;
      const plan = await planLogin(ctx, cloud, name, confirm);
      for (const step of plan.steps) {
        console.error(`$ ${step.join(" ")}`);
        const r = spawnSync(step[0], step.slice(1), { stdio: "inherit", env: { ...process.env, ...plan.env } });
        if (r.status !== 0) { console.error(`cloud: ${step.slice(0, 3).join(" ")} failed (${r.error ? redact(String(r.error.message)) : `exit ${r.status}`})`); return 1; }
      }
      return 0;
    }
    case "whoami": {
      const w = await whoami(ctx);
      if (flags.has("--json")) { console.log(JSON.stringify(w, null, 2)); return 0; }
      console.log(`aws: ${w.aws.profile ? `${VARS.aws}=${w.aws.profile}` : `no ${VARS.aws} (default chain)`} -> ${w.aws.identity ?? w.aws.why ?? "?"}`);
      console.log(`gcp: ${w.gcp.config ?? "(none)"} -> ${w.gcp.account ?? "not logged in"}, project ${w.gcp.project ?? "unset"}`);
      return 0;
    }
    case "revoke": {
      if (cloud !== "gcp") break;
      const r = await revokeGcp(ctx, flags.has("--yes"));
      for (const s of r.steps) console.log(`${s.ok ? "ok " : "ERR"} ${s.command}: ${s.message}`);
      return r.steps.every((s) => s.ok) ? 0 : 1;
    }
  }
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e: unknown) => {
  const known = e instanceof GateError || e instanceof TargetError || e instanceof BbError;
  console.error(`cloud: ${redact(e instanceof Error ? e.message : String(e))}`);
  process.exit(known ? 1 : 70);
});
