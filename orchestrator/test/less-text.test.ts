// Less text (requested 2026-11-14: "the visuals and the key decisions and key findings at the top in the simplest terms
// possible with just enough context for me to know why the decision was made"). What matters to the owner: an agent
// can't hand them a paragraph where a line belongs (the caps refuse it, and say where the long text goes); a new
// deliverable shows its pictures and points before anything wordy, with Approve above the closed Details; a card shows
// no prose (its context waits behind More) and a PR card leads with its PR; and every deliverable sent before this keeps its old layout.
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { blocksSchema, captionLine, deliverBlocks, deliverPoints, inputBlocksSchema, lessTextRefusal, pointsSchema, summaryLine, type Block, type Point } from "../blocks.ts";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { loadBrief } from "../core/start.ts";
import { cardBlockOrder, lessText } from "../app/less-text.ts";

const BRIEF_DIR = join(import.meta.dirname, "..", "briefs");
const PR = (n: number) => `https://github.com/acme/app/pull/${n}`;
const points: Point[] = [
  { kind: "decision", headline: "Fix 1413 before merging", why: "A cache miss skips the new rate limit." },
  { kind: "finding", headline: "No PR has QA on its current head", why: "Every merge waits on that pass.", tone: "bad" },
];
const verdicts: Block = { kind: "verdicts", items: [{ url: PR(1413), name: "Retry queue", verdict: "Fix first", tone: "warn" }] };
const checks: Block = { kind: "checks", items: [{ text: "unit tests", ok: true }] };
const facts: Block = { kind: "facts", title: "Testing", items: [{ label: "CI green", value: "4 of 7" }] };

function lead() {
  const e = new Engine(
    new DatabaseSync(":memory:") as never,
    { now: () => Date.parse("2026-11-14T10:00:00Z"), deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {} },
    {},
  );
  return { e, a: e.register("T-la", "lead", "alpha") };
}
const link = [{ kind: "link" as const, caption: "the review", url: "https://example.com/review" }];

test("the caps refuse a paragraph where a line belongs, and say where the long text goes", () => {
  const long = (n: number) => "x".repeat(n);
  const bad = pointsSchema.safeParse([{ ...points[0], headline: long(71) }, points[1]]);
  assert.equal(bad.success, false);
  assert.match(bad.error!.issues[0]!.message, /70 characters.*text or doc proof/);
  assert.equal(pointsSchema.safeParse([points[0], { ...points[1], why: long(111) }]).success, false, "a why over 110");
  assert.equal(pointsSchema.safeParse([points[0]]).success, false, "one point is not a summary of decisions and findings");
  assert.equal(pointsSchema.safeParse(Array(7).fill(points[0])).success, false, "seven points is a wall again");
  assert.equal(pointsSchema.safeParse(points).success, true);

  assert.equal(summaryLine.safeParse(long(161)).success, false, "the summary is one line of context");
  assert.equal(summaryLine.safeParse("Shipped.\nAnd then a second paragraph").success, false, "no second paragraph");
  assert.equal(captionLine.safeParse(long(81)).success, false, "a proof caption is one short line");

  const decision = (text: string) => [{ kind: "decisions", items: [{ text }] }];
  assert.equal(inputBlocksSchema.safeParse(decision(long(71))).success, false, "a new decisions block gets the 70 cap");
  assert.equal(inputBlocksSchema.safeParse([{ kind: "verdicts", items: [{ url: PR(1), name: long(31), verdict: "Ready" }] }]).success, false, "a verdict tile's name");
});

test("agents see the caps in the tool schema, not only as a refusal", () => {
  const schema = JSON.stringify(z.toJSONSchema(z.object({ points: pointsSchema, blocks: inputBlocksSchema, summary: summaryLine, caption: captionLine })));
  for (const n of [70, 80, 110, 160]) assert.ok(schema.includes(`"maxLength":${n}`), `maxLength ${n} is in the JSON schema`);
});

test("the engine refuses long points from any caller, and stores good ones on the revision", () => {
  const { e, a } = lead();
  assert.throws(() => e.deliver(a, { title: "Reviews", summary: "Seven PRs reviewed.", points: [{ ...points[0]!, headline: "x".repeat(80) }, points[1]!], proof: link }, { roots: [] }), /points: 0\.headline/);
  const d = e.deliver(a, { title: "Reviews", summary: "Seven PRs reviewed.", points, proof: link, blocks: [verdicts] }, { roots: [] });
  assert.deepEqual(d.revisions[0]!.points, points);
});

test("a deliverable sent before points keeps its old layout and its stored shape", () => {
  const { e, a } = lead();
  const d = e.deliver(a, { title: "Old style", summary: "2-4 sentences of summary, the way leads wrote them before.", proof: link }, { roots: [] });
  assert.equal("points" in d.revisions[0]!, false, "nothing new is stored on a deliverable without points");
  assert.equal(lessText({ blocks: [], proof: [{ kind: "link" }] }), null, "no points: the old card");
  assert.equal(lessText({ blocks: [], points: [], proof: [] }), null, "empty points: the old card");
  // a decisions block stored before the caps (200 characters) still reads, so the old card still draws it
  assert.equal(blocksSchema.safeParse([{ kind: "decisions", items: [{ text: "x".repeat(200), why: "y".repeat(200) }] }]).success, true);
});

