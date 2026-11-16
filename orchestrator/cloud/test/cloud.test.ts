// The core against the fake aws, gcloud and bb on a made-up machine: the target list, the prod gate, the swap's checks,
// the login commands, and the CLI. Why each matters is in its test name.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GateError, awsPaths, checkAws, findLoginConfig, list, makeCtx, parseDeviceCode, planLogin, prepareUse, revokeGcp, terminalArgv } from "../core/cloud.ts";
import { NOTE } from "../core/machineenv.ts";
import { PKG, sandbox } from "./sandbox.ts";

const calls = (log: string) => (existsSync(log) ? readFileSync(log, "utf8") : "");
const OFF = { aws: null, gcp: null };

test("the list shows every AWS profile and both GCP targets with env, login, identity, active and PIM gate", async () => {
  const box = sandbox();
  try {
    const l = await list(makeCtx(box.env), OFF, "all");
    const t = Object.fromEntries(l.targets.map((x) => [`${x.cloud}:${x.name}`, x]));
    assert.deepEqual(Object.keys(t), ["aws:Engineers-111111111111", "aws:app-dev", "aws:reports-prod", "aws:app-prod", "gcp:dev", "gcp:prod", "gcp:default"]);
    assert.equal(t["aws:app-dev"].env, "dev");
    assert.equal(t["aws:app-dev"].state, "in");
    assert.match(t["aws:app-dev"].identity!, /assumed-role\/AWSReservedSSO_Engineers_/);
    // env and PIM groups come from the config file, keyed by account id and role
    assert.deepEqual(t["aws:app-dev"].pim.map((p) => [p.group, p.assignment]), [["Example Dev Engineers", "active"]]);
    assert.equal(t["aws:app-prod"].env, "prod");
    assert.equal(t["aws:app-prod"].gated, true);
    assert.equal(t["aws:app-prod"].state, "out");
    assert.equal(t["aws:app-prod"].why, "SSO token expired: log in");
    assert.deepEqual(t["aws:app-prod"].pim.map((p) => [p.group, p.approval, p.maxDuration, p.inferred]), [["Example Prod Engineers", true, "2 hours", true]]);
    // a 403 after a good SSO login is the PIM gate, not a logout: say which group to activate
    assert.equal(t["aws:reports-prod"].state, "unknown");
    assert.match(t["aws:reports-prod"].why!, /activate Example Prod Reports in PIM/);
    assert.equal(t["gcp:dev"].project, "acme-dev");
    assert.equal(t["gcp:dev"].created, false);
    assert.deepEqual(t["gcp:prod"].pim.map((p) => [p.group, p.approval]), [["Example GCP Prod Viewers", true], ["Example GCP Prod Editors", true]]);
    assert.equal(t["gcp:default"].env, "unknown");
    assert.equal(t["gcp:default"].gated, true, "a configuration with no known project is gated like prod");
    assert.equal(l.aws.active, null);
    assert.equal(l.gcp.active, null);
    assert.equal(l.gcp.gcloudActive, "default", "with the switch off, gcloud's own active configuration applies");
    assert.ok(l.targets.every((x) => !x.active), "nothing is marked active while the switch is off");
    assert.equal(l.gcp.loginConfig, box.loginConfig);
    assert.match(calls(box.log), new RegExp(`AWS_CONFIG_FILE=${box.awsConfig}`), "aws ran against the sandbox config");
  } finally { box.done(); }
});

// sts on an SSO profile fetches that role's credentials; for prod that must be a person's ask (Check, --check-prod),
// never a page view or `cloud ls` on its own.
const stsFor = (log: string, profile: string) => calls(log).split("\n").filter((l) => l.includes('"get-caller-identity"') && l.includes(`"--profile=${profile}"`)).length;

test("a plain list never runs sts for a prod profile; --check-prod and a row's Check do", async () => {
  const box = sandbox();
  try {
    const ctx = makeCtx(box.env);
    const plain = await list(ctx, OFF);
    for (const p of ["app-prod", "reports-prod"]) {
      assert.equal(stsFor(box.log, p), 0, `plain list ran sts for ${p}`);
      const t = plain.targets.find((x) => x.cloud === "aws" && x.name === p)!;
      assert.deepEqual([t.state, t.why, t.identity], ["unchecked", "prod: check on demand", null]);
    }
    assert.equal(stsFor(box.log, "app-dev"), 1, "dev profiles keep their automatic check");
    assert.equal(plain.targets.find((x) => x.name === "app-dev")!.state, "in");
    // the page's Check: that one profile, nothing else
    const one = await checkAws(ctx, "app-prod");
    assert.deepEqual([one.state, one.why], ["out", "SSO token expired: log in"]);
    assert.equal(stsFor(box.log, "app-prod"), 1);
    assert.equal(stsFor(box.log, "reports-prod"), 0, "Check on app-prod didn't touch reports-prod");
    // cloud ls --check-prod
    await list(ctx, OFF, "all");
    assert.equal(stsFor(box.log, "reports-prod"), 1);
  } finally { box.done(); }
});

