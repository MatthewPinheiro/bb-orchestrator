// The auto-moot flag (2026-11-16). The owner asked for a change in a deliverable's note, and the lead then filed a card
// asking the owner for that same change (18 s later), and another one 7 min later, answered after 9 hours when it had
// shipped. The CoS now sees "Likely moot" on such a card before it decides whether the owner must see it.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { contentWords } from "../core/moot.ts";
import type { Item } from "../core/model.ts";

// No /tmp: a scratch folder beside the tests (.scratch/ is git-ignored), removed afterwards.
const scratchRoot = join(import.meta.dirname, ".scratch");
mkdirSync(scratchRoot, { recursive: true });
const dir = mkdtempSync(join(scratchRoot, "likely-moot-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const shot = join(dir, "shot.png");
writeFileSync(shot, "png");

function setup() {
  let clock = Date.parse("2026-11-15T03:00:00Z");
  const sent: Item[] = [];
  const e = new Engine(new DatabaseSync(":memory:") as never, {
    now: () => clock,
    async deliver(_t, _text, item): Promise<DeliverResult> {
      sent.push(item);
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  e.register("T-cos", "cos", null);
  const lead = e.register("T-lo", "lead", "games");
  const other = e.register("T-lx", "lead", "other");
  const place = { roots: [{ path: dir, hostId: "h1" }] };
  const v = e.deliver(lead, { title: "Phone: Fast is hold-to-use", summary: "Fast works while held.", proof: [{ kind: "image", caption: "the pad", path: shot }] }, place);
  const toCos = (id: string) => e.items(500).find((i) => i.recipient === "cos" && i.kind === "decision.new" && i.ref === id)!;
  return { e, lead, other, v, toCos, advance: (ms: number) => (clock += ms) };
}

test("a card asking for what the owner's change note already asked is flagged to the CoS, with the note", () => {
  const s = setup();
  s.advance(60 * 60_000);
  s.e.personRequestChanges(s.v.id, 1, "Can you make the fast mode a toggle");
  s.advance(18_000);
  const d = s.e.ask(s.lead, { title: "Fast as a toggle?", question: "Make the phone's Fast button a tap-on/tap-off toggle?", options: [{ label: "Go" }, { label: "Not now" }] });
  const body = s.toCos(d.id).body;
  assert.match(body, /Likely moot: .*change note on v-\w+ .* already asks for this: "Can you make the fast mode a toggle" \(shared: fast, toggle\)/);
  assert.match(body, /orch_moot it/);
  assert.equal(s.e.decision(d.id)!.state, "open", "only a flag: the card is not withdrawn, and still escalates if the CoS doesn't act");
});

test("a plan card gets the flag, but is never told to be mooted: its go must come from the owner", () => {
  const s = setup();
  s.e.personRequestChanges(s.v.id, 1, "Can you make the fast mode a toggle");
  const d = s.e.ask(s.lead, { title: "Fast as a toggle?", question: "Start 1 thread to make Fast a toggle?", options: [{ label: "Go" }, { label: "Not now" }], kind: "plan" });
  const body = s.toCos(d.id).body;
  assert.match(body, /Likely moot/);
  assert.match(body, /A plan's go still comes from/);
  assert.doesNotMatch(body, /orch_moot it/);
});

test("a merge card is never told to be mooted either, and 'merge' alone is no match", () => {
  const s = setup();
  s.e.personRequestChanges(s.v.id, 1, "lets do final clean up on those tests then merge it");
  const plain = s.e.ask(s.lead, { title: "Merge 1234 once approved?", question: "Merge 1234 when the review approves it?", options: [{ label: "Yes" }, { label: "No" }], action: "merge" });
  assert.doesNotMatch(s.toCos(plain.id).body, /Likely moot/, "the note said merge after a cleanup; the card asks about the approval: not the same request");
  s.e.personRequestChanges(s.e.deliver(s.lead, { title: "Fast toggle", summary: "x", proof: [{ kind: "image", caption: "c", path: shot }] }, { roots: [{ path: dir, hostId: "h1" }] }).id, 1, "make fast a toggle");
  const m = s.e.ask(s.lead, { title: "Merge the fast toggle?", question: "Merge the fast toggle PR?", options: [{ label: "Yes" }, { label: "No" }], action: "merge" });
  assert.match(s.toCos(m.id).body, /A merge card's yes still comes from/);
  assert.doesNotMatch(s.toCos(m.id).body, /orch_moot it/);
});

test("no flag for one shared word, another lead's note, or a note over a day old: false flags would hide real cards", () => {
  const s = setup();
  s.e.personRequestChanges(s.v.id, 1, "Can you make the fast mode a toggle");
  const one = s.e.ask(s.lead, { title: "Slow too?", question: "Should Slow be a toggle as well?", options: [{ label: "Yes" }, { label: "No" }] });
  assert.doesNotMatch(s.toCos(one.id).body, /Likely moot/, "'toggle' alone is not the same request");
  const elsewhere = s.e.ask(s.other, { title: "Fast toggle?", question: "Make fast a toggle?", options: [{ label: "Yes" }, { label: "No" }] });
  assert.doesNotMatch(s.toCos(elsewhere.id).body, /Likely moot/, "only the lead who got the note");
  s.advance(24 * 3_600_000 + 60_000);
  const late = s.e.ask(s.lead, { title: "Fast toggle?", question: "Make fast a toggle?", options: [{ label: "Yes" }, { label: "No" }] });
  assert.doesNotMatch(s.toCos(late.id).body, /Likely moot/);
});

test("words that say what kind of work it is don't count toward a match", () => {
  assert.deepEqual([...contentWords("Start a thread to review and build the fix")], []);
  assert.deepEqual([...contentWords("Release 1.2.2 for PR 1234")], ["1.2.2", "1234"], "versions and PR numbers stay whole");
});