test("a new deliverable draws pictures, then points, then Approve, and only then the closed Details", () => {
  const blocks: Block[] = [checks, verdicts, { kind: "pr", url: PR(1413) }, facts];
  const l = lessText({ blocks, points, proof: [{ kind: "image" }, { kind: "text" }, { kind: "doc" }] })!;
  const at = (p: (typeof l.parts)[number]) => l.parts.indexOf(p);
  assert.ok(at("media") < at("points") && at("visuals") < at("points"), "visuals first");
  assert.ok(at("points") < at("details"), "points before Details");
  assert.ok(at("review") < at("details"), "Approve sits above Details, so opening it never moves Approve");
  assert.deepEqual(l.visual, [1], "the verdicts tiles are a picture");
  assert.deepEqual(l.rest, [0, 2, 3], "checks, facts (tables of text, as in the approved mock) and the PR chip wait under Details");
  assert.equal(l.detailsLabel, "Details: checks, PRs, Testing, 2 files", "a block's own title names it");
  assert.equal(lessText({ blocks: [verdicts], points, proof: [{ kind: "image" }] })!.parts.includes("details"), false, "no empty Details");
});

test("a card leads with its PR, shows one decision line, and keeps the explaining parts behind More", () => {
  const pr: Block = { kind: "pr", url: PR(1469), note: "Ready after QA" };
  const list: Block = { kind: "list", selectable: true, items: [{ label: "a" }] };
  const decisions: Block = { kind: "decisions", items: [{ text: "Merge after QA", status: "made" }, { text: "Approve the spend", status: "needs_you" }] };
  assert.deepEqual(cardBlockOrder([list, pr]), { lead: [1], more: [], after: [0], line: null }, "the PR first; the list keeps its index for unticking");
  const o = cardBlockOrder([list, decisions, pr]);
  assert.deepEqual([o.lead, o.more, o.after], [[2], [1], [0]], "decisions go behind More; what the owner acts on stays");
  assert.equal(o.line, "Approve the spend", "the one line is what needs the owner, else the first decision");
});

test("the briefs carry the rule", () => {
  const vars = { slug: "s", address: "lead:s", pokemon: "", folder: "/f", repo: "/r", base: "dev", owner: "the owner" };
  const l = loadBrief(BRIEF_DIR, "lead", vars);
  assert.match(l, /10-second read: visuals first; each decision or finding is one line plus a short why/);
  assert.match(l, /`verdicts` block with every PR/);
  assert.match(l, /`points`: 2-6/);
  assert.match(l, /hides the context behind "More"/);
  const cos = loadBrief(BRIEF_DIR, "cos", { pokemon: "", folder: "/f", owner: "the owner" });
  assert.match(cos, /hides the context behind\s+"More"/);
});

// 1.1.1 (2026-11-14): agents started before 1.1.0 hold the old tool schema. Every running lead and the CoS could not
// deliver: a call without points was refused, and points passed anyway arrived as a JSON string. Old-schema callers
// must always be able to deliver; the short caps hold only when points are given.
test("an agent on the old schema can always deliver", () => {
  const params = z.object({ summary: z.string().max(900), points: deliverPoints, blocks: deliverBlocks });
  const old = { summary: "Two to four sentences, the way leads wrote them before. ".repeat(8).trim(), proof: [{ caption: "c".repeat(200) }], blocks: [{ kind: "decisions", items: [{ text: "x".repeat(200) }] }] };
  const parsed = params.safeParse(old);
  assert.equal(parsed.success, true, "no points: accepted by the tool's schema");
  assert.equal(lessTextRefusal({ ...old, points: parsed.data!.points }), null, "no points: no short caps, the old layout");

  const asString = params.safeParse({ summary: "Seven PRs reviewed.", points: JSON.stringify(points), blocks: JSON.stringify([verdicts]) });
  assert.equal(asString.success, true, "points and blocks sent as JSON strings are read as arrays");
  assert.deepEqual(asString.data!.points, points);

  const long = params.safeParse({ summary: "s", points: JSON.stringify([{ ...points[0], headline: "x".repeat(71) }, points[1]]) });
  assert.equal(long.success, false, "a too-long headline is still refused, string or not");
  assert.equal(params.safeParse({ summary: "s", points: "not json" }).success, false, "a string that isn't the array is refused");

  const refusal = lessTextRefusal({ summary: "x".repeat(200), points, proof: [{ caption: "ok" }] });
  assert.match(refusal!, /^summary: .*160/, "with points, the refusal names the field to shorten");
  assert.match(lessTextRefusal({ summary: "ok", points, proof: [{ caption: "ok" }, { caption: "c".repeat(81) }] })!, /^proof\.1\.caption: /);
  assert.match(lessTextRefusal({ summary: "ok", points, proof: [], blocks: [{ kind: "decisions", items: [{ text: "x".repeat(71) }] }] })!, /^blocks\.0\.items\.0\.text: /);
  // the SDK turns tool params into JSON Schema with io "input": the string-accepting params must still convert
  assert.doesNotThrow(() => params.toJSONSchema({ io: "input" }));
});
