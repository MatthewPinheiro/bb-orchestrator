// The AI player's server side (core/player.ts). What matters to the owner:
// - the API key is theirs and costs money: it must never reach the page, a log line or an error message, whatever fails;
// - the caps are what bounds the spend: the gap between calls, the calls per session and per day (kept across a reload),
//   and one call at a time, each checked before anything is sent;
// - with nothing set the player does nothing and says, in one line, what to set;
// - only the game screen and the checked game state go out, and only a whitelisted button comes back.
// The caps are written as literals here on purpose: a change to the defaults has to fail these tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUTTONS, createPlayer, type DayCount, OPTIONS, optionsFor, parseDotenv, type PlayerSettings, SETUP_LINE } from "../core/player.ts";

const KEY = "sk-test-0123456789abcdef-SECRET";
const KEY_FILE = "/owner/keys.env";

/** A real PNG header of the given size (the server reads only the signature and IHDR). */
function pngB64(w = 480, h = 320): string {
  const b = Buffer.alloc(64);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b.toString("base64");
}
const STATE = { game: "BPEE", screen: "overworld", map: { group: 0, num: 16, name: "ROUTE 101" }, position: { x: 8, y: 8 }, party: [{ species: "MUDKIP", level: 5, hp: 20, maxHp: 20 }], battle: null, textBox: false, controlsLocked: false };
const turnBody = (over: Record<string, unknown> = {}) => ({ session: "s-0000-1111-2222", screen: pngB64(), state: STATE, ...over });

const settings = (over: Partial<PlayerSettings> = {}): PlayerSettings => ({
  aiPlayerEndpoint: "https://decisions.example.test/v1/decide",
  aiPlayerModel: "model-x",
  aiPlayerKeyFile: KEY_FILE,
  aiPlayerKeyName: "DECISION_KEY",
  aiPlayerKey: "",
  aiPlayerHeaders: "X-Opt-In: yes",
  aiPlayerName: "Pilot",
  aiPlayerGapSeconds: 3,
  aiPlayerSessionCalls: 100,
  aiPlayerDayCalls: 500,
  ...over,
});

const answer = (input = "read the next text") =>
  new Response(JSON.stringify({ model: "m", answers: { input: { type: "choice", choice: input, confidence: 0.8, probabilities: {} } }, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });

function rig(over: { settings?: Partial<PlayerSettings>; fetch?: typeof fetch; files?: Record<string, string>; day?: DayCount | null; saveDay?: (d: DayCount) => void } = {}) {
  let t = Date.parse("2026-11-19T10:00:00Z");
  const logs: string[] = [];
  const sent: { url: string; init: RequestInit }[] = [];
  let day: DayCount | null = over.day ?? null;
  const files = over.files ?? { [KEY_FILE]: `# keys\nOTHER=nope\nexport DECISION_KEY="${KEY}"\n` };
  const s = settings(over.settings);
  const p = createPlayer({
    settings: () => s,
    fetch:
      over.fetch ??
      (async (url, init) => {
        sent.push({ url: String(url), init: init! });
        return answer();
      }),
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path]!;
    },
    home: "/owner",
    now: () => t,
    loadDay: () => day,
    saveDay: over.saveDay ?? ((d) => void (day = d)),
    log: (l) => logs.push(l),
  });
  return { p, logs, sent, s, advance: (ms: number) => void (t += ms), day: () => day };
}

test("a turn with no endpoint or no key is refused with the one setup line, and nothing is sent", async () => {
  for (const over of [{ aiPlayerEndpoint: "" }, { aiPlayerKeyFile: "", aiPlayerKeyName: "" }, { aiPlayerKeyName: "" }]) {
    const r = rig({ settings: over });
    const res = await r.p.turn(turnBody());
    assert.equal(res.status, 409, JSON.stringify(over));
    assert.equal(!res.body.ok && res.body.error.message, SETUP_LINE);
    assert.equal(r.sent.length, 0);
    assert.equal(r.p.info().ready, false);
    assert.equal(r.p.info().setup, SETUP_LINE);
  }
  assert.match(SETUP_LINE, /aiPlayerEndpoint/);
  assert.match(SETUP_LINE, /aiPlayerKeyFile/);
});

