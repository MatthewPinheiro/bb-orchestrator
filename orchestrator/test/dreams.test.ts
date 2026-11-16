// The dream service's promises (gap 5): one card per nightly batch, never a second launch or card after a restart,
// pages published only on the owner's approval and with the exact publisher arguments, nothing published on a refusal, and
// a memory check that speaks once a day and only when it matters. Every memory tool is a fake port.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine } from "../core/engine.ts";
import { type Candidate, type DreamOptions, type DreamPorts, Dreams, type MemFacts, parseTimers, parseUnits, runId, unitSetenv, wallTime } from "../core/dreams.ts";

const ready = (run: string, slug: string): Candidate => ({ run, slug, ready: true, why: null, added: 3, removed: 1, lines: ["- a new fact"], diff: null, carried: false, promoted: false });
const refusedC = (run: string, slug: string): Candidate => ({ ...ready(run, slug), ready: false, why: "secret scan: 1 finding(s)" });

const TIMERS = parseTimers("notes-sync.timer=15 index-refresh.timer=180");

function setup(o: Partial<DreamOptions> = {}) {
  let clock = Date.parse("2026-11-14T06:00:00Z");
  const db = new DatabaseSync(":memory:");
  const up: string[] = [];
  const engine = new Engine(db as never, { now: () => clock, deliver: async () => ({ delivery: "sent" }), mirror: () => {}, changed: () => {}, log: () => {}, cardUp: (d) => up.push(d.id) });
  const launches: string[][] = [];
  const publishes: string[][] = [];
  const exits = new Map<string, { exit: number | null; out: string }>(); // `${date}-${job}`
  const runs = new Map<string, { picked: string[] | null; ran: boolean; candidates: Candidate[] }>();
  const healthy = (): MemFacts => ({ failed: [], timers: Object.keys(TIMERS).map((unit) => ({ unit, active: "active", last: clock })), vaultLastCommit: clock, errors: [] });
  let facts: () => MemFacts = healthy;
  const ports: DreamPorts = {
    now: () => clock,
    async launch(_b, _j, args) {
      launches.push(args);
      return "fake";
    },
    async publish(_b, _j, args) {
      publishes.push(args);
      return "fake";
    },
    poll: (b, j) => exits.get(`${b.date}-${j.name}`) ?? { exit: null, out: "" },
    results: (run) => runs.get(run) ?? { picked: null, ran: false, candidates: [] },
    memFacts: async () => facts(),
    log: () => {},
  };
  const opts: DreamOptions = { enabled: true, dailyAt: "07:00", zone: "UTC", carry: [], held: [], timers: TIMERS, ...o };
  const make = () => new Dreams(db as never, engine, ports, () => opts);
  return {
    engine, db, up, launches, publishes, exits, runs, opts, make, healthy,
    setFacts: (f: () => MemFacts) => (facts = f),
    at: (iso: string) => (clock = Date.parse(iso)),
    advance: (ms: number) => (clock += ms),
    dreamRows: () => engine.board().filter((r) => r.kind === "dream"),
    memRows: () => engine.board().filter((r) => r.kind === "memcheck"),
  };
}

/** Launch tonight's batch and let it end with these candidates. */
async function launchAndEnd(s: ReturnType<typeof setup>, d: Dreams, candidates: Candidate[], date = "2026-11-14") {
  s.at(`${date}T07:00:00Z`);
  await d.step();
  s.runs.set(runId(date), { picked: [...new Set(candidates.map((c) => c.slug))], ran: true, candidates });
  s.exits.set(`${date}-launch`, { exit: 0, out: "" });
  s.advance(60_000);
  await d.step();
}

