// Generative UI for the owner's cards and deliverables (2026-11-13: "different cards for like login codes and flows
// and also better generative ui components"). An agent adds typed blocks; the screens draw each as a component instead
// of prose. The kinds come from what his past questions carried (.scratch/needs-you-catalog.md): sign-in links and
// device codes, steps to try on a device, PRs, exact lists to approve, figures, and commands.
import { z } from "zod";

const url = z.string().url().max(4000).refine((u) => /^https?:\/\//i.test(u), "an http(s) URL");
const line = (max: number, message?: string) => z.string().min(1).max(max, message);

const CHANGE = z.enum(["added", "changed", "removed", "same"]);
/** A diagram: 2-14 boxes and the arrows between them. Ids are short and unique; every arrow names two of them. */
export const diagramSchema = z
  .object({
    kind: z.literal("diagram"),
    title: z.string().max(80).optional(),
    direction: z.enum(["right", "down"]).default("right").describe("right: a left-to-right flow; down: top-to-bottom layers"),
    nodes: z
      .array(
        z.object({
          id: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/),
          label: line(40),
          note: z.string().max(60).optional().describe("One short line under the label"),
          change: CHANGE.default("same").describe("What this PR or fix does to it"),
        }),
      )
      .min(2)
      .max(14),
    edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().max(30).optional(), change: CHANGE.default("same") })).max(24),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const n of d.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: "custom", message: `duplicate node id ${n.id}` });
      ids.add(n.id);
    }
    for (const e of d.edges) if (!ids.has(e.from) || !ids.has(e.to)) ctx.addIssue({ code: "custom", message: `edge ${e.from} -> ${e.to} names a node that isn't there` });
  });

const TONE = z.enum(["good", "warn", "bad"]);
const WHERE_LONG = "put the long text in a text or doc proof";

/** What was decided: the stored form allows the old lengths; a new ask or deliverable gets the short caps (inputBlocksSchema). */
function decisionsBlock(text: number, why: number) {
  return z.object({
    kind: z.literal("decisions"),
    title: z.string().max(80).optional(),
    items: z
      .array(
        z.object({
          text: line(text, `a decision is one line of at most ${text} characters; ${WHERE_LONG}`),
          why: z.string().max(why, `a why is at most ${why} characters; ${WHERE_LONG}`).optional(),
          status: z.enum(["made", "proposed", "needs_you"]).default("made"),
        }),
      )
      .min(1)
      .max(10),
  });
}

const members = [
  // a sign-in the owner finishes on their own device: the link as a button, the code to compare or copy, and the time it expires
  z.object({
    kind: z.literal("login"),
    service: line(60).describe("What the person signs in to, e.g. AWS SSO (dev account)"),
    url: url.describe("The sign-in or device page"),
    code: z.string().max(64).optional().describe("The code the page shows, for the person to compare or type"),
    account: z.string().max(120).optional().describe("Which account or profile to pick"),
    expires_at: z.string().datetime({ offset: true }).optional().describe("When the code or link stops working (ISO 8601)"),
    paste: z.boolean().optional().describe("true when the page gives THE PERSON a code to paste back: the card shows a masked field; the code never goes into the decision, you get a file path"),
  }),
  // a flow, in order: what to do, and what he should see
  z.object({
    kind: z.literal("steps"),
    title: z.string().max(80).optional(),
    items: z.array(z.object({ text: line(300), expect: z.string().max(200).optional().describe("What the person should see") })).min(1).max(12),
  }),
  // a pull request: drawn with its live state when pr-watch knows it
  z.object({ kind: z.literal("pr"), url: url, note: z.string().max(200).optional() }),
  // an exact list to approve; with selectable, he can untick items, and the answer names the ones he left out
  z.object({
    kind: z.literal("list"),
    title: z.string().max(80).optional(),
    selectable: z.boolean().optional(),
    items: z.array(z.object({ label: line(200), meta: z.string().max(80).optional().describe("Size, age or state"), url: url.optional() })).min(1).max(50),
  }),
  // figures side by side: usage, sizes, blast radius, before and after
  z.object({
    kind: z.literal("facts"),
    title: z.string().max(80).optional(),
    items: z.array(z.object({ label: line(60), value: line(200), tone: z.enum(["good", "warn", "bad"]).optional() })).min(1).max(12),
  }),
  // what was proven and how: each check passed or failed (a deliverable's "Checks:" list)
  z.object({
    kind: z.literal("checks"),
    title: z.string().max(80).optional(),
    items: z.array(z.object({ text: line(300), ok: z.boolean(), how: z.string().max(200).optional().describe("How it was proven: the test, run or screenshot") })).min(1).max(20),
  }),
  // the exact command he is asked to allow or run
  z.object({ kind: z.literal("command"), text: line(4000), language: z.string().max(20).optional(), where: z.string().max(60).optional().describe("Where it runs: prod, runner, Mac") }),
  // Requested 2026-11-13: "a lot more visual ... small architecture diagrams explaining what this PR is actually changing".
  // Boxes and arrows, each marked added / changed / removed / same, drawn as a small diagram (app/diagram.tsx).
  diagramSchema,
  // what was decided (or is proposed, or needs him), each with its reason in a line
  decisionsBlock(200, 200),
  // what still has to change: each item with where (file or area) and how much it matters
  z.object({
    kind: z.literal("changes"),
    title: z.string().max(80).optional(),
    items: z.array(z.object({ text: line(200), where: z.string().max(120).optional().describe("File, module or area"), level: z.enum(["must", "should", "nit"]) })).min(1).max(15),
  }),
  // a root cause in one line each: what was seen, why it happened, the fix (with the screenshot as an image proof)
  z.object({
    kind: z.literal("rca"),
    symptom: line(200).describe("What was seen"),
    cause: line(300).describe("Why it happened"),
    fix: line(300).describe("The fix, or the proposed fix"),
    evidence: z.string().max(200).optional().describe("What proves the cause: the trace, log line or screenshot"),
    status: z.enum(["fixed", "proposed"]).default("proposed"),
  }),
  // a PR review at a glance (2026-11-14, "way less text"): one tile per PR with its verdict, coloured by tone
  z.object({
    kind: z.literal("verdicts"),
    title: z.string().max(80).optional(),
    items: z
      .array(
        z.object({
          url: url.describe("The PR"),
          name: line(30, "a PR's name is at most 30 characters").describe("What the PR is, in a few words"),
          verdict: line(20, "a verdict is at most 20 characters, e.g. Ready, Needs fixes").describe("e.g. Ready, Needs fixes, Blocked"),
          tone: TONE.optional().describe("good: ready; warn: needs work; bad: blocked; none: not reviewed"),
        }),
      )
      .min(1)
      .max(12),
  }),

] as const;

