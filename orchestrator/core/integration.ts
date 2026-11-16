import { z } from "zod";
import { EngineError } from "./model.ts";

const name = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const externalMailSchema = z.object({
  source: name,
  id: z.string().min(1).max(256),
  originalId: z.string().min(1).max(256).nullable().default(null),
  to: z.string().min(1).max(100),
  sender: z.string().min(1).max(200),
  task: z.string().max(200),
  severity: z.string().min(1).max(40),
  summary: z.string().min(1).max(4000),
  body: z.string().max(20000).default(""),
  refs: z.array(z.string().max(1000)).max(30).default([]),
  re: z.string().max(256).nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  dueAt: z.number().int().nonnegative().nullable().default(null),
  needsReply: z.boolean().default(false),
}).strict();
export type ExternalMail = z.infer<typeof externalMailSchema>;

/** Exact source/recipient allow-list; no wildcards or implicit operator authority in imported labels. */
export function integrationRoutes(raw: string): Record<string, string[]> {
  try { return z.record(name, z.array(z.string().min(1).max(100)).max(200)).parse(JSON.parse(raw)); }
  catch { throw new EngineError("invalid", "integrationRoutes must be a JSON object of source ids to recipient address lists"); }
}

export function allowImport(routes: Record<string, string[]>, source: string, to?: string): void {
  if (!Object.hasOwn(routes, source) || (to !== undefined && !routes[source]!.includes(to))) throw new EngineError("forbidden", "integration source/recipient is not enabled");
}
