// The Projects row's words and order (2026-11-16, the command center). The owner scans the tab top-down, so what is
// most pressing must come first (needs you, blocked, the longest wait), each row must say one state, and a wait must say
// who or what in plain words with how long and whether the lead said it or the plugin read it live. Two wait lines per
// row: more would push the next project off the phone screen, so the rest fold into a line naming the oldest.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Projects, SummaryWait } from "../contract.ts";
import { attentionOrder, directShown, directState, followUpOf, isQuiet, leadHead, matches, outOfDateLine, pickWaits, quietWords, seenUpTo, stateOf, threadSprites, waitLine } from "../app/command-center.ts";
import type { Lane } from "../app/lanes.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const H = 3_600_000;
const wait = (w: Partial<SummaryWait>): SummaryWait => ({ source: "live", kind: "card", ref: null, who: null, label: null, since: null, unchanged: false, note: null, ...w });
type P = Projects[number];
const project = (slug: string, x: Partial<P> & { motion?: NonNullable<P["summary"]>["motion"]; waits?: SummaryWait[]; you?: number } = {}): P => ({
  slug,
  priority: "normal",
  heldAt: null,
  archivedAt: null,
  lead: { address: `lead:${slug}`, threadId: `T-${slug}`, status: "idle", mon: null },
  threads: 0,
  openPlans: 0,
  status: null,
  monType: null,
  summary: {
    motion: x.motion ?? "quiet",
    threads: { working: 0, total: 0 },
    leadWorking: false,
    needsYou: { count: x.you ?? 0, id: null, title: null, question: null, since: null },
    waits: x.waits ?? [],
    blockers: x.status?.blockers ?? [],
    statusOutOfDate: false,
    done: null,
    last: null,
    leadIdleSince: null,
  },
  ...x,
});
const status = (blockers: string[] = []): NonNullable<P["status"]> => ({ goal: "g", steps: [{ title: "Build", state: "current" }], waitingOn: { kind: "none", ref: null, label: null }, blockers, updatedAt: NOW, by: "lead:x" });

test("a wait reads as who, then what, then its age and its source; a PR reading's age says 'unchanged', never 'for'", () => {
  const card = waitLine(wait({ kind: "card", label: "Pick a name?", since: NOW - 5 * H }), NOW, "CoS");
  assert.equal(card.text, "your answer: Pick a name?");
  assert.equal(card.tail, "for 5h · live");
  assert.equal(card.old, true, "over 4 h: the amber dot");
  const review = waitLine(wait({ kind: "review", who: "PR #41", since: NOW - 18 * H, unchanged: true }), NOW, "CoS");
  assert.equal(review.text, "a review of PR #41");
  assert.equal(review.tail, "unchanged 18h · live");
  const lead = waitLine(wait({ source: "lead", kind: "colleague", who: "Sam", label: "the design sign-off", since: NOW - H }), NOW, "CoS");
  assert.equal(lead.text, "Sam: the design sign-off");
  assert.equal(lead.tail, "for 1h · lead said");
  assert.equal(lead.old, false);
  assert.equal(waitLine(wait({ kind: "reply", who: "cos", label: "keys?" }), NOW, "Chief").text, "a reply from the Chief: keys?", "the CoS by its title on this page");
  const failed = waitLine(wait({ source: "lead", kind: "thread", ref: "thread:x:2", label: "numbers", note: "the thread failed", since: NOW - H }), NOW, "CoS");
  assert.equal(failed.note, "the thread failed", "a wait that still stands says what a live fact adds");
});

// Answered and stale items drop off (2026-11-16, the owner): a blocker an answer covered is no blocker anywhere on the
// row (state, filter, order, Quiet), and the row says once that the status is out of date instead of striking lines.
test("a blocker an answer covered doesn't make the row Blocked, and a contradicted status gets one quiet line", () => {
  const covered = project("a", { status: status(["Staging cloud login expired"]) });
  covered.summary = { ...covered.summary!, blockers: [], statusOutOfDate: true };
  assert.equal(stateOf(covered, undefined), "quiet");
  assert.equal(matches("blocked", covered, undefined), false);
  assert.equal(isQuiet(covered, undefined), true);
  assert.equal(outOfDateLine(covered), "Status out of date: asked the lead to refresh");
  assert.equal(outOfDateLine({ ...covered, heldAt: NOW }), "Status out of date", "a held project's lead isn't asked");
  assert.equal(outOfDateLine(project("b")), null);
});

