// The review queue's host methods (2026-11-18): fixed reads, and one fixed write (reviewQueue.post), run with the
// machine's own gh login. The server and the page can't pass a command or a comment body: post's only text is TRIGGER.
import { z } from "zod";
import { factsSchema, outcomeSchema, QUEUE_MAX } from "../core/review-queue.ts";

const url = z.string().max(500);

export const queueHostDefs = {
  "reviewQueue.identity": { input: z.null(), output: z.string().min(1), experimental_retryable: true },
  "reviewQueue.discover": { input: z.null(), output: z.array(url).max(QUEUE_MAX), experimental_retryable: true },
  "reviewQueue.inspect": { input: z.object({ url }).strict(), output: factsSchema, experimental_retryable: true },
  "reviewQueue.outcome": {
    input: z.object({ url, at: z.number() }).strict(),
    output: z.object({ outcome: outcomeSchema.nullable(), cooldownUntil: z.number().nullable() }),
    experimental_retryable: true,
  },
  // Deliberately not retryable: an interrupted answer is an unknown write, never leave to repeat it.
  "reviewQueue.post": {
    input: z.object({ url, head: z.string().min(1), login: z.string().min(1), auto: z.boolean(), dryRun: z.boolean() }).strict(),
    output: z.object({ outcome: outcomeSchema, commentUrl: z.string().nullable(), note: z.string() }),
  },
} as const;