test("one card per batch: a night with several ready pages puts exactly one approval card in the owner's Needs you", async () => {
  const s = setup();
  const d = s.make();
  const run = runId("2026-11-14");
  await launchAndEnd(s, d, [ready(run, "alpha"), ready(run, "beta"), refusedC(run, "gamma")]);
  for (let i = 0; i < 3; i++) {
    s.advance(60_000);
    await d.step();
  }
  const cards = s.engine.needsYou().cards;
  assert.equal(cards.length, 1, "one card for the whole batch, not one per page");
  const c = cards[0]!;
  assert.equal(c.orchestrator.asker, "orchestrator");
  assert.equal(c.orchestrator.at_level, "person", "it goes straight to the owner, no CoS triage");
  assert.deepEqual(c.ask!.options.map((o) => o.label), ["Publish the 2 ready pages", "Publish none"]);
  assert.equal(c.ask!.allow_text, false, "nothing here can act on a words answer");
  assert.match(c.ask!.context, /gamma.*secret scan/s, "refused pages are listed so the owner sees why");
  assert.equal(s.up.length, 1, "pushed to the owner once");
});

test("a night with no ready page files no card, only the digest", async () => {
  const s = setup();
  const d = s.make();
  const run = runId("2026-11-14");
  await launchAndEnd(s, d, [refusedC(run, "gamma")]);
  assert.equal(s.engine.needsYou().cards.length, 0);
  assert.equal(s.dreamRows().length, 1);
  assert.match(s.dreamRows()[0]!.body, /no page ready/);
});

test("no re-launch after a restart: a bb restart mid-batch neither launches again nor files a second card", async () => {
  const s = setup();
  await s.make().step(); // 06:00: not due
  assert.equal(s.launches.length, 0, "nothing before dailyAt");
  s.at("2026-11-14T07:00:00Z");
  await s.make().step();
  assert.equal(s.launches.length, 1);
  // restart while the launch still runs: a fresh service on the same store
  s.advance(30 * 60_000);
  await s.make().step();
  assert.equal(s.launches.length, 1, "the running launch is found in the store, not started again");
  // the launch ends; restart again after the card is filed
  const run = runId("2026-11-14");
  s.runs.set(run, { picked: ["alpha"], ran: true, candidates: [ready(run, "alpha")] });
  s.exits.set("2026-11-14-launch", { exit: 0, out: "" });
  await s.make().step();
  await s.make().step();
  assert.equal(s.launches.length, 1);
  assert.equal(s.engine.needsYou().cards.length, 1, "one card across restarts");
  // the same day later: still one batch; the next day: one new launch
  s.at("2026-11-14T22:00:00Z");
  await s.make().step();
  assert.equal(s.launches.length, 1);
  s.at("2026-11-15T07:05:00Z");
  await s.make().step();
  await s.make().step();
  assert.equal(s.launches.length, 2, "the next night launches once");
  assert.deepEqual(s.launches[1], ["--run", runId("2026-11-15"), "--auto", "5", "--total-minutes", "100"]);
});

test("the card's key makes filing idempotent: a crash between filing and saving the batch can't double-file", () => {
  const s = setup();
  const input = { title: "Publish 1 memory page?", question: "Publish?", options: [{ label: "Publish" }, { label: "Publish none" }], key: "memory:dream-2026-11-14", allowText: false };
  const a = s.engine.orchestratorAsk(input);
  const b = s.engine.orchestratorAsk(input);
  assert.equal(a.id, b.id);
  assert.equal(s.engine.needsYou().cards.length, 1);
});

