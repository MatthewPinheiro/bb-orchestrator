// The page's swap: server.ts with the real host entry (host.ts) on a made-up machine, and a stand-in for bb's SDK. Why it
// matters: Use must change exactly one machine variable through the per-row SDK call (a whole-table replace could drop
// the user's other variables), only after the host's prod gate, and never write the AWS config; Off must delete it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerCloud } from "../server.ts";
import hostEntry from "../host.ts";
import { sandbox } from "./sandbox.ts";

test("Use sets one machine variable (prod only with its name), Off deletes it, and the AWS config is never written", async () => {
  const box = sandbox();
  Object.assign(process.env, box.env); // the host entry and the server's record read this process's env
  try {
    const sdk: [string, unknown][] = [];
    const vars = new Map<string, string>([["GITHUB_TOKEN", "someone-elses"]]);
    const table = () => ({ variables: [...vars.keys()].map((name) => ({ name, value: null, secret: true as const, note: null })), builtInGit: { status: "disabled" as const, statusMessage: "" } });
    const page: Record<string, (input: any) => Promise<any>> = {};
    const bb = {
      // the default setting: "~/" is the machine's HOME (the sandbox's), where sandbox() put the config
      hosts: { experimental_client: () => ({ call: (m: string, input: unknown) => (hostEntry.handlers as any)[m](input, {}) }) },
      sdk: {
        hosts: { list: async () => [{ id: "h1", name: "runner", type: "persistent", lifecycle: { phase: "active" }, status: "connected" }] },
        system: {
          machineEnvironment: async () => table(),
          setMachineEnvironmentVariable: async (a: { name: string; value: string }) => { sdk.push(["set", a]); vars.set(a.name, a.value); return table(); },
          deleteMachineEnvironmentVariable: async (a: { name: string }) => { sdk.push(["delete", a]); vars.delete(a.name); return table(); },
          replaceMachineEnvironment: async (a: unknown) => { sdk.push(["replace", a]); throw new Error("whole-table replace"); },
        },
      },
      rpc: { register: (_c: unknown, h: typeof page) => Object.assign(page, h) },
      log: { info() {}, warn() {}, error() {}, debug() {} },
    };
    registerCloud(bb as never, () => ({ gcpLoginConfig: "", cloudConfigPath: "~/.config/bb-cloud-switch/config.json" }));
    const config = readFileSync(box.awsConfig);
    // the Cloud tab shows CloudView only on a machine with a cloud config; without one it names the path it looked for
    assert.deepEqual(await page["cs.available"](null), { available: true, state: "ok", path: box.configFile });
    const none: typeof page = {};
    registerCloud({ ...bb, rpc: { register: (_c: unknown, h: typeof page) => Object.assign(none, h) } } as never, () => ({ gcpLoginConfig: "", cloudConfigPath: "~/no-such-cloud-config.json" }));
    assert.deepEqual(await none["cs.available"](null), { available: false, state: "missing", path: join(box.env.HOME!, "no-such-cloud-config.json") }, "no config file: the tab says where to put one");

    const v0 = await page["cs.view"]({ hostId: null });
    assert.equal(v0.error, null);
    assert.deepEqual([v0.listing.aws.active, v0.listing.gcp.active, v0.listing.gcp.gcloudActive], [null, null, "default"]);
    assert.match(v0.note, /^Applies to new threads, terminals and commands; running agent sessions keep theirs until restarted/);
    assert.deepEqual(v0.vars, { aws: "AWS_PROFILE", gcp: "CLOUDSDK_ACTIVE_CONFIG_NAME" });
    assert.deepEqual(v0.listing.config, { path: box.configFile, state: "ok", error: null });
    assert.deepEqual(v0.listing.links, [{ label: "Example PIM", url: "https://pim.example.com/activate" }]);

    // prod: refused by the host before the server touches bb
    await assert.rejects(page["cs.use"]({ hostId: "h1", cloud: "aws", name: "app-prod" }), (e: Error & { code?: string }) => /confirm it/.test(e.message) && e.code === "forbidden");
    await assert.rejects(page["cs.use"]({ hostId: "h1", cloud: "aws", name: "app-prod", confirm: "app-dev" }), /confirm it/);
    assert.equal(sdk.length, 0, "nothing reached bb");

    assert.deepEqual(await page["cs.use"]({ hostId: "h1", cloud: "aws", name: "app-prod", confirm: "app-prod" }),
      { variable: "AWS_PROFILE", previous: null, active: "app-prod", created: false });
    assert.deepEqual(sdk, [["set", { name: "AWS_PROFILE", value: "app-prod", note: "set by cloud-switch" }]]);
    assert.equal((await page["cs.use"]({ hostId: "h1", cloud: "gcp", name: "dev" })).created, true);
    assert.deepEqual(sdk.at(-1), ["set", { name: "CLOUDSDK_ACTIVE_CONFIG_NAME", value: "dev", note: "set by cloud-switch" }]);
    assert.equal(readFileSync(join(box.gcloudDir, "active_config"), "utf8"), "default", "gcloud's own active configuration untouched");

    const v1 = await page["cs.view"]({ hostId: "h1" });
    assert.deepEqual(v1.listing.targets.filter((t: any) => t.active).map((t: any) => `${t.cloud}:${t.name}`), ["aws:app-prod", "gcp:dev"]);
    assert.equal((await page["cs.use"]({ hostId: "h1", cloud: "aws", name: "app-dev" })).previous, "app-prod");

    assert.deepEqual(await page["cs.off"]({ cloud: "aws" }), { variable: "AWS_PROFILE", previous: "app-dev" });
    assert.deepEqual(sdk.at(-1), ["delete", { name: "AWS_PROFILE" }]);
    assert.equal((await page["cs.view"]({ hostId: "h1" })).listing.aws.active, null);

    // set by someone else: shown as such, not as the record's old value
    vars.set("AWS_PROFILE", "by-hand");
    const v2 = await page["cs.view"]({ hostId: "h1" });
    assert.equal(v2.listing.aws.active, null);
    assert.deepEqual(v2.outside, { aws: true, gcp: false }, "shown as set, not as off");
    assert.match(v2.listing.notes.join("\n"), /AWS_PROFILE is set in bb outside cloud-switch/);
    await page["cs.off"]({ cloud: "aws" });
    assert.deepEqual((await page["cs.view"]({ hostId: "h1" })).outside, { aws: false, gcp: false }, "Off removes it");

    assert.ok(!sdk.some(([op]) => op === "replace"), "never a whole-table replace");
    assert.equal(vars.get("GITHUB_TOKEN"), "someone-elses", "other variables untouched");
    assert.deepEqual(readFileSync(box.awsConfig), config, "AWS config byte-identical");
  } finally { box.done(); }
});
