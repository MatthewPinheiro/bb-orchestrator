// The page's RPC contract: server.ts handles it, app.tsx calls it. Every call that runs on a machine names it (hostId);
// the switch's variables are bb-wide, so Off names none.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { listingSchema, targetSchema } from "./host-contract.ts";

const cloud = z.enum(["aws", "gcp"]);
const target = { hostId: z.string().min(1), cloud, name: z.string().min(1).max(200), confirm: z.string().min(1).max(200).optional() };

export const pageContract = defineRpcContract({
  "cs.available": {
    input: z.null(),
    // state "ok" or "invalid": the tab shows CloudView (an invalid file says what is wrong); otherwise it says what to set up
    output: z.object({ available: z.boolean(), state: z.enum(["ok", "invalid", "missing", "no-machine", "error"]), path: z.string().nullable() }),
  },
  "cs.view": {
    input: z.object({ hostId: z.string().nullable() }).strict(),
    output: z.object({
      hosts: z.array(z.object({ id: z.string(), name: z.string() })),
      hostId: z.string().nullable(),
      listing: listingSchema.nullable(),
      error: z.string().nullable(),
      // the switch's two bb machine variables, and what setting them changes
      vars: z.object({ aws: z.string(), gcp: z.string() }),
      // bb has the variable but cloud-switch didn't set it (or lost its record): its value is hidden, it is not "off"
      outside: z.object({ aws: z.boolean(), gcp: z.boolean() }),
      note: z.string(),
    }),
  },
  // Checks one gated AWS profile with sts now; a plain view never does (it would fetch prod role credentials).
  "cs.check": { input: z.object({ hostId: z.string().min(1), name: z.string().min(1).max(200) }).strict(), output: targetSchema },
  // Sets AWS_PROFILE / CLOUDSDK_ACTIVE_CONFIG_NAME (one bb machine variable) after the host's checks and prod gate.
  "cs.use": {
    input: z.object(target).strict(),
    output: z.object({ variable: z.string(), previous: z.string().nullable(), active: z.string(), created: z.boolean() }),
  },
  // Unsets it: aws goes back to the default chain (the instance role), gcloud to its own active configuration.
  "cs.off": { input: z.object({ cloud }).strict(), output: z.object({ variable: z.string(), previous: z.string().nullable() }) },
  // Opens the login in a bb terminal on the machine. AWS: also the device-code URL and code, read from that terminal.
  "cs.login": {
    input: z.object(target).strict(),
    output: z.object({ terminalId: z.string(), url: z.string().nullable(), code: z.string().nullable(), completeUrl: z.string().nullable() }),
  },
  "cs.loginStatus": {
    input: z.object({ terminalId: z.string().min(1) }).strict(),
    output: z.object({ status: z.enum(["starting", "running", "exited", "disconnected"]), exitCode: z.number().nullable() }),
  },
  "cs.revokeGcp": {
    input: z.object({ hostId: z.string().min(1), confirm: z.literal(true) }).strict(),
    output: z.object({ steps: z.array(z.object({ command: z.string(), ok: z.boolean(), message: z.string() })) }),
  },
});