test("publish only on approval, with the right args: each run's ready pages, the card's id, nothing refused", async () => {
  const s = setup({ carry: ["dream-2026-11-09-b"] });
  const run = runId("2026-11-14");
  s.runs.set("dream-2026-11-09-b", { picked: null, ran: true, candidates: [{ ...ready("dream-2026-11-09-b", "code-reviews"), carried: true }] });
  const d = s.make();
  await launchAndEnd(s, d, [ready(run, "alpha"), refusedC(run, "gamma"), ready(run, "beta")]);
  assert.deepEqual(s.launches[0], ["--run", run, "--auto", "5", "--total-minutes", "100", "--skip", "code-reviews"], "a carried page's project sits out tonight's run");
  s.advance(3600_000);
  await d.step();
  assert.equal(s.publishes.length, 0, "nothing is published while the card waits");
  const card = s.engine.needsYou().cards[0]!;
  s.engine.personDefer(card.id, card.rev, "1h", null, "desktop");
  await d.step();
  assert.equal(s.publishes.length, 0, "a deferral is not an approval");
  s.engine.personReturn(card.id, null);
  const fresh = s.engine.decision(card.id)!;
  s.engine.personAnswer(card.id, fresh.rev, "1", null, "desktop");
  await d.step();
  assert.deepEqual(s.publishes, [["--run", run, "--decision", card.id, "alpha", "beta"]], "tonight's run first, its ready pages in card order");
  s.exits.set("2026-11-14-publish-1", { exit: 0, out: '{"slug":"alpha","status":"published","commit":"abc"}\n{"slug":"beta","status":"published","commit":"def"}\n' });
  await d.step();
  assert.deepEqual(s.publishes[1], ["--run", "dream-2026-11-09-b", "--decision", card.id, "code-reviews"], "then the carried run, one job per run");
  s.exits.set("2026-11-14-publish-2", { exit: 1, out: '{"slug":"code-reviews","status":"refused","why":"vault page changed"}\n' });
  await d.step();
  await d.step();
  assert.equal(s.publishes.length, 2, "each job runs once");
  const digest = s.dreamRows();
  assert.equal(digest.length, 1, "one digest");
  assert.match(digest[0]!.body, /You approved; published alpha, beta; not published: code-reviews \(vault page changed\)/, "the digest is on the owner's own Board: \"You\" without ownerName");
  assert.equal(s.engine.decision(card.id)!.state, "acked", "the card is closed once acted on");
  assert.equal(s.make().batch("2026-11-14")!.state, "done");
});

test("a night skipped because the last batch still runs doesn't use up the carried runs", async () => {
  const s = setup({ dailyAt: "00:30" });
  s.runs.set("dream-2026-11-09-b", { picked: null, ran: true, candidates: [{ ...ready("dream-2026-11-09-b", "code-reviews"), carried: true }] });
  const d = s.make();
  s.at("2026-11-14T23:00:00Z");
  await d.start("2026-11-14"); // a late run-now; its launch is still running at the next night's dailyAt
  s.opts.carry = ["dream-2026-11-09-b"]; // The owner adds a run to carry meanwhile
  s.at("2026-11-15T00:30:00Z");
  await d.step();
  assert.equal(s.launches.length, 1, "no second batch while one still runs");
  assert.match(d.batch("2026-11-15")!.digest!, /still launching/);
  assert.deepEqual(d.batch("2026-11-15")!.carry, [], "the skipped night claimed nothing");
  assert.deepEqual(d.plan("2026-11-16").carry, ["dream-2026-11-09-b"], "so the next night that runs still carries it");
});

test("a refusal publishes nothing: 'Publish none' closes the batch with a digest and no publisher run", async () => {
  const s = setup();
  const run = runId("2026-11-14");
  const d = s.make();
  await launchAndEnd(s, d, [ready(run, "alpha")]);
  const card = s.engine.needsYou().cards[0]!;
  s.engine.personAnswer(card.id, card.rev, "2", null, "desktop");
  await d.step();
  await d.step();
  assert.equal(s.publishes.length, 0, "the publisher never runs");
  assert.match(s.dreamRows()[0]!.body, /publish none/);
  assert.equal(s.engine.decision(card.id)!.state, "acked");
  assert.equal(s.engine.needsYou().cards.length, 0);
});