test("a quiet row without a status names the latest finished thing and its age, else since when the lead idles", () => {
  const p = project("q");
  assert.equal(quietWords({ ...p, summary: { ...p.summary!, last: { text: "Shipped the export", at: NOW - 3 * H } } }, NOW), "Shipped the export · 3h ago");
  assert.match(quietWords({ ...p, summary: { ...p.summary!, leadIdleSince: NOW - 26 * H } }, NOW), /^idle since /);
  assert.notEqual(quietWords(p, NOW), "no status from the lead");
});

const lane = (n: number, state: Lane["state"]): Lane => ({ agent: { address: `thread:x:${n}`, role: "thread", threadId: `T${n}`, mon: "Pichu", form: null } as never, state, since: null, activity: null, model: null, wait: null });
test("the threads line shows working sprites first, idle ones after, six at most and then +N", () => {
  const s = threadSprites([lane(1, "idle"), lane(2, "working"), lane(3, "idle"), lane(4, "working"), lane(5, "idle"), lane(6, "idle"), lane(7, "idle"), lane(8, "released")]);
  assert.deepEqual(s.shown.map((l) => l.agent.address), ["thread:x:2", "thread:x:4", "thread:x:1", "thread:x:3", "thread:x:5", "thread:x:6"]);
  assert.equal(s.more, 1, "seven live threads: six drawn, +1; a released one isn't counted");
});

test("the row head names the lead's Pokémon and the project's type; with the setting off a neutral head", () => {
  const on = { ...project("p"), lead: { address: "lead:p", threadId: "T", status: "idle", mon: "Abra" }, monType: "psychic" } as P;
  assert.deepEqual(leadHead(on), { mon: "Abra", name: "Abra", type: "Psychic" });
  assert.deepEqual(leadHead(project("p")), { mon: null, name: "lead", type: null }, "pokemon off: no mon, no type (MonSprite draws the role avatar)");
});

test("two waits show: the lead's own first, then the longest live one; the rest fold and name the oldest of them", () => {
  const waits = [wait({ kind: "ci", since: NOW - H }), wait({ kind: "card", since: NOW - 20 * H }), wait({ source: "lead", kind: "deploy", since: NOW - 60_000 }), wait({ kind: "review", since: NOW - 30 * H })];
  const p = pickWaits(waits, NOW);
  assert.deepEqual(p.shown.map((w) => w.kind), ["deploy", "review"]);
  assert.equal(p.more, 2);
  assert.equal(p.oldest?.kind, "card", "the folded line keeps the oldest hidden wait's age");
});

test("one state per row, the most pressing first: needs you over blocked over hold over motion", () => {
  assert.equal(stateOf(project("a", { you: 1, status: status(["CI red"]), heldAt: NOW }), undefined), "you");
  assert.equal(stateOf(project("a", { status: status(["CI red"]), motion: "moving" }), undefined), "blocked");
  assert.equal(stateOf(project("a", { heldAt: NOW, motion: "moving" }), undefined), "held");
  assert.equal(stateOf(project("a", { lead: null, motion: "nolead" }), undefined), "nolead");
  assert.equal(stateOf(project("a", { motion: "waiting" }), undefined), "waiting");
});