test("the key goes only into the Authorization header: never the page's answer, info, a log or an error", async () => {
  const r = rig();
  const ok = await r.p.turn(turnBody());
  assert.equal(ok.status, 200);
  assert.equal(r.sent.length, 1);
  const h = r.sent[0]!.init.headers as Record<string, string>;
  assert.equal(h.Authorization, `Bearer ${KEY}`);
  assert.equal(h["X-Opt-In"], "yes", "the owner's extra header is sent");
  assert.ok(!String(r.sent[0]!.init.body).includes(KEY), "the key is not in the request body");
  assert.ok(!JSON.stringify(ok).includes(KEY));
  assert.ok(!JSON.stringify(r.p.info()).includes(KEY));
  assert.ok(!JSON.stringify(r.p.info()).includes(KEY_FILE), "info doesn't hand the page the key file's path");

  // every way a call can fail, including errors that quote the key back
  const failures: (typeof fetch)[] = [
    async () => { throw new Error(`connect failed for Bearer ${KEY}`); },
    async () => new Response(`bad key ${KEY}`, { status: 401 }),
    async () => new Response(`{"answers":{"input":"${KEY}"}}`, { status: 200 }),
    async () => new Response("not json", { status: 200 }),
  ];
  for (const f of failures) {
    const x = rig({ fetch: f });
    const res = await x.p.turn(turnBody());
    assert.notEqual(res.status, 200);
    assert.ok(!JSON.stringify(res).includes(KEY), JSON.stringify(res));
    assert.ok(!x.logs.join("\n").includes(KEY), x.logs.join("\n"));
  }
  // a fault inside the turn itself, whose message quotes the key, is scrubbed from the answer and the log
  const y = rig({ saveDay: () => { throw new Error(`disk full near ${KEY}`); } });
  const res = await y.p.turn(turnBody());
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(res).includes(KEY) && !y.logs.join("\n").includes(KEY));
});

