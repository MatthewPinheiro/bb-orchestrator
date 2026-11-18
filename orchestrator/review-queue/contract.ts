// The review queue's page contract (2026-11-18). The read is an RPC, so agents can read the queue too; every change is
// the owner's, an HTTP POST from the page to REVIEW_QUEUE_WRITE (server.ts write(): the app's own origin only), so no
// agent can turn Schedule or Auto on, reorder the queue or press Run now.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { configPatchSchema, QUEUE_MAX, stateSchema } from "../core/review-queue.ts";

/** Published when the queue changes, so an open page refetches. */
export const QUEUE_CHANNEL = "review-queue";

export const queueViewSchema = stateSchema.extend({
  dryRun: z.boolean(), // the reviewQueueDryRun setting: nothing is posted while it is on
  busy: z.boolean(), // a run is going now
  spacingUntil: z.number(),
  hosts: z.array(z.object({ id: z.string(), name: z.string() })),
  /** The providers the optional model picker can use (bb's catalog, enabled and available ones). */
  providers: z.array(z.object({ id: z.string(), name: z.string() })),
  /** The PR a run would ask next, from the facts last read (a live Run now's confirm names it). */
  next: z.object({ url: z.string(), head: z.string(), title: z.string(), comment: z.string() }).nullable(),
});
export type QueueView = z.infer<typeof queueViewSchema>;

export const queueContract = defineRpcContract({
  reviewQueue: { input: z.null(), output: queueViewSchema },
});

const url = z.string().max(500);
export const REVIEW_QUEUE_WRITE = "/review-queue/action";
export const queueActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), url }).strict(),
  z.object({ action: z.literal("remove"), url }).strict(),
  z.object({ action: z.literal("pin"), url }).strict(),
  z.object({ action: z.literal("reorder"), urls: z.array(url).max(QUEUE_MAX) }).strict(),
  z.object({ action: z.literal("configure"), config: configPatchSchema }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
  // With dry-run off, Run now posts only the PR and head the owner confirmed.
  z.object({ action: z.literal("run"), confirm: z.object({ url, head: z.string().min(1).max(100) }).strict().optional() }).strict(),
]);
export type QueueAction = z.infer<typeof queueActionSchema>;
