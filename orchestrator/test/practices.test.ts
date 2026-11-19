// Standing practices (2026-11-19): a rule of kind "practice" is a standing instruction from the owner that leads, the
// CoS and threads follow. Only the owner adds one (the Rules tab's write), it never settles a card and is never cited,
// and every role that works sees it in its recovery view, which is rebuilt every turn and after a compaction.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ruleAddBody } from "../contract.ts";
import { Engine, type DeliverResult } from "../core/engine.ts";

function setup() {
  let clock = Date.parse("2026-11-19T10:00:00Z");
  const db = new DatabaseSync(":memory:");
  const e = new Engine(db as never, {
    now: () => clock,
    async deliver(): Promise<DeliverResult> {
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  const cos = e.register("T-cos", "cos", null);
  const steward = e.register("T-st", "steward", null);
  const leadA = e.register("T-la", "lead", "alpha");
  const leadB = e.register("T-lb", "lead", "beta");
  const worker = e.register("T-w1", "thread", "alpha", "T-la");
  return { e, db, cos, steward, leadA, leadB, worker, advance: (ms: number) => (clock += ms), now: () => clock };
}

const three = [{ label: "Ship it" }, { label: "Wait" }, { label: "Drop it" }];
const SLOP = "For any code in the acme-api repo, run the cleanup skill before the PR goes ready.";
const practice = (s: ReturnType<typeof setup>, project: string | null = null, text = SLOP, expiresAt: number | null = null) =>
  s.e.addRule({ text, project, kinds: ["practice"], expiresAt, source: "said in chat 2026-11-19" });

/** A recovery view's section: its header and the "- " lines under it, up to the next header. Null when absent. */
function section(view: string, header: (l: string) => boolean): string[] | null {
  const lines = view.split("\n");
  const at = lines.findIndex(header);
  if (at < 0) return null;
  const out = [lines[at]!];
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith("- ")) break;
    out.push(l);
  }
  return out;
}
const practicesIn = (view: string) => section(view, (l) => l.startsWith("Standing practices from "));
const citeList = (view: string) => section(view, (l) => l === "Standing rules you may cite:")?.slice(1) ?? [];

test("the owner's write adds a practice: the Rules tab's body takes the kind, and the engine stores it alone", () => {
  const body = ruleAddBody.parse({ text: SLOP, project: null, kinds: ["practice"], expiresInDays: null, source: "said in chat" });
  assert.deepEqual(body.kinds, ["practice"]);
  const s = setup();
  const p = practice(s);
  assert.deepEqual(p.kinds, ["practice"]);
  assert.equal(p.project, null, "null: every project");
  assert.equal(p.match, null);
  assert.deepEqual(s.e.rules().map((r) => r.id), [p.id]);
});

test("a practice stands alone: mixed with question or plan, or carrying a match, it is refused and nothing is stored", () => {
  const s = setup();
  for (const kinds of [["practice", "question"], ["plan", "practice"], ["question", "plan", "practice"]])
    assert.throws(() => s.e.addRule({ text: SLOP, project: null, kinds, expiresAt: null, source: "test" }), /practice.*(alone|only)/i, `kinds ${kinds.join("/")}`);
  assert.throws(
    () => s.e.addRule({ text: SLOP, project: null, kinds: ["practice"], expiresAt: null, source: "test", match: { from: ["lead:alpha"], words: ["ship"], without: [], key_prefix: null, option: ["ship"] } }),
    /practice/i,
  );
  assert.equal(s.e.rules().length, 0, "a refused write leaves no row");
  assert.throws(() => s.e.addRule({ text: "x".repeat(301), project: null, kinds: ["practice"], expiresAt: null, source: "test" }), /300/, "the text cap stays 300");
});

test("a practice shows in the lead's, the CoS's and a thread's recovery view, apart from the rules they may cite", () => {
  const s = setup();
  const rule = s.e.addRule({ text: "alpha ships when green", project: null, kinds: ["question"], expiresAt: null, source: "test" });
  const p = practice(s);
  for (const who of [s.leadA, s.cos, s.worker]) {
    const view = s.e.inbox(who).text;
    const sec = practicesIn(view);
    assert.ok(sec, `${who.address} sees a practices section`);
    assert.match(sec[0]!, /settle no card/, "the header says practices settle nothing");
    assert.ok(sec.some((l) => l.includes(p.id) && l.includes(JSON.stringify(SLOP))), `${who.address} sees the practice's id and text`);
    assert.ok(!citeList(view).some((l) => l.includes(p.id)), `${who.address} is never offered the practice to cite`);
  }
  for (const who of [s.leadA, s.cos]) assert.ok(citeList(s.e.inbox(who).text).some((l) => l.includes(rule.id)), "a real rule is still citable");
  assert.equal(practicesIn(s.e.inbox(s.steward).text), null, "the Steward does no project work: no practices");
});

test("with only practices, no empty 'may cite' header is printed", () => {
  const s = setup();
  practice(s);
  for (const who of [s.leadA, s.cos]) assert.doesNotMatch(s.e.inbox(who).text, /Standing rules you may cite/);
});

test("a project's practice reaches that project's lead and threads, and the CoS (who reminds every lead), not other leads", () => {
  const s = setup();
  const p = practice(s, "alpha");
  assert.ok(practicesIn(s.e.inbox(s.leadA).text)?.some((l) => l.includes(p.id)), "alpha's lead");
  assert.ok(practicesIn(s.e.inbox(s.worker).text)?.some((l) => l.includes(p.id)), "alpha's thread");
  const cos = practicesIn(s.e.inbox(s.cos).text);
  assert.ok(cos?.some((l) => l.includes(p.id) && l.includes("alpha")), "the CoS sees it, labelled with its project");
  assert.equal(practicesIn(s.e.inbox(s.leadB).text), null, "beta's lead doesn't");
});

test("citing a practice settles nothing: refused from the lead's orch_answer and the CoS's settle, and the card stays open", () => {
  const s = setup();
  const p = practice(s);
  const q = s.e.ask(s.worker, { title: "Ship?", question: "Ship the thing?", options: three });
  assert.throws(() => s.e.leadAnswer(s.leadA, q.id, p.id, "1", null), /is a standing practice.*settles nothing/);
  assert.equal(s.e.decision(q.id)!.state, "open");
  const c = s.e.ask(s.leadA, { title: "Ship?", question: "Ship the thing?", options: three });
  assert.throws(() => s.e.triageSettle(s.cos, c.id, p.id, "1", null), /is a standing practice.*settles nothing/);
  assert.equal(s.e.decision(c.id)!.state, "open");
});

test("a practice never settles a card by itself, even a row that also names a kind and carries a match", () => {
  const s = setup();
  // Only a row written by hand can look like this (addRule refuses it); the engine must still not settle with it.
  const match = { from: [s.worker.address], words: ["ship"], without: [], key_prefix: null, option: ["ship"] };
  const seed = (id: string, kinds: string[]) =>
    s.db.prepare(`INSERT INTO rules (id, text, project, kinds, expires_at, granted_by, source, created_at, match) VALUES (?, ?, NULL, ?, NULL, 'person', 'test', ?, ?)`).run(id, SLOP, JSON.stringify(kinds), s.now(), JSON.stringify(match));
  const two = [{ label: "Ship it" }, { label: "Wait" }]; // no word that keeps a card from every rule ("drop")
  seed("r-prac", ["practice", "question"]);
  const d = s.e.ask(s.worker, { title: "Ship?", question: "Ship the thing?", options: two });
  assert.equal(s.e.decision(d.id)!.state, "open", "the practice row didn't settle it");
  // control: the same row as a plain rule does settle, so the check above can fail
  s.e.revokeRule("r-prac");
  seed("r-ctl", ["question"]);
  const d2 = s.e.ask(s.worker, { title: "Ship?", question: "Ship the thing?", options: two });
  assert.equal(s.e.decision(d2.id)!.answer?.source, "rule r-ctl");
});

test("a revoked or expired practice drops out of every recovery view", () => {
  const s = setup();
  const gone = practice(s, null, "Revoked: run the linter in acme-api.");
  const brief = practice(s, null, "Expiring: tag acme-api releases.", s.now() + 60_000);
  const kept = practice(s);
  s.e.revokeRule(gone.id);
  s.advance(120_000);
  for (const who of [s.leadA, s.cos, s.worker]) {
    const sec = practicesIn(s.e.inbox(who).text) ?? [];
    assert.ok(!sec.some((l) => l.includes(gone.id)), "revoked");
    assert.ok(!sec.some((l) => l.includes(brief.id)), "expired");
    assert.ok(sec.some((l) => l.includes(kept.id)), "the live one stays");
  }
});
