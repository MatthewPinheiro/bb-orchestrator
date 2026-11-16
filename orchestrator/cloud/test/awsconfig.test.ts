// The AWS config is only read. Why it matters: on a cloud machine, aws calls without a profile resolve to its instance
// role through the default chain (the machine's own tooling relies on that), so the switch must never add a [default]; it picks a
// profile with AWS_PROFILE instead, and unsetting that is the way back to the instance role.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { profiles } from "../core/awsconfig.ts";
import { AWS_CONFIG, sandbox } from "./sandbox.ts";

test("lists the four profiles and never the sso-session", () => {
  const ps = profiles(AWS_CONFIG);
  assert.deepEqual(ps.map((p) => p.name), ["Engineers-111111111111", "app-dev", "reports-prod", "app-prod"]);
  assert.equal(ps[3].keys.sso_role_name, "Engineers-Prod");
  assert.equal(ps[2].keys.sso_account_id, "222222222222");
});

// The real AWS CLI, config-only (no network, no credentials).
const realAws = ["/usr/bin/aws", "/usr/local/bin/aws"].find((p) => existsSync(p));
test("the real aws CLI picks the profile AWS_PROFILE names, and without it finds no profile in the config (the instance role applies)", { skip: !realAws && "no aws CLI" }, () => {
  const box = sandbox();
  try {
    const base = { PATH: "/usr/bin:/bin", HOME: box.env.HOME, AWS_CONFIG_FILE: box.awsConfig, AWS_SHARED_CREDENTIALS_FILE: box.env.AWS_SHARED_CREDENTIALS_FILE };
    const get = (env: Record<string, string>) => spawnSync(realAws!, ["configure", "get", "sso_role_name"], { env: { ...base, ...env }, encoding: "utf8" });
    assert.equal(get({ AWS_PROFILE: "app-prod" }).stdout.trim(), "Engineers-Prod");
    assert.equal(get({ AWS_PROFILE: "app-dev" }).stdout.trim(), "Engineers");
    const none = get({});
    assert.equal(none.stdout.trim(), "", "no [default] in the config");
    assert.notEqual(none.status, 0);
  } finally { box.done(); }
});