test("a missing key file or key name says which, without the file's contents", async () => {
  const a = rig({ files: {} });
  const ra = await a.p.turn(turnBody());
  assert.equal(ra.status, 409);
  assert.match(!ra.body.ok ? ra.body.error.message : "", /key file .* can't be read/);
  const b = rig({ files: { [KEY_FILE]: `OTHER=${KEY}\n` } });
  const rb = await b.p.turn(turnBody());
  assert.match(!rb.body.ok ? rb.body.error.message : "", /has no DECISION_KEY/);
  assert.ok(!JSON.stringify(rb).includes(KEY));
});

test("the secret key setting works in place of the file, and ~ in the file path is the home folder", async () => {
  const a = rig({ settings: { aiPlayerKey: "from-secret-setting", aiPlayerKeyFile: "", aiPlayerKeyName: "" } });
  assert.equal((await a.p.turn(turnBody())).status, 200);
  assert.equal((a.sent[0]!.init.headers as Record<string, string>).Authorization, "Bearer from-secret-setting");
  const b = rig({ settings: { aiPlayerKeyFile: "~/keys.env" } });
  assert.equal((await b.p.turn(turnBody())).status, 200);
});

test("calls closer than the gap are refused before anything is sent", async () => {
  const r = rig();
  assert.equal((await r.p.turn(turnBody())).status, 200);
  r.advance(2999);
  const res = await r.p.turn(turnBody());
  assert.equal(res.status, 429);
  assert.match(!res.body.ok ? res.body.error.message : "", /between calls/);
  assert.equal(r.sent.length, 1);
  r.advance(1);
  assert.equal((await r.p.turn(turnBody())).status, 200);
  assert.equal(r.sent.length, 2);
});

test("the session cap stops a session at exactly its count, and a new session may go on", async () => {
  const r = rig({ settings: { aiPlayerSessionCalls: 3 } });
  for (let i = 0; i < 3; i++) {
    assert.equal((await r.p.turn(turnBody())).status, 200, `call ${i + 1}`);
    r.advance(3000);
  }
  const res = await r.p.turn(turnBody());
  assert.equal(res.status, 429);
  assert.match(!res.body.ok ? res.body.error.message : "", /session's cap of 3/);
  assert.equal(r.sent.length, 3);
  assert.equal((await r.p.turn(turnBody({ session: "s-other-session-1" }))).status, 200);
});

test("the day cap holds across sessions and a reload (the count is on disk), and resets the next UTC day", async () => {
  const r = rig({ settings: { aiPlayerDayCalls: 2 }, day: { day: "2026-11-19", calls: 1 } });
  assert.equal((await r.p.turn(turnBody())).status, 200);
  r.advance(3000);
  const res = await r.p.turn(turnBody({ session: "s-fresh-session-9" }));
  assert.equal(res.status, 429);
  assert.match(!res.body.ok ? res.body.error.message : "", /today's cap of 2/);
  assert.deepEqual(r.day(), { day: "2026-11-19", calls: 2 });
  r.advance(24 * 3600_000);
  assert.equal((await r.p.turn(turnBody())).status, 200);
  assert.deepEqual(r.day(), { day: "2026-11-20", calls: 1 });
});

test("a failed call still counts against the caps, so errors can't loop past them", async () => {
  const r = rig({ settings: { aiPlayerDayCalls: 1 }, fetch: async () => new Response("", { status: 503 }) });
  assert.equal((await r.p.turn(turnBody())).status, 502);
  r.advance(3000);
  assert.equal((await r.p.turn(turnBody())).status, 429);
});

test("one call at a time: a second turn while one is in flight is refused", async () => {
  let release!: () => void;
  const gate = new Promise<void>((ok) => (release = ok));
  const r = rig({ settings: { aiPlayerGapSeconds: 0.001 }, fetch: async () => { await gate; return answer(); } });
  const first = r.p.turn(turnBody());
  r.advance(10);
  const second = await r.p.turn(turnBody());
  assert.equal(second.status, 429);
  assert.match(!second.body.ok ? second.body.error.message : "", /already running/);
  release();
  assert.equal((await first).status, 200);
});

test("defaults: 3 s between calls, 100 a session, 500 a day, when the settings are empty or nonsense", () => {
  const r = rig({ settings: { aiPlayerGapSeconds: 0, aiPlayerSessionCalls: -1, aiPlayerDayCalls: Number.NaN } });
  assert.deepEqual(r.p.info().caps, { gapSeconds: 3, session: 100, day: 500 });
});

test("only the screen and the checked state are sent; extra page fields are refused, not forwarded", async () => {
  const r = rig();
  await r.p.turn(turnBody());
  const body = JSON.parse(String(r.sent[0]!.init.body));
  assert.deepEqual(Object.keys(body).sort(), ["assets", "model", "questions", "state"]);
  assert.deepEqual(Object.keys(body.state).sort(), ["game", "recent", "screen"]);
  assert.deepEqual(body.state.game, STATE);
  const [ref, asset] = Object.entries(body.assets as Record<string, { type: string; format: string; data_base64: string }>)[0]!;
  assert.equal(body.state.screen, ref, "the screen is referenced from the state");
  assert.deepEqual([asset.type, asset.format, asset.data_base64], ["image", "png", pngB64()]);
  assert.deepEqual(Object.keys(body.questions.input.criteria), Object.keys(OPTIONS));
  assert.ok(Object.hasOwn(body.questions.input.criteria, "other"));
  assert.deepEqual(Object.keys(body.questions), ["input"], "one question a turn");

  const leak = await rig().p.turn(turnBody({ state: { ...STATE, cookie: "x" } }));
  assert.equal(leak.status, 400);
  const nested = await rig().p.turn(turnBody({ state: { ...STATE, party: [{ ...STATE.party[0], note: "x" }] } }));
  assert.equal(nested.status, 400);
  const notPng = await rig().p.turn(turnBody({ screen: Buffer.from("hello").toString("base64") }));
  assert.equal(notPng.status, 400);
});

test("the pick maps only to whitelisted buttons, its why is the option it picked, and an answer outside the options is refused", async () => {
  for (const [name, o] of Object.entries(OPTIONS)) for (const b of o.buttons) assert.ok((BUTTONS as readonly string[]).includes(b), `${name}: ${b}`);
  const every = new Set(Object.values(OPTIONS).flatMap((o) => o.buttons));
  assert.deepEqual([...every].sort(), [...BUTTONS].sort(), "every GBA button can be picked");
  const r = rig({ fetch: async () => answer("walk up to explore") });
  const res = await r.p.turn(turnBody());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.ok && [res.body.result.buttons, res.body.result.why, res.body.result.confidence], [["UP", "UP", "UP", "UP"], "walk up to explore", 0.8]);
  const other = await rig({ fetch: async () => answer("other") }).p.turn(turnBody());
  assert.deepEqual(other.body.ok && [other.body.result.buttons, other.body.result.why], [[], "none of these fits"]);
  const bad = rig({ fetch: async () => answer("TURBO") });
  assert.equal((await bad.p.turn(turnBody())).status, 502);
});

test("the last choices go back with each turn, with where they were made, so the model can see it's stuck", async () => {
  const r = rig();
  await r.p.turn(turnBody());
  r.advance(3000);
  await r.p.turn(turnBody());
  const body = JSON.parse(String(r.sent[1]!.init.body));
  assert.deepEqual(body.state.recent, [{ choice: "read the next text", map: "ROUTE 101", x: 8, y: 8, screen: "overworld", moved: false }]);
  r.advance(3000);
  await r.p.turn(turnBody({ state: { ...STATE, controlsLocked: true } }));
  assert.equal(JSON.parse(String(r.sent[2]!.init.body)).state.recent[1].screen, "overworld", "the second choice was made free to walk");
  r.advance(3000);
  await r.p.turn(turnBody({ state: { ...STATE, position: { x: 8, y: 12 } } }));
  const fourth = JSON.parse(String(r.sent[3]!.init.body));
  assert.deepEqual(fourth.state.recent.map((x: { moved: boolean }) => x.moved), [false, false, true], "a walk that got through says so");
  assert.equal(fourth.state.recent[2].screen, "menu or text", "a choice made with a menu up is told apart");
});

test("dotenv parsing: quotes, export and comments", () => {
  const m = parseDotenv(`# c\nexport A="x y"\nB='z'\nC=plain # note\n bad line\n`);
  assert.deepEqual([m.get("A"), m.get("B"), m.get("C"), m.size], ["x y", "z", "plain", 3]);
});

test("a walk that got nowhere isn't offered again from the same spot, so the player can't walk into a ledge for ever", async () => {
  const r = rig({ fetch: async (url, init) => { r.sent.push({ url: String(url), init: init! }); return answer("walk up to explore"); } });
  await r.p.turn(turnBody());
  r.advance(3000);
  await r.p.turn(turnBody()); // same spot: the walk up was blocked
  const offered = Object.keys(JSON.parse(String(r.sent[1]!.init.body)).questions.input.criteria);
  assert.ok(!offered.includes("walk up to explore") && !offered.includes("step up"), "up is left out");
  assert.ok(offered.includes("walk left to explore") && offered.includes("read the next text") && offered.includes("other"));
  // the model answering an option that wasn't offered is refused
  assert.equal(r.sent.length, 2);
  // once the player moves, every option is back
  const at = { x: 8, y: 8, map: "ROUTE 101" };
  const moved = optionsFor([{ choice: "walk up to explore", ...at, screen: "overworld", moved: true }], STATE as never);
  assert.deepEqual(moved, Object.keys(OPTIONS));
  // in a menu, text or a battle nothing is left out: a cursor press doesn't move the player. The Start menu reads as the
  // overworld with the field locked (seen in the harness), so that must count as a menu, not as a blocked walk.
  const all = Object.keys(OPTIONS);
  assert.deepEqual(optionsFor([{ choice: "step up", ...at, screen: "overworld", moved: false }], { ...STATE, screen: "battle" } as never), all);
  assert.deepEqual(optionsFor([{ choice: "step up", ...at, screen: "overworld", moved: false }], { ...STATE, controlsLocked: true } as never), all, "Start menu open now");
  assert.deepEqual(optionsFor([{ choice: "step up", ...at, screen: "overworld", moved: false }], { ...STATE, textBox: true } as never), all, "text up now");
  assert.deepEqual(optionsFor([{ choice: "step up", ...at, screen: "menu or text", moved: false }], STATE as never), all, "the press was a cursor move in a menu");
});

test("an answer outside the options offered this turn is refused", async () => {
  const r = rig({ fetch: async () => answer("walk up to explore") });
  await r.p.turn(turnBody());
  r.advance(3000);
  const second = await r.p.turn(turnBody());
  assert.equal(second.status, 502);
});

test("the page is told to wait only what's left of the gap after the call", async () => {
  let t!: { advance: (ms: number) => void };
  const r = rig({ fetch: async () => { t.advance(1200); return answer(); } });
  t = r;
  const res = await r.p.turn(turnBody());
  assert.equal(res.body.ok && res.body.result.nextInMs, 1800);
});
