// The user's own cloud-switch config: which AWS accounts and GCP projects are dev and which are prod, the PIM groups
// that gate each role or project, the gcloud configurations to offer, and where to look for the AWS config and the
// GCP login config. It lives on the machine (default ~/.config/bb-cloud-switch/config.json; config.example.json shows
// the shape). Without it, or with a broken one, every account and project is "env unknown", so every target is gated.
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { z } from "zod";

export const DEFAULT_CONFIG_PATH = "~/.config/bb-cloud-switch/config.json";

const env = z.enum(["dev", "prod"]);
const pimGroup = z.object({
  group: z.string().min(1),
  /** active: always on, nothing to activate; eligible: activate in PIM first */
  assignment: z.enum(["active", "eligible"]),
  approval: z.boolean().default(false),
  maxDuration: z.string().min(1).nullable().default(null),
  permissions: z.string().default(""),
  /** the group is a best guess for this role, not confirmed */
  inferred: z.boolean().optional(),
}).strict();

export const configSchema = z.object({
  aws: z.object({
    accounts: z.array(z.object({
      id: z.string().regex(/^\d{12}$/, "an AWS account id is 12 digits"),
      env,
      /** sso_role_name -> the PIM groups that gate it */
      pim: z.record(z.string().min(1), z.array(pimGroup)).default({}),
    }).strict()).default([]),
    /** AWS config files to try, in order, when AWS_CONFIG_FILE is unset (before ~/.aws/config). "~/" and "{user}" expand. */
    configPaths: z.array(z.string().min(1)).default([]),
  }).strict().default({ accounts: [], configPaths: [] }),
  gcp: z.object({
    projects: z.array(z.object({
      id: z.string().min(1),
      env,
      /** a gcloud configuration cloud-switch offers for this project (created on first use or login) */
      configuration: z.string().min(1).optional(),
      pim: z.array(pimGroup).default([]),
    }).strict()).default([]),
    /** the workforce login config gcloud logs in with. "~/" and "{user}" expand. */
    loginConfig: z.string().min(1).optional(),
  }).strict().default({ projects: [] }),
  /** links the page and `cloud --help` show (an Entra PIM page, a My Apps portal, ...) */
  links: z.array(z.object({ label: z.string().min(1), url: z.string().regex(/^https?:\/\/\S+$/, "an http(s) URL") }).strict()).default([]),
}).strict();

export type Config = z.infer<typeof configSchema>;
export type ConfigInfo = { path: string; state: "ok" | "missing" | "invalid"; error: string | null };

export const EMPTY_CONFIG: Config = configSchema.parse({});

/** "~/" -> HOME, "{user}" -> the user name, both from `env` (never this process's own, so tests stay in their sandbox). */
export function expandPath(p: string, env: Record<string, string | undefined>): string {
  const user = env.USER || env.LOGNAME || userInfo().username;
  const home = env.HOME ?? "";
  return (p.startsWith("~/") ? `${home}/${p.slice(2)}` : p).replaceAll("{user}", user);
}

/** The config path: the plugin's setting, else CLOUD_SWITCH_CONFIG, else the default. */
export const configPath = (env: Record<string, string | undefined>, setting: string | null = null): string =>
  expandPath(setting || env.CLOUD_SWITCH_CONFIG || DEFAULT_CONFIG_PATH, env);

export function loadConfig(env: Record<string, string | undefined>, setting: string | null = null): { config: Config; info: ConfigInfo } {
  const path = configPath(env, setting);
  const fail = (error: string) => ({ config: EMPTY_CONFIG, info: { path, state: "invalid" as const, error: error.slice(0, 1000) } });
  if (!path.startsWith("/")) return fail("the config path must be absolute or start with ~/");
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { config: EMPTY_CONFIG, info: { path, state: "missing", error: null } };
    return fail(`can't read it: ${(e as Error).message}`);
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { return fail(`not JSON: ${(e as Error).message}`); }
  const r = configSchema.safeParse(json);
  if (!r.success) return fail(z.prettifyError(r.error));
  return { config: r.data, info: { path, state: "ok", error: null } };
}