test("the list marks what the switch set as active, and says when AWS_PROFILE names a profile the config doesn't have", async () => {
  const box = sandbox();
  try {
    const ctx = makeCtx(box.env);
    const l = await list(ctx, { aws: "app-dev", gcp: "dev" });
    assert.deepEqual(l.targets.filter((t) => t.active).map((t) => `${t.cloud}:${t.name}`), ["aws:app-dev", "gcp:dev"]);
    assert.deepEqual([l.aws.active, l.gcp.active], ["app-dev", "dev"]);
    assert.match((await list(ctx, { aws: "gone", gcp: null })).notes.join("\n"), /AWS_PROFILE is set to gone, which is not in the AWS config/);
  } finally { box.done(); }
});

test("prod is never one click: use and login refuse without the confirm, before anything is created", async () => {
  const box = sandbox();
  try {
    const ctx = makeCtx(box.env);
    await assert.rejects(prepareUse(ctx, "aws", "app-prod"), GateError);
    await assert.rejects(prepareUse(ctx, "aws", "app-prod", "app-dev"), GateError, "another target's name is not a confirm");
    await assert.rejects(planLogin(ctx, "aws", "reports-prod"), GateError);
    await assert.rejects(prepareUse(ctx, "gcp", "prod"), GateError);
    await assert.rejects(planLogin(ctx, "gcp", "prod"), GateError);
    assert.doesNotMatch(calls(box.log), /configurations","create"/, "a refused gcp use created nothing");
    // with the confirm (the page names the target; the CLI's --yes-prod is `true`); dev needs none
    assert.deepEqual(await prepareUse(ctx, "aws", "app-prod", "app-prod"), { name: "app-prod", created: false });
    assert.deepEqual(await prepareUse(ctx, "aws", "app-dev"), { name: "app-dev", created: false });
    assert.equal((await prepareUse(ctx, "gcp", "prod", true)).created, true);
    await assert.rejects(prepareUse(ctx, "aws", "nope"), /no AWS profile nope/);
  } finally { box.done(); }
});

test("gcp use creates the defined configuration with its project and login config, and never activates it", async () => {
  const box = sandbox();
  try {
    const ctx = makeCtx(box.env);
    assert.deepEqual(await prepareUse(ctx, "gcp", "dev"), { name: "dev", created: true });
    const cfg = readFileSync(join(box.gcloudDir, "configurations/config_dev"), "utf8");
    assert.match(cfg, /project = acme-dev/);
    assert.match(cfg, new RegExp(`login_config_file = ${box.loginConfig}`));
    // CLOUDSDK_ACTIVE_CONFIG_NAME picks it; gcloud's own active configuration stays as it was
    assert.equal(readFileSync(join(box.gcloudDir, "active_config"), "utf8"), "default");
    assert.doesNotMatch(calls(box.log), /"activate"/);
    assert.match(calls(box.log), /"create","dev","--no-activate"/);
    assert.equal((await list(ctx, OFF)).gcp.gcloudActive, "default");
    assert.equal((await prepareUse(ctx, "gcp", "dev")).created, false, "a second use doesn't recreate it");
  } finally { box.done(); }
});

test("the gcp login runs its three steps in order, with the login config, on that configuration only", async () => {
  const box = sandbox();
  try {
    const ctx = makeCtx(box.env);
    const plan = await planLogin(ctx, "gcp", "dev");
    assert.deepEqual(plan.steps, [
      ["gcloud", "auth", "login", `--login-config=${box.loginConfig}`, "--no-launch-browser", "--configuration=dev"],
      ["gcloud", "config", "set", "project", "acme-dev", "--configuration=dev"],
      ["gcloud", "auth", "application-default", "login", `--login-config=${box.loginConfig}`, "--no-launch-browser", "--configuration=dev"],
    ]);
    // the terminal's one argv, run for real against the fakes, with the two pasted codes on stdin
    const argv = terminalArgv(plan);
    const r = spawnSync(argv[0], argv.slice(1), { env: box.env, input: "code-1\ncode-2\n", encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const l = await list(ctx, OFF);
    const dev = l.targets.find((t) => t.cloud === "gcp" && t.name === "dev")!;
    assert.equal(dev.state, "in");
    assert.equal(dev.identity, "user@example.com", "a workforce principal shows as its subject");
    assert.equal(l.gcp.gcloudActive, "default", "logging in doesn't switch gcloud's active configuration");
    assert.equal(l.gcp.adc.present, true);
  } finally { box.done(); }
});

test("the aws login is the device-code flow against the resolved config, and its URL and code are read back", async () => {
  const box = sandbox();
  try {
    const plan = await planLogin(makeCtx(box.env), "aws", "app-dev");
    assert.deepEqual(terminalArgv(plan), ["env", `AWS_CONFIG_FILE=${box.awsConfig}`, "PYTHONUNBUFFERED=1", "CLOUDSDK_CONFIG=" + box.gcloudDir, "aws", "sso", "login", "--profile=app-dev", "--use-device-code", "--no-browser"]);
    // exactly what awscli's PrintOnlyHandler prints (awscli/customizations/sso/utils.py), as a terminal shows it
    const printed = "Browser will not be automatically opened.\r\nPlease visit the following URL:\r\n\r\nhttps://device.sso.us-east-1.amazonaws.com/\r\n\r\nThen enter the code:\r\n\r\n\x1b[1mFAKE-CODE\x1b[0m\r\n\r\nAlternatively, you may visit the following URL which will autofill the code upon loading:\r\nhttps://device.sso.us-east-1.amazonaws.com/?user_code=FAKE-CODE\r\n";
    assert.deepEqual(parseDeviceCode(printed), { url: "https://device.sso.us-east-1.amazonaws.com/", code: "FAKE-CODE", completeUrl: "https://device.sso.us-east-1.amazonaws.com/?user_code=FAKE-CODE" });
    assert.equal(parseDeviceCode("Please visit the following URL:\n\nhttps://device.sso.us-east-1.amazonaws.com/\n"), null, "no code yet");
  } finally { box.done(); }
});

test("revoke needs a confirm, signs gcloud and ADC out, and is quiet when there is nothing left", async () => {
  const box = sandbox();
  try {
    const ctx = makeCtx(box.env);
    await assert.rejects(revokeGcp(ctx, false), GateError);
    const argv = terminalArgv(await planLogin(ctx, "gcp", "dev"));
    spawnSync(argv[0], argv.slice(1), { env: box.env, input: "a\nb\n" });
    assert.deepEqual((await revokeGcp(ctx, true)).steps.map((s) => [s.ok, s.message]), [[true, "revoked"], [true, "revoked"]]);
    assert.deepEqual((await revokeGcp(ctx, true)).steps.map((s) => [s.ok, s.message]), [[true, "nothing to revoke"], [true, "nothing to revoke"]]);
    assert.equal((await list(ctx, OFF)).gcp.adc.present, false);
  } finally { box.done(); }
});

test("the AWS config is found where the machine's processes look: AWS_CONFIG_FILE, else the config file's paths, else ~/.aws", () => {
  const extra = ["/opt/creds/{user}/aws/config", "~/alt/aws-config"];
  assert.deepEqual(awsPaths({ AWS_CONFIG_FILE: "/x/config", HOME: "/h", USER: "u" }, extra, () => true), { config: "/x/config", source: "env" });
  // {user} and ~/ expand from the environment; the first that exists wins
  assert.deepEqual(awsPaths({ HOME: "/h", USER: "u" }, extra, () => true), { config: "/opt/creds/u/aws/config", source: "config" });
  assert.deepEqual(awsPaths({ HOME: "/h", USER: "u" }, extra, (p) => p === "/h/alt/aws-config"), { config: "/h/alt/aws-config", source: "config" });
  assert.deepEqual(awsPaths({ HOME: "/h", USER: "u" }, extra, () => false), { config: "/h/.aws/config", source: "home" });
  assert.deepEqual(awsPaths({ HOME: "/h", USER: "u" }, [], () => true), { config: "/h/.aws/config", source: "home" });
  // the GCP login config: the setting, then the env var, then the config file's, then the default place
  const has = (p: string) => ["/set.json", "/env.json", "/h/cfg/login.json", "/h/.config/cloud-switch/gcp-login-config.json"].includes(p);
  assert.equal(findLoginConfig({ HOME: "/h", CLOUD_SWITCH_GCP_LOGIN_CONFIG: "/env.json" }, "/set.json", "~/cfg/login.json", has), "/set.json");
  assert.equal(findLoginConfig({ HOME: "/h", CLOUD_SWITCH_GCP_LOGIN_CONFIG: "/env.json" }, null, "~/cfg/login.json", has), "/env.json");
  assert.equal(findLoginConfig({ HOME: "/h" }, "relative.json", "~/cfg/login.json", has), "/h/cfg/login.json");
  assert.equal(findLoginConfig({ HOME: "/h" }, null, "~/missing.json", has), "/h/.config/cloud-switch/gcp-login-config.json");
  assert.equal(findLoginConfig({ HOME: "/h" }, null, null, () => false), null);
});

// The CLI's swap is `bb machine env set|unset` on the runner's bb. A line of the fake bb's log, parsed.
type BbCall = { args: string[]; stdin: string; url: string; port: string };
const bbCalls = (log: string): BbCall[] => calls(log).split("\n").flatMap((l) => {
  const m = /^fake-bb (\[.*?\]) stdin=(".*") BB_SERVER_URL=(\S*) BB_HOST_DAEMON_PORT=(\S*)$/.exec(l);
  return m ? [{ args: JSON.parse(m[1]), stdin: JSON.parse(m[2]), url: m[3], port: m[4] }] : [];
});
const RUNNER = { url: "http://127.0.0.1:38886", port: "38887" };

test("the cloud CLI swaps with one bb machine variable on the runner's bb: value on stdin, prod gated, AWS config untouched", () => {
  const box = sandbox();
  try {
    // inside a thread a bare bb points at another bb: the CLI must name the runner's
    const env = { ...box.env, BB_SERVER_URL: "http://127.0.0.1:40057", BB_HOST_DAEMON_PORT: "40058", BB_THREAD_ID: "thr_elsewhere" };
    const cloud = (args: string[], extra: Record<string, string> = {}) => spawnSync(join(PKG, "bin/cloud"), args, { env: { ...env, ...extra }, encoding: "utf8" });
    const changes = () => bbCalls(box.log).filter((c) => c.args[2] !== "list");
    const config = readFileSync(box.awsConfig), mtime = statSync(box.awsConfig).mtimeMs;

    const ls = cloud(["ls"]);
    assert.equal(ls.status, 0, ls.stderr);
    assert.match(ls.stdout, /aws\s+app-prod\s+PROD\s+unchecked\s+prod: check on demand/);
    assert.doesNotMatch(calls(box.log), /"--profile=app-prod"/, "plain cloud ls ran no sts for prod");
    assert.match(ls.stdout, /AWS_PROFILE: unset \(aws uses the default chain: this machine's instance role\)/);
    assert.match(ls.stdout, /CLOUDSDK_ACTIVE_CONFIG_NAME: unset \(gcloud uses its own active configuration: default\)/);
    assert.match(ls.stdout, /gcp\s+dev\s+dev\s+out\s+not created yet/);
    assert.deepEqual(bbCalls(box.log).map((c) => [c.args, c.url, c.port]), [[["machine", "env", "list", "--json"], RUNNER.url, RUNNER.port]]);
    assert.match(cloud(["ls", "--check-prod"]).stdout, /aws\s+app-prod\s+PROD\s+out\s+SSO token expired/);
    assert.equal(JSON.parse(cloud(["ls", "--json"]).stdout).targets.length, 7);

    // prod: refused before bb is asked to change anything
    const refused = cloud(["use", "aws", "app-prod"]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /PROD: confirm it \(CLI: --yes-prod\)/);
    assert.deepEqual(changes(), []);

    // one row, the value on stdin (never an argument), on the runner's bb
    const prod = cloud(["use", "aws", "app-prod", "--yes-prod"]);
    assert.equal(prod.status, 0, prod.stderr);
    assert.match(prod.stdout, /^AWS_PROFILE=app-prod\.$/m);
    assert.ok(prod.stdout.includes(NOTE), "says what the swap reaches and what it doesn't");
    assert.deepEqual(changes(), [{ args: ["machine", "env", "set", "AWS_PROFILE", "--note", "set by cloud-switch", "--json"], stdin: "app-prod\n", ...RUNNER }]);

    // gcp: the defined configuration is created, never activated; the variable picks it
    const dev = cloud(["use", "gcp", "dev"]);
    assert.equal(dev.status, 0, dev.stderr);
    assert.match(dev.stdout, /^CLOUDSDK_ACTIVE_CONFIG_NAME=dev; created gcloud configuration dev\.$/m);
    assert.deepEqual(changes().at(-1), { args: ["machine", "env", "set", "CLOUDSDK_ACTIVE_CONFIG_NAME", "--note", "set by cloud-switch", "--json"], stdin: "dev\n", ...RUNNER });
    assert.doesNotMatch(calls(box.log), /"activate"/);
    assert.equal(readFileSync(join(box.gcloudDir, "active_config"), "utf8"), "default");

    // bb masks values: ls shows what the switch set, from its record
    const now = cloud(["ls"]).stdout;
    assert.match(now, /aws\s+app-prod\s+PROD\s+\*/);
    assert.match(now, /gcp\s+dev\s+dev\s+\*/);
    assert.match(now, /^AWS_PROFILE: app-prod$/m);
    assert.match(now, /^CLOUDSDK_ACTIVE_CONFIG_NAME: dev$/m);

    // a per-project override, shown with what the project inherits
    const proj = cloud(["use", "aws", "app-dev", "--project", "prj_1"]);
    assert.equal(proj.status, 0, proj.stderr);
    assert.match(proj.stdout, /^AWS_PROFILE=app-dev for project prj_1\.$/m);
    assert.deepEqual(changes().at(-1)!.args, ["machine", "env", "set", "AWS_PROFILE", "--project", "prj_1", "--note", "set by cloud-switch", "--json"]);
    const pls = cloud(["ls", "--project=prj_1"]).stdout;
    assert.match(pls, /^AWS_PROFILE for project prj_1: app-dev$/m);
    assert.match(pls, /^CLOUDSDK_ACTIVE_CONFIG_NAME for project prj_1: dev$/m, "inherited from the machine-wide row");

    // off: unset, back to the instance role
    const off = cloud(["off", "aws"]);
    assert.equal(off.status, 0, off.stderr);
    assert.match(off.stdout, /AWS_PROFILE unset: aws uses the default chain \(this machine's instance role\)/);
    assert.deepEqual(changes().at(-1), { args: ["machine", "env", "unset", "AWS_PROFILE", "--json"], stdin: "", ...RUNNER });
    assert.match(cloud(["ls"]).stdout, /^AWS_PROFILE: unset/m);

    // set by hand in bb (or the record lost): shown as set with a hidden value, never as off and the instance role
    const st = JSON.parse(readFileSync(box.env.CLOUD_SWITCH_FAKE_STATE, "utf8"));
    st.bb.global.AWS_PROFILE = "by-hand";
    writeFileSync(box.env.CLOUD_SWITCH_FAKE_STATE, JSON.stringify(st));
    const hidden = cloud(["ls"]).stdout;
    assert.match(hidden, /^AWS_PROFILE: set outside cloud-switch \(bb hides its value/m);
    assert.doesNotMatch(hidden, /instance role/);
    assert.equal(cloud(["off", "aws"]).status, 0);
    assert.match(cloud(["ls"]).stdout, /^AWS_PROFILE: unset/m);

    // bb unreachable: the CLI fails, and its record doesn't claim a swap that didn't happen
    const down = cloud(["use", "aws", "app-dev"], { CLOUD_SWITCH_FAKE_BB_FAIL: "1" });
    assert.equal(down.status, 1);
    assert.match(down.stderr, /bb machine env set failed: Error: could not reach the bb server/);
    assert.equal(JSON.parse(readFileSync(join(box.env.HOME, ".local/state/cloud-switch/machine-env.json"), "utf8")).global.aws, null);

    // the AWS config: never written
    assert.deepEqual(readFileSync(box.awsConfig), config);
    assert.equal(statSync(box.awsConfig).mtimeMs, mtime);

    // whoami: what a new command (which carries the variables) resolves to
    const who = cloud(["whoami"], { AWS_PROFILE: "app-dev", CLOUDSDK_ACTIVE_CONFIG_NAME: "dev" });
    assert.match(who.stdout, /^aws: AWS_PROFILE=app-dev -> arn:aws:sts::111111111111:assumed-role\//m);
    assert.match(who.stdout, /^gcp: dev -> not logged in, project acme-dev$/m);
    assert.match(cloud(["whoami"]).stdout, /^aws: no AWS_PROFILE \(default chain\) -> no credentials/m);

    assert.match(cloud(["--help"]).stdout, /^Example PIM: https:\/\/pim\.example\.com\/activate$/m, "--help lists the config's links");
    assert.equal(cloud(["revoke", "gcp"]).status, 1, "revoke without --yes refuses");
    assert.equal(cloud(["bogus"]).status, 2);
    assert.equal(cloud(["off", "aws", "--project"]).status, 2, "--project needs an id");
  } finally { box.done(); }
});