test("memcheck reports once: the first check and each day with a problem show once on the Board; healthy days stay quiet", async () => {
  const s = setup();
  s.at("2026-11-14T07:00:00Z");
  const d = s.make();
  await d.step();
  await d.step();
  assert.equal(s.memRows().length, 1, "the very first check shows, so the owner knows it runs");
  assert.match(s.memRows()[0]!.title, /all well/);
  s.at("2026-11-15T07:00:00Z");
  await d.step();
  assert.equal(s.memRows().length, 1, "a healthy day says nothing");
  s.at("2026-11-16T07:00:00Z");
  s.setFacts(() => ({ ...s.healthy(), failed: ["notes-sync.service"], vaultLastCommit: Date.parse("2026-11-13T07:00:00Z") }));
  await d.step();
  s.advance(3600_000);
  await d.step();
  await s.make().step(); // and after a restart
  assert.equal(s.memRows().length, 2, "a bad day shows once, not every pass");
  assert.match(s.memRows()[0]!.body, /notes-sync.service has failed/);
  assert.match(s.memRows()[0]!.body, /vault's last commit is 72 h old/);
});

test("dreams off (the default on the live install): no launch and no memory check", async () => {
  const s = setup({ enabled: false });
  s.at("2026-11-14T07:30:00Z");
  await s.make().step();
  assert.equal(s.launches.length, 0);
  assert.equal(s.memRows().length, 0);
});

test("dailyAt is read in the dream zone", () => {
  assert.equal(new Date(wallTime("UTC", "2026-11-14", "07:00")).toISOString(), "2026-11-14T07:00:00.000Z");
  assert.equal(new Date(wallTime("America/New_York", "2026-11-14", "07:00")).toISOString(), "2026-11-14T12:00:00.000Z");
  assert.equal(new Date(wallTime("America/New_York", "2026-07-14", "07:30")).toISOString(), "2026-07-14T11:30:00.000Z");
});

test("a dream job's systemd-run argv carries only named non-secret variables: argv is readable by any process on the host", () => {
  const sets = unitSetenv({ MEMORY_CONFIG: "/c.json", PATH: "/bin", HOME: "/h", GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x", BB_ACCOUNT_POOL_PARENT_TOKEN: "y", ANTHROPIC_API_KEY: "z" }, "MEMORY_CONFIG");
  assert.deepEqual(sets, ["--setenv=MEMORY_CONFIG=/c.json", "--setenv=PATH=/bin", "--setenv=HOME=/h"]);
  assert.deepEqual(unitSetenv({ MEMORY_CONFIG: "/c.json", PATH: "/bin" }), ["--setenv=PATH=/bin"], "no config variable named: the path isn't passed");
});

test("with ownerName set, the dream digest on the Board names the owner instead of \"You\"", async () => {
  const s = setup({ owner: "Sam" });
  const run = runId("2026-11-14");
  const d = s.make();
  await launchAndEnd(s, d, [ready(run, "alpha")]);
  s.advance(3600_000);
  await d.step();
  const card = s.engine.needsYou().cards[0]!;
  s.engine.personAnswer(card.id, card.rev, "1", null, "desktop");
  await d.step();
  s.exits.set("2026-11-14-publish-1", { exit: 0, out: '{"slug":"alpha","status":"published","commit":"abc"}\n' });
  await d.step();
  await d.step();
  assert.match(s.dreamRows()[0]!.body, /Sam approved; published alpha/, "the server passes ownerName through DreamOptions.owner");
});

test("the memory check watches only the units and timers its settings name: none by default", () => {
  assert.deepEqual(parseTimers(""), {});
  assert.deepEqual(parseTimers("a.timer=15, b.timer=0.5 junk c.service=3"), { "a.timer": 900_000, "b.timer": 30_000 }, "only <unit>.timer=<minutes>");
  assert.deepEqual(parseUnits(""), []);
  assert.deepEqual(parseUnits("notes-* idx-*.timer, $(id) --all"), ["notes-*", "idx-*.timer"], "a pattern never carries shell or flag syntax");
});
