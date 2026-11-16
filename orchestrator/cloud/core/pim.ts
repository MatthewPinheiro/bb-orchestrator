// What each target is: its environment (from the AWS account or GCP project id) and the Entra PIM groups that gate it,
// all from the user's config file (core/config.ts). An account or project the config doesn't name is "unknown".
import type { Config } from "./config.ts";

export type Env = "dev" | "prod" | "unknown";

export type PimGroup = {
  group: string;
  /** active: always on, nothing to activate; eligible: activate in PIM first */
  assignment: "active" | "eligible";
  approval: boolean;
  maxDuration: string | null;
  permissions: string;
  /** the config marks this group as a best guess for the role */
  inferred?: boolean;
};

const account = (cfg: Config, id: string | undefined) => (id ? cfg.aws.accounts.find((a) => a.id === id) : undefined);
const project = (cfg: Config, id: string | undefined) => (id ? cfg.gcp.projects.find((p) => p.id === id) : undefined);

/** The GCP configurations cloud-switch defines (created on first use or login): one per project that names one. */
export const gcpDefs = (cfg: Config): { name: string; project: string }[] =>
  cfg.gcp.projects.flatMap((p) => (p.configuration ? [{ name: p.configuration, project: p.id }] : []));

export const awsEnv = (cfg: Config, id: string | undefined): Env => account(cfg, id)?.env ?? "unknown";
export const gcpEnv = (cfg: Config, id: string | undefined): Env => project(cfg, id)?.env ?? "unknown";
export const awsPim = (cfg: Config, id: string | undefined, role: string | undefined): PimGroup[] => {
  const pim = account(cfg, id)?.pim;
  return pim && role && Object.hasOwn(pim, role) ? pim[role] : [];
};
export const gcpPim = (cfg: Config, id: string | undefined): PimGroup[] => project(cfg, id)?.pim ?? [];

/** Anything not known to be dev needs an explicit confirm: prod, and an account or project the config doesn't know. */
export const isGated = (env: Env) => env !== "dev";