test("rows by attention: needs you, blocked, the longest wait, moving, quiet; a folded quiet row has nothing to say", () => {
  const ps = [
    project("quiet-one"),
    project("moving-one", { motion: "moving" }),
    project("short-wait", { motion: "waiting", waits: [wait({ since: NOW - H })] }),
    project("long-wait", { motion: "moving", waits: [wait({ since: NOW - 9 * H })] }),
    project("blocked-one", { status: status(["no keys"]) }),
    project("asks-you", { you: 1 }),
  ];
  assert.deepEqual(ps.sort(attentionOrder(new Map(), NOW)).map((p) => p.slug), ["asks-you", "blocked-one", "long-wait", "short-wait", "moving-one", "quiet-one"]);
  assert.equal(isQuiet(project("q"), undefined), true);
  assert.equal(isQuiet(project("q", { waits: [wait({})] }), undefined), false);
  assert.equal(matches("waits", project("q", { waits: [wait({})] }), undefined), true);
  assert.equal(matches("blocked", project("q", { status: status(["x"]) }), undefined), true);
});

// The "You:" lines (PLAN 3.4): the owner must see whether the lead took the message, and an old settled exchange must
// not keep a quiet project on the main list. "Acked" is the word for taken; the note says whether it is finished.
const msg = (x: Partial<NonNullable<P["direct"]>["messages"][number]>) => ({ id: "i-1", text: "t", at: NOW - H, followUp: null, state: "delivered", outcome: null, note: null, answeredAt: null, unread: false, ...x });
test("the row shows a message while unanswered or in force, says acked for taken, and points a dead one at the CoS", () => {
  const open = msg({ id: "i-open", at: NOW - 72 * H, state: "dead" });
  const old = msg({ id: "i-old", at: NOW - 60 * H, state: "closed", outcome: "done", note: "Done long ago", answeredAt: NOW - 59 * H });
  const fresh = msg({ id: "i-new", at: NOW - H, state: "closed", outcome: "done", note: "Taken" });
  assert.deepEqual(directShown({ messages: [fresh, open, old], unread: false }, NOW).map((m) => m.id), ["i-new", "i-open"], "a settled one over 48 h old goes");
  const oldUnread = { ...old, unread: true };
  assert.deepEqual(directShown({ messages: [fresh, open, oldUnread], unread: true }, NOW).map((m) => m.id), ["i-new", "i-old"], "an unread answer is always drawn, the rest fill up to two");
  assert.equal(directShown({ messages: [{ ...fresh, unread: true }, open, oldUnread, { ...old, id: "i-old2", unread: true }], unread: true }, NOW).length, 3, "every unread answer, past the two-line limit");
  assert.equal(seenUpTo({ messages: [fresh, oldUnread], unread: true }), oldUnread.answeredAt, "opening marks seen up to the newest answer drawn unread, no further");
  assert.deepEqual(directState(fresh, "CoS"), { word: "acked", dead: false });
  assert.deepEqual(directState(msg({ state: "closed", outcome: "refused" }), "CoS"), { word: "refused", dead: false });
  assert.deepEqual(directState(open, "Chief"), { word: "no ack · with the Chief", dead: true });
  assert.equal(followUpOf({ messages: [fresh], unread: false }, NOW)?.id, "i-new");
  assert.equal(followUpOf({ messages: [old], unread: false }, NOW), null, "past 48 h a new message starts fresh");
  assert.equal(isQuiet(project("q", { direct: { messages: [open], unread: false } }), undefined, NOW), false, "an unanswered message keeps the row on the main list");
  assert.equal(isQuiet(project("q", { direct: { messages: [old], unread: false } }), undefined, NOW), true);
});

test("a quiet row with a status still names the latest finished thing and its age, and a contradicted status", async () => {
  const { quietLine } = await import("../app/command-center.ts");
  const p = project("q", { status: status() });
  const done = { ...p, summary: { ...p.summary!, last: { text: "Shipped the export", at: NOW - 2 * H } } };
  assert.equal(quietLine(done, NOW), "step 1 of 1: Build · Shipped the export · 2h ago");
  const odd = { ...done, summary: { ...done.summary!, statusOutOfDate: true } };
  assert.equal(quietLine(odd, NOW), "step 1 of 1: Build · Shipped the export · 2h ago · status out of date: asked the lead to refresh");
  assert.equal(quietLine(project("n"), NOW), "idle", "no status, nothing finished, no idle time");
});
