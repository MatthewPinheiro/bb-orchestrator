// The plugin's host entry: runs cloud-switch's core on the machine the page is about (the runner), with that machine's
// own aws, gcloud and files. It never sets the switch's variables (the server does, in bb's machine environment) and
// never writes the AWS config. Errors carry redacted text only.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "./host-contract.ts";
import { checkAws, list, makeCtx, planLogin, prepareUse, revokeGcp, terminalArgv } from "./core/cloud.ts";
import { loadConfig } from "./core/config.ts";
import { redact } from "./core/mask.ts";

const ctxFor = (loginConfig: string | null, configPath: string | null = null) => makeCtx(process.env, { loginConfig, configPath });
const clean = async <T>(f: () => Promise<T>): Promise<T> => {
  try { return await f(); } catch (e) { throw new Error(redact(e instanceof Error ? e.message : String(e))); }
};

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    "cs.config": ({ configPath }) => clean(async () => loadConfig(process.env, configPath).info),
    "cs.list": ({ loginConfig, configPath, active }) => clean(() => list(ctxFor(loginConfig, configPath), active)),
    "cs.prepareUse": ({ cloud, name, confirm, loginConfig, configPath }) => clean(async () => {
      const r = await prepareUse(ctxFor(loginConfig, configPath), cloud, name, confirm);
      return { created: r.created };
    }),
    "cs.loginPlan": ({ cloud, name, confirm, loginConfig, configPath }) => clean(async () => {
      const plan = await planLogin(ctxFor(loginConfig, configPath), cloud, name, confirm);
      return { argv: terminalArgv(plan), title: plan.title };
    }),
    "cs.check": ({ name, active, configPath }) => clean(() => checkAws(ctxFor(null, configPath), name, active)),
    "cs.revokeGcp": ({ confirm }) => clean(() => revokeGcp(ctxFor(null), confirm)),
  },
});
