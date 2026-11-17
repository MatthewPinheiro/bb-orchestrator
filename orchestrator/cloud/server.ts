// Cloud Switch, the server part: the Cloud tab's RPC, registered by the orchestrator's server (it was its own plugin
// until 2026-11-13). The page's RPC. Reads and logins run on the machine the page names, through the
// plugin's host entry (host.ts), so that machine's own aws, gcloud, AWS config and cloud-switch config file are the ones read. The swap is one bb
// machine variable (AWS_PROFILE or CLOUDSDK_ACTIVE_CONFIG_NAME), set or deleted here one row at a time, never by
// replacing the table; the AWS config is never written. bb masks the values, so what the switch set is kept in a small
// record file (core/machineenv.ts), the same one the `cloud` CLI keeps. Logins open in a bb terminal on that machine;
// for AWS the server reads the device-code URL and code back from it. The prod gate is enforced on the host
// (core/cloud.ts checkGate) before the variable is set, never only in the page.
import { experimental_PluginRpcRefusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import { pageContract } from "./contract.ts";
import { hostContract } from "./host-contract.ts";
import { parseDeviceCode } from "./core/cloud.ts";
import { BB_NOTE, NOTE, VARS, activeFrom, readRecord, recordPath, withChoice, writeRecord } from "./core/machineenv.ts";
import { redact } from "./core/mask.ts";

const READ_CODE_MS = 15_000;

export type CloudSettings = { gcpLoginConfig: string; cloudConfigPath: string };

/** The Cloud tab's RPC. `settings` is read on every call, so a changed setting applies without a reload. */
export function registerCloud(bb: BbPluginApi, settings: () => CloudSettings) {
  const opts = () => {
    const s = settings();
    return { loginConfig: s.gcpLoginConfig.startsWith("/") ? s.gcpLoginConfig : null, configPath: s.cloudConfigPath.trim() || null };
  };
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const recPath = recordPath(process.env);

  const hosts = async () =>
    (await bb.sdk.hosts.list()).filter((h) => h.type === "persistent" && h.lifecycle.phase === "active" && h.status === "connected").map((h) => ({ id: h.id, name: h.name }));
  const refuse = (e: unknown): never => {
    const message = redact(e instanceof Error ? e.message : String(e));
    bb.log.warn(`cloud-switch: refused: ${message}`);
    throw new experimental_PluginRpcRefusal({ code: /confirm it/.test(message) ? "forbidden" : "conflict", message });
  };
  const call = async <T>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return refuse(e); } };
  /** Which of the two variables bb has, and what the record says the switch set them to. */
  const current = async () => activeFrom(readRecord(recPath), await bb.sdk.system.machineEnvironment());

  bb.rpc.register(pageContract, {
    // whether the Cloud tab shows CloudView: the first connected machine has a cloud config (a broken one shows, to say
    // so). The tab itself is always listed; without a config it names the path it looked for (cloud/core/setup.ts).
    "cs.available": async () => {
      const id = (await hosts())[0]?.id;
      if (!id) return { available: false, state: "no-machine" as const, path: null };
      const c = await host.call("cs.config", { configPath: opts().configPath }, { hostId: id }).catch(() => null);
      if (!c) return { available: false, state: "error" as const, path: null };
      return { available: c.state !== "missing", state: c.state, path: c.path };
    },
    "cs.view": async ({ hostId }) => {
      const { loginConfig, configPath } = opts();
      const hs = await hosts();
      const id = hs.find((h) => h.id === hostId)?.id ?? hs[0]?.id ?? null;
      const base = { hosts: hs, hostId: id, vars: VARS, note: NOTE, outside: { aws: false, gcp: false } };
      if (!id) return { ...base, listing: null, error: "No connected machine." };
      try {
        const now = await current();
        base.outside = { aws: now.aws.set && !now.aws.value, gcp: now.gcp.set && !now.gcp.value };
        const listing = await host.call("cs.list", { loginConfig, configPath, active: { aws: now.aws.value, gcp: now.gcp.value } }, { hostId: id });
        for (const c of ["aws", "gcp"] as const) {
          if (now[c].set && !now[c].value) listing.notes.push(`${VARS[c]} is set in bb outside cloud-switch (bb hides its value): Use replaces it, Off removes it.`);
        }
        return { ...base, listing, error: null };
      } catch (e) {
        return { ...base, listing: null, error: redact(e instanceof Error ? e.message : String(e)) };
      }
    },
    "cs.check": ({ hostId, name }) => call(async () => host.call("cs.check", { name, active: (await current()).aws.value, configPath: opts().configPath }, { hostId })),
    "cs.use": ({ hostId, cloud, name, confirm }) => call(async () => {
      const { loginConfig, configPath } = opts();
      const { created } = await host.call("cs.prepareUse", { cloud, name, confirm, loginConfig, configPath }, { hostId });
      const previous = (await current())[cloud].value;
      await bb.sdk.system.setMachineEnvironmentVariable({ name: VARS[cloud], value: name, note: BB_NOTE });
      writeRecord(recPath, withChoice(readRecord(recPath), cloud, name));
      bb.log.info(`cloud-switch: ${VARS[cloud]}=${name}${previous ? ` (was ${previous})` : ""}`);
      return { variable: VARS[cloud], previous, active: name, created };
    }),
    "cs.off": ({ cloud }) => call(async () => {
      const previous = (await current())[cloud].value;
      await bb.sdk.system.deleteMachineEnvironmentVariable({ name: VARS[cloud] });
      writeRecord(recPath, withChoice(readRecord(recPath), cloud, null));
      bb.log.info(`cloud-switch: ${VARS[cloud]} unset${previous ? ` (was ${previous})` : ""}`);
      return { variable: VARS[cloud], previous };
    }),
    "cs.login": ({ hostId, cloud, name, confirm }) => call(async () => {
      const { loginConfig, configPath } = opts();
      const plan = await host.call("cs.loginPlan", { cloud, name, confirm, loginConfig, configPath }, { hostId });
      const t = await bb.sdk.terminals.create({ scope: { kind: "host_path", hostId, cwd: null }, start: { mode: "argv", argv: plan.argv }, title: plan.title, cols: 120, rows: 32 });
      bb.log.info(`cloud-switch: ${cloud} ${name} login opened in terminal ${t.id} on ${hostId}`);
      if (cloud !== "aws") return { terminalId: t.id, url: null, code: null, completeUrl: null };
      // Read the device-code URL and code back from the terminal. Only those two leave; the buffer is never logged.
      let text = "";
      let since: number | undefined;
      for (const until = Date.now() + READ_CODE_MS; Date.now() < until;) {
        const out = await bb.sdk.terminals.output({ terminalId: t.id, ...(since === undefined ? {} : { sinceSeq: since }) });
        text += out.chunks.map((c) => Buffer.from(c.dataBase64, "base64").toString("utf8")).join("");
        since = out.nextSeq;
        const dc = parseDeviceCode(text);
        if (dc) return { terminalId: t.id, ...dc };
        if (out.status === "exited" || out.status === "disconnected") break;
        await new Promise((r) => setTimeout(r, 400));
      }
      return { terminalId: t.id, url: null, code: null, completeUrl: null };
    }),
    "cs.loginStatus": ({ terminalId }) => call(async () => {
      const out = await bb.sdk.terminals.output({ terminalId, limitChunks: 1 });
      return { status: out.status, exitCode: out.exitCode };
    }),
    "cs.revokeGcp": ({ hostId, confirm }) => call(async () => {
      const r = await host.call("cs.revokeGcp", { confirm }, { hostId });
      bb.log.info(`cloud-switch: gcp revoke on ${hostId}: ${r.steps.map((s) => (s.ok ? "ok" : "failed")).join(", ")}`);
      return r;
    }),
  });
}
