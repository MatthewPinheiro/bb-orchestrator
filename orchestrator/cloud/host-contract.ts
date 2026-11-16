// The host entry's methods (host.ts runs them on a machine; server.ts calls them), and the shapes the page gets.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const cloud = z.enum(["aws", "gcp"]);
const env = z.enum(["dev", "prod", "unknown"]);
const pim = z.object({
  group: z.string(), assignment: z.enum(["active", "eligible"]), approval: z.boolean(), maxDuration: z.string().nullable(),
  permissions: z.string(), inferred: z.boolean().optional(),
});
export const targetSchema = z.object({
  cloud, name: z.string(), env, gated: z.boolean(), active: z.boolean(),
  state: z.enum(["in", "out", "unknown", "unchecked"]), identity: z.string().nullable(), why: z.string().nullable(),
  account: z.string().nullable(), role: z.string().nullable(), project: z.string().nullable(), created: z.boolean(),
  pim: z.array(pim),
});
export const listingSchema = z.object({
  targets: z.array(targetSchema),
  aws: z.object({ config: z.string(), source: z.enum(["env", "config", "home"]), active: z.string().nullable() }),
  gcp: z.object({
    active: z.string().nullable(), gcloudActive: z.string().nullable(), loginConfig: z.string().nullable(),
    adc: z.object({ present: z.boolean(), writtenAt: z.number().nullable() }),
  }),
  // the user's config file: missing or invalid means every target is "env unknown" (gated) and has no PIM group
  config: z.object({ path: z.string(), state: z.enum(["ok", "missing", "invalid"]), error: z.string().nullable() }),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  notes: z.array(z.string()),
});
export type TargetView = z.infer<typeof targetSchema>;
export type ListingView = z.infer<typeof listingSchema>;

// The login config the plugin's setting names, when set (else the host finds one itself).
const loginConfig = z.string().startsWith("/").nullable();
// The config file the plugin's setting names ("~/" is the machine user's home), when set (else the host's default).
const configPath = z.string().min(1).max(1000).nullable();
// A gated (prod) target's confirm: its own name, as the page's second step names it.
const confirm = z.string().min(1).max(200).optional();
// What the switch has set (AWS_PROFILE, CLOUDSDK_ACTIVE_CONFIG_NAME): the server knows, the host marks the rows.
const active = z.object({ aws: z.string().nullable(), gcp: z.string().nullable() }).strict();

export const hostContract = defineRpcContract({
  "cs.config": { input: z.object({ configPath }).strict(), output: z.object({ path: z.string(), state: z.enum(["ok", "missing", "invalid"]), error: z.string().nullable() }) },
  "cs.list": { input: z.object({ loginConfig, configPath, active }).strict(), output: listingSchema, experimental_retryable: true },
  // The checks before the server sets the variable: the target exists, the prod gate, and a defined gcloud
  // configuration is created (not activated). Writes no AWS file.
  "cs.prepareUse": {
    input: z.object({ cloud, name: z.string().min(1).max(200), confirm, loginConfig, configPath }).strict(),
    output: z.object({ created: z.boolean() }),
  },
  // The login as one argv for a bb terminal on this machine. Prepares nothing but a missing GCP configuration.
  "cs.loginPlan": {
    input: z.object({ cloud, name: z.string().min(1).max(200), confirm, loginConfig, configPath }).strict(),
    output: z.object({ argv: z.array(z.string()), title: z.string() }),
  },
  // One AWS profile checked now with sts (the page's Check on a gated row). Read-only.
  "cs.check": { input: z.object({ name: z.string().min(1).max(200), active: z.string().nullable(), configPath }).strict(), output: targetSchema },
  "cs.revokeGcp": {
    input: z.object({ confirm: z.literal(true) }).strict(),
    output: z.object({ steps: z.array(z.object({ command: z.string(), ok: z.boolean(), message: z.string() })) }),
  },
});
