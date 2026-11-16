// The config file. Why it matters: it is the only thing that says an account or project is dev, and only dev skips the
// prod confirm. So a missing or broken file must fail closed (everything gated, no PIM shown), a typo must be an error
// rather than a silent default, and the shipped example must stay valid.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GateError, list, makeCtx, prepareUse } from "../core/cloud.ts";
import { configPath, configSchema, loadConfig } from "../core/config.ts";
import { awsEnv, awsPim, gcpDefs, gcpEnv } from "../core/pim.ts";
import { PKG, sandbox } from "./sandbox.ts";

const OFF = { aws: null, gcp: null };

test("config.example.json is valid and its placeholders map to dev and prod", () => {
  const cfg = configSchema.parse(JSON.parse(readFileSync(join(PKG, "config.example.json"), "utf8")));
  assert.deepEqual([awsEnv(cfg, "111111111111"), awsEnv(cfg, "222222222222"), awsEnv(cfg, "333333333333")], ["dev", "prod", "unknown"]);
  assert.deepEqual([gcpEnv(cfg, "acme-dev"), gcpEnv(cfg, "acme-prod"), gcpEnv(cfg, "other")], ["dev", "prod", "unknown"]);
  assert.deepEqual(gcpDefs(cfg), [{ name: "dev", project: "acme-dev" }, { name: "prod", project: "acme-prod" }]);
  assert.equal(awsPim(cfg, "111111111111", "Engineers")[0].group, "Example PIM group");
  // defaults fill what the example leaves out
  assert.deepEqual(awsPim(cfg, "111111111111", "Engineers")[0], { group: "Example PIM group", assignment: "active", approval: false, maxDuration: null, permissions: "Dev services" });
  assert.deepEqual(awsPim(cfg, "111111111111", "constructor"), [], "a role name is never looked up on the prototype");
});

test("the config path is the setting, else CLOUD_SWITCH_CONFIG, else ~/.config/bb-cloud-switch/config.json, with ~ from the given env", () => {
  const env = { HOME: "/h", USER: "u", CLOUD_SWITCH_CONFIG: "/e/config.json" };
  assert.equal(configPath(env, "~/s.json"), "/h/s.json");
  assert.equal(configPath(env, null), "/e/config.json");
  assert.equal(configPath({ HOME: "/h", USER: "u" }), "/h/.config/bb-cloud-switch/config.json");
  assert.equal(loadConfig({ HOME: "/h" }, "relative.json").info.state, "invalid");
});

test("with no config file everything is env unknown and gated, with no PIM, and the listing says the file is missing", async () => {
  const box = sandbox();
  try {
    rmSync(box.configFile);
    const ctx = makeCtx(box.env);
    const l = await list(ctx, OFF);
    assert.deepEqual(l.config, { path: box.configFile, state: "missing", error: null });
    assert.deepEqual(l.links, []);
    assert.ok(l.targets.length > 0);
    for (const t of l.targets) assert.deepEqual([t.env, t.gated, t.pim], ["unknown", true, []], `${t.cloud}:${t.name}`);
    // the same profile that is dev with the config needs a confirm without it
    await assert.rejects(prepareUse(ctx, "aws", "app-dev"), GateError);
    // no configurations are defined; only gcloud's own show
    assert.deepEqual(l.targets.filter((t) => t.cloud === "gcp").map((t) => t.name), ["default"]);
  } finally { box.done(); }
});

test("an invalid config is ignored (everything gated) and the error names what is wrong", async () => {
  const box = sandbox();
  try {
    for (const [text, why] of [
      [JSON.stringify({ aws: { accounts: [{ id: "1234", env: "dev" }] } }), /12 digits/],
      [JSON.stringify({ aws: { acounts: [] } }), /acounts/],
      [JSON.stringify({ gcp: { projects: [{ id: "acme-dev", env: "staging" }] } }), /env/],
      ["{ not json", /not JSON/],
    ] as const) {
      writeFileSync(box.configFile, text);
      const l = await list(makeCtx(box.env), OFF);
      assert.equal(l.config.state, "invalid", text);
      assert.match(l.config.error!, why);
      assert.ok(l.targets.every((t) => t.gated && t.env === "unknown"), text);
    }
  } finally { box.done(); }
});

test("env, PIM groups and the defined configurations follow the config file, not the code", async () => {
  const box = sandbox();
  try {
    // swap which account is dev: the profiles follow
    const cfg = JSON.parse(readFileSync(box.configFile, "utf8"));
    cfg.aws.accounts[0].env = "prod";
    cfg.aws.accounts[1].env = "dev";
    cfg.gcp.projects = [{ id: "acme-sandbox", env: "dev", configuration: "sandbox" }];
    writeFileSync(box.configFile, JSON.stringify(cfg));
    const l = await list(makeCtx(box.env), OFF);
    const t = Object.fromEntries(l.targets.map((x) => [`${x.cloud}:${x.name}`, x]));
    assert.deepEqual([t["aws:app-dev"].env, t["aws:app-prod"].env], ["prod", "dev"]);
    assert.deepEqual(Object.keys(t).filter((k) => k.startsWith("gcp:")), ["gcp:sandbox", "gcp:default"]);
    assert.deepEqual([t["gcp:sandbox"].project, t["gcp:sandbox"].env], ["acme-sandbox", "dev"]);
  } finally { box.done(); }
});
