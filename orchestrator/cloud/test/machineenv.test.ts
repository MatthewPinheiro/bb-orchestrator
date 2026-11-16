// What the switch knows it set. Why it matters: bb masks machine variables, so the page and `cloud ls` only know which
// profile is active from cloud-switch's own record; that must never claim a variable bb no longer has, must say when
// one was set by someone else, and the CLI must always reach the runner's bb, not the one a thread's BB_* points at.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFrom, bbArgs, bbEnv, readRecord, recordPath, withChoice, writeRecord, type Rec } from "../core/machineenv.ts";
import { sandbox } from "./sandbox.ts";

const rec = (aws: string | null, gcp: string | null, projects: Rec["projects"] = {}): Rec => ({ global: { aws, gcp }, projects });
const vars = (...names: string[]) => names.map((name) => ({ name }));

test("active is the record's value only while bb still has the variable; set by someone else shows as set without a value", () => {
  assert.deepEqual(activeFrom(rec("app-prod", "dev"), { variables: vars("AWS_PROFILE", "CLOUDSDK_ACTIVE_CONFIG_NAME") }),
    { aws: { set: true, value: "app-prod" }, gcp: { set: true, value: "dev" } });
  // removed in bb's settings by hand: the record's stale value is not shown as active
  assert.deepEqual(activeFrom(rec("app-prod", "dev"), { variables: vars("OTHER") }),
    { aws: { set: false, value: null }, gcp: { set: false, value: null } });
  // set outside cloud-switch
  assert.deepEqual(activeFrom(rec(null, null), { variables: vars("AWS_PROFILE") }).aws, { set: true, value: null });
});

test("for a project, its own row wins over the machine-wide one it inherits", () => {
  const r = rec("app-prod", "dev", { prj_1: { aws: "app-dev", gcp: null } });
  const list = { variables: vars("AWS_PROFILE"), inheritedVariables: vars("AWS_PROFILE", "CLOUDSDK_ACTIVE_CONFIG_NAME") };
  assert.deepEqual(activeFrom(r, list, "prj_1"), { aws: { set: true, value: "app-dev" }, gcp: { set: true, value: "dev" } });
  assert.deepEqual(activeFrom(r, { variables: [], inheritedVariables: vars("AWS_PROFILE") }, "prj_2").aws, { set: true, value: "app-prod" });
});

test("withChoice changes one cloud in one scope and leaves the rest", () => {
  const r = rec("app-prod", "dev");
  assert.deepEqual(withChoice(r, "aws", null), rec(null, "dev"));
  assert.deepEqual(withChoice(r, "gcp", "prod", "prj_1"), rec("app-prod", "dev", { prj_1: { aws: null, gcp: "prod" } }));
  assert.deepEqual(r, rec("app-prod", "dev"), "pure");
});

test("the record is a private file, written whole, and a missing or broken one reads as nothing set", () => {
  const box = sandbox();
  try {
    const p = recordPath(box.env);
    assert.equal(p, join(box.env.HOME, ".local/state/cloud-switch/machine-env.json"));
    assert.deepEqual(readRecord(p), rec(null, null));
    writeRecord(p, rec("app-dev", null));
    assert.deepEqual(readRecord(p), rec("app-dev", null));
    assert.equal(statSync(p).mode & 0o777, 0o600);
    assert.doesNotMatch(readFileSync(p, "utf8"), /token|secret/i);
  } finally { box.done(); }
});

test("the bb CLI is pointed at the runner's bb, whatever BB_* the calling thread carries", () => {
  const env = bbEnv({ PATH: "/usr/bin", HOME: "/h", BB_SERVER_URL: "http://127.0.0.1:40057", BB_HOST_DAEMON_PORT: "40058", BB_CLI: "/x/bb", BB_THREAD_ID: "thr_1" });
  assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/h", BB_SERVER_URL: "http://127.0.0.1:38886", BB_HOST_DAEMON_PORT: "38887" });
  assert.deepEqual(bbArgs("set", "aws", null), ["machine", "env", "set", "AWS_PROFILE", "--note", "set by cloud-switch", "--json"]);
  assert.deepEqual(bbArgs("unset", "gcp", "prj_1"), ["machine", "env", "unset", "CLOUDSDK_ACTIVE_CONFIG_NAME", "--project", "prj_1", "--json"]);
});
