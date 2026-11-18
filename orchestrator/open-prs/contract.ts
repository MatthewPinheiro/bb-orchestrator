// The Open PRs tab's page contract: the read, and Post's two steps (2026-11-17). Without a Slack token, Post copies the
// text and opens the channel, as before. With one (the slackToken secret setting, which never leaves the server), Post
// is a preview, then openPrsPrepare (a read: it finds the channel and the mentions, and keeps the exact message under the
// page's key), then the confirm's POST to OPEN_PRS_POST with that key alone, which posts what was prepared, once.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { OPEN_PRS_MAX, PR_URL_RE, REPO_RE } from "../core/open-prs.ts";

/** Published when a GitHub read lands, so an open tab refetches. */
export const OPEN_PRS_CHANNEL = "open-prs";

const candidate = z.object({ name: z.string(), say: z.string(), owner: z.boolean(), recent: z.number() });

/** One PR as a "since your last copy" baseline keeps it (core/open-prs-copies.ts CopiedPr). */
export const copiedPrSchema = z
  .object({
    url: z.string().regex(PR_URL_RE),
    repo: z.string().regex(REPO_RE),
    number: z.number().int().positive(),
    title: z.string().max(1024),
    sha: z.string().max(64),
    state: z.enum(["first", "rereview", "approved"]).nullable(),
    review: z.string().max(64),
    ci: z.enum(["pass", "pending", "fail", "none"]),
  })
  .strict();
export const sectionSchema = z.enum(["needs", "first", "rereview"]);
const baseline = z.object({ at: z.number().int().nonnegative(), prs: z.array(copiedPrSchema).max(OPEN_PRS_MAX) });
export const copyHistorySchema = z.object({ needs: baseline.optional(), first: baseline.optional(), rereview: baseline.optional() });
/** A copied or posted ask: its section and exactly the PRs it held, as the page drew them. */
export const copiedSchema = z.object({ section: sectionSchema, prs: z.array(copiedPrSchema).max(OPEN_PRS_MAX) }).strict();

export const openPrSchema = z.object({
  url: z.string(),
  number: z.number(),
  title: z.string(),
  repo: z.string(),
  project: z.string().nullable(),
  lead: z.string().nullable(), // the project's lead address
  agent: z.string().nullable(), // the agent whose branch it is
  draft: z.boolean(),
  review: z.string(), // in words
  approved: z.boolean(),
  approvals: z.string(), // "1 of 2 approvals"
  ci: z.enum(["pass", "pending", "fail", "none"]),
  merge: z.string(), // in words
  summary: z.string(),
  needsReview: z.boolean(),
  excluded: z.boolean(), // its project is in reviewExcludedProjects
  updatedAt: z.string(),
  candidates: z.array(candidate), // suggested reviewers (needs-review, first-review and re-review PRs)
  // the review states (2026-11-18): null for a draft, and until the first read after an install that added them
  sha: z.string().default(""),
  state: z.enum(["first", "rereview", "approved"]).nullable().default(null),
  stateWho: z.array(candidate).default([]), // first: requested or suggested; re-review: earlier reviewers; approved: approvers
});
export type OpenPr = z.infer<typeof openPrSchema>;

export const openPrsViewSchema = z.object({
  state: z.enum(["unset", "loading", "ok", "error"]),
  login: z.string(),
  error: z.string().nullable(), // the last read's failure (stale data kept)
  notes: z.array(z.string()), // settings that need fixing (bad JSON, bad channel)
  fetchedAt: z.number().nullable(), // when the PRs shown were read: after a restart, the kept snapshot's time
  checking: z.boolean(), // a GitHub read is running now (the PRs shown are fetchedAt's until it lands)
  pollMinutes: z.number(),
  more: z.boolean(), // more open PRs than one read lists
  channel: z.object({ url: z.string(), name: z.string() }).nullable(),
  excluded: z.array(z.string()), // reviewExcludedProjects: their PRs start unticked in the Post preview
  canPost: z.boolean(), // a Slack token is set: Post sends (else it copies and opens the channel)
  prs: z.array(openPrSchema),
  copied: copyHistorySchema.default({}), // each section's baseline: what its last successful copy or post held
  departed: z.record(z.string(), z.enum(["MERGED", "CLOSED", "OPEN"])).default({}), // baseline PRs no longer open, as GitHub says
});
export type OpenPrsView = z.infer<typeof openPrsViewSchema>;

/** One Post's key, minted by the page when the Post preview opens: a second click or a resend with it never posts twice. */
export const postKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const openPrsPrepareSchema = z.object({
  channel: z.string(), // "#name"
  shown: z.string(), // the message exactly as it will show in the channel (core's slackPost)
  notes: z.array(z.string()), // e.g. a handle no one in Slack has
});
export type OpenPrsPrepared = z.infer<typeof openPrsPrepareSchema>;

export const openPrsContract = defineRpcContract({
  openPrs: { input: z.null(), output: openPrsViewSchema },
  // copied (optional, 2026-11-18): the section and PRs this post holds, kept as that section's baseline once it posts
  openPrsPrepare: { input: z.object({ key: postKeySchema, text: z.string().min(1).max(30_000), copied: copiedSchema.optional() }), output: openPrsPrepareSchema },
});

/** The confirm's write (an HTTP POST from the page, as every owner write is): it posts the prepared message once. */
export const OPEN_PRS_POST = "/open-prs/post";
export const openPrsPostBody = z.object({ key: postKeySchema });
/** A successful Copy's write (2026-11-18): that section's baseline becomes exactly these PRs. Never called on a failed copy. */
export const OPEN_PRS_COPIED = "/open-prs/copied";
export const openPrsCopiedBody = copiedSchema;
export interface OpenPrsPosted {
  channel: string;
  permalink: string | null;
}
