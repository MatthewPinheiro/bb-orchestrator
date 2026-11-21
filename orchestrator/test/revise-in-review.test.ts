// A lead replaces its own deliverable while it is still in review (2026-11-21). Before, orch_deliver(revises) worked only
// on one the owner sent back with changes, so a lead with newer work filed a second deliverable beside the first and the
// owner couldn't tell which was current.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Engine, type DeliverResult, type ProofInput } from "../core/engine.ts";
import type { Deliverable } from "../core/model.ts";

const scratchRoot = join(import.meta.dirname, ".scratch");
mkdirSync(scratchRoot, { recursive: true });
const dir = mkdtempSync(join(scratchRoot, "revise-in-review-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const shot = join(dir, "shot.png");
writeFileSync(shot, "png");
const place = { roots: [{ path: dir, hostId: "h1" }] };
const proof: ProofInput[] = [{ kind: "image", caption: "the screen", path: shot }];

function setup() {
  let clock = Date.parse("2026-11-21T15:00:00Z");
  const pushed: Deliverable[] = [];
  const e = new Engine(new DatabaseSync(":memory:") as never, {
    now: () => clock,
    async deliver(): Promise<DeliverResult> {
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
    delivered: (d) => pushed.push(structuredClone(d)),
  }, { batchInbox: false });
  e.register("T-cos", "cos", null);
  const lead = e.register("T-la", "lead", "alpha");
  const other = e.register("T-lb", "lead", "beta");
  return { e, lead, other, pushed, advance: (ms: number) => (clock += ms) };
}

test("a deliverable still in review is replaced in place: same id, rev 2, and the list shows only the latest", () => {
  const s = setup();
  const d = s.e.deliver(s.lead, { title: "Test card v1", summary: "First pass.", proof }, place);
  s.advance(60_000);
  const r = s.e.deliver(s.lead, { title: "Test card v2", summary: "Second pass: the newer one.", proof, revises: d.id }, place);
  assert.equal(r.id, d.id);
  assert.equal(r.rev, 2);
  assert.equal(r.state, "review");
  assert.deepEqual(r.revisions.map((v) => v.rev), [1, 2], "rev 1 stays as history");
  const list = s.e.deliverables();
  assert.equal(list.length, 1, "one deliverable, not two side by side");
  assert.equal(list[0]!.title, "Test card v2");
  assert.equal(list[0]!.summary, "Second pass: the newer one.");
  assert.equal(list[0]!.rev, 2);
  assert.equal(s.pushed.length, 2, "the new revision is pushed like a re-delivery after changes");
});

test("an approve or send-back made against the replaced revision is refused", () => {
  const s = setup();
  const d = s.e.deliver(s.lead, { title: "Test card", summary: "v1", proof }, place);
  s.e.deliver(s.lead, { title: "Test card", summary: "v2", proof, revises: d.id }, place);
  assert.throws(() => s.e.personApprove(d.id, 1, null), (err: Error & { kind?: string }) => err.kind === "conflict" && /rev 2, you saw 1/.test(err.message));
  assert.throws(() => s.e.personRequestChanges(d.id, 1, "fix it"), (err: Error & { kind?: string }) => err.kind === "conflict");
  assert.equal(s.e.deliverable(d.id)!.state, "review", "nothing was approved");
  assert.equal(s.e.personApprove(d.id, 2, null).state, "approved");
});

test("another lead can't revise it, and approved or withdrawn deliverables stay final", () => {
  const s = setup();
  const d = s.e.deliver(s.lead, { title: "Test card", summary: "v1", proof }, place);
  assert.throws(() => s.e.deliver(s.other, { title: "t", summary: "s", proof, revises: d.id }, place), /lead:alpha's deliverable/);
  s.e.personApprove(d.id, 1, null);
  assert.throws(() => s.e.deliver(s.lead, { title: "t", summary: "s", proof, revises: d.id }, place), /is approved: revise only a deliverable still in review/);
  const w = s.e.deliver(s.lead, { title: "Other", summary: "v1", proof }, place);
  s.e.withdrawDeliverable(s.lead, w.id, "moot");
  assert.throws(() => s.e.deliver(s.lead, { title: "t", summary: "s", proof, revises: w.id }, place), /is withdrawn/);
  assert.equal(s.e.deliverable(d.id)!.rev, 1);
});

test("the changes flow is unchanged: the revision closes the owner's request and goes back to review", () => {
  const s = setup();
  const d = s.e.deliver(s.lead, { title: "Test card", summary: "v1", proof }, place);
  s.e.personRequestChanges(d.id, 1, "Centre the button.");
  const r = s.e.deliver(s.lead, { title: "Test card", summary: "Centred.", proof, revises: d.id }, place);
  assert.equal(r.rev, 2);
  assert.equal(r.state, "review");
  assert.deepEqual(s.e.items().filter((i) => i.kind === "deliverable.changes").map((i) => i.state), ["closed"]);
  assert.equal(r.feedback.at(-1)!.outcome, "changes", "the owner's note on rev 1 is kept");
});