/** Every block as stored and drawn, old ones included. */
export const blockSchema = z.discriminatedUnion("kind", [...members]);
export type Block = z.infer<typeof blockSchema>;
export const blocksSchema = z.array(blockSchema).max(10);

/** Caps for what an agent writes from now on (2026-11-14, "way less text"): a decision is one line plus a short why. */
export const DECISION_MAX = 70;
export const WHY_MAX = 110;
export const inputBlocksSchema = z.array(z.discriminatedUnion("kind", [...members.map((m) => (m.shape.kind.value === "decisions" ? decisionsBlock(DECISION_MAX, WHY_MAX) : m))] as unknown as typeof members)).max(10);

/** A deliverable's top: each decision or finding as one line with a short why, drawn before any prose. */
export const pointSchema = z.object({
  kind: z.enum(["decision", "finding"]),
  headline: line(DECISION_MAX, `a headline is one line of at most ${DECISION_MAX} characters; ${WHERE_LONG}`).describe("The decision or finding, in plain words"),
  why: line(WHY_MAX, `a why is at most ${WHY_MAX} characters; ${WHERE_LONG}`).describe("Why, in a short phrase"),
  tone: TONE.optional().describe("good, warn or bad; none for neutral"),
});
export type Point = z.infer<typeof pointSchema>;
export const pointsSchema = z.array(pointSchema).min(2, "give 2-6 points").max(6, `give 2-6 points; ${WHERE_LONG}`);

/** A deliverable's summary, now one line of context above the visuals. */
export const SUMMARY_MAX = 160;
export const summaryLine = z
  .string()
  .trim()
  .min(1)
  .max(SUMMARY_MAX, `the summary is one line of at most ${SUMMARY_MAX} characters; the points carry the decisions and findings, and ${WHERE_LONG}`)
  .refine((s) => !s.includes("\n"), `the summary is one line; ${WHERE_LONG}`);
export const CAPTION_MAX = 80;
export const captionLine = z.string().min(1).max(CAPTION_MAX, `a caption is one line of at most ${CAPTION_MAX} characters; ${WHERE_LONG}`);

/**
 * An agent started before 1.1.0 holds the old tool schema: it has no `points`, and when told to pass them its client
 * sends the array as a JSON string (2026-11-14, every running lead and the CoS). A string that parses is taken as the
 * value it spells; anything else is left for the schema to refuse.
 */
export function fromJson(v: unknown): unknown {
  if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
export const deliverPoints = z.preprocess(fromJson, pointsSchema).optional();
export const deliverBlocks = z.preprocess(fromJson, blocksSchema).optional();

/**
 * The short caps hold for a deliverable with points, the new layout. One without points (an agent on the old schema)
 * is accepted as before and drawn in the old layout. The refusal names the field to shorten.
 */
export function lessTextRefusal(p: { summary: string; points?: readonly unknown[] | null; proof: readonly { caption: string }[]; blocks?: unknown }): string | null {
  if (!p.points?.length) return null;
  const issue = (field: string, r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => {
    const i = r.success ? null : r.error!.issues[0]!;
    return i ? `${[field, ...i.path.map(String)].join(".")}: ${i.message}` : null;
  };
  return (
    issue("summary", summaryLine.safeParse(p.summary)) ??
    p.proof.map((x, n) => issue(`proof.${n}.caption`, captionLine.safeParse(x.caption))).find(Boolean) ??
    (p.blocks === undefined ? null : issue("blocks", inputBlocksSchema.safeParse(p.blocks)))
  );
}

/**
 * A sign-in code typed into "Other" instead of a login block's masked field (twice on 2026-11-13, both gcloud codes,
 * 1,785 characters each, kept in the decision until the owner had them wiped). One token, no spaces, long, letters and
 * digits mixed, and not a link: the answer route then treats it as the masked field does (a 0600 file, the path only).
 */
export function looksLikeCode(text: string | null): boolean {
  const t = (text ?? "").trim();
  if (t.length < 40 || /\s/.test(t) || /:\/\//.test(t)) return false;
  return /^[A-Za-z0-9_\-\/.+=~]+$/.test(t) && /[A-Za-z]/.test(t) && /\d/.test(t);
}
