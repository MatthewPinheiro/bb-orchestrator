// The Projects tab's agent lanes (app/lanes.ts): the owner sees at a glance who works, who waits on them, and on what.
// The lanes come from the engine's live agents and its owner cards, so these tests drive a real engine where it matters.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import type { Agent } from "../core/model.ts";
import type { Agents, NeedsYou } from "../contract.ts";
import { age, buildLanes, laneFor, modelLabel, projectOrder } from "../app/lanes.ts";

function setup() {
  let clock = Date.parse("2026-11-16T10:00:00Z");
  const e = new Engine(new DatabaseSync(":memory:") as never, {
    now: () => clock,
    async deliver(): Promise<DeliverResult> {
      return { delivery: "sent" };
    },
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  const cos = e.register("T-cos", "cos", null);
  const lead = e.register("T-la", "lead", "alpha", "T-cos");
  return { e, cos, lead, advance: (ms: number) => (clock += ms), now: () => clock };
}

/** What the agents read gives for an engine agent (server.ts), with bb's side left empty. */
function row(a: Agent, over: Partial<Agents[number]> = {}): Agents[number] {
  return {
    threadId: a.threadId,
    address: a.address,
    role: a.role,
    monType: null,
    project: a.project,
    priority: null,
    held: false,
    status: a.status,
    engineStatus: a.status,
    idleAt: a.idleAt,
    title: null,
    lastReport: null,
    provider: null,
    mon: null,
    form: null,
    level: 1,
    xp: 0,
    xpThis: 0,
    xpNext: 1,
    model: null,
    usedTokens: null,
    contextWindow: null,
    branch: null,
    pr: null,
    unread: false,
    flags: [],
    ...over,
  };
}

/** The owner's cards as the needsYou read gives them: the fields lanes read. */
function needsOf(e: Engine, extra: Partial<NeedsYou> = {}): NeedsYou {
  const v = e.needsYou();
  const card = (d: (typeof v.cards)[number]) => ({ id: d.id, asker: d.orchestrator.asker, origin: d.orchestrator.origin, askedAt: d.ask?.at ?? d.created_at }) as unknown as NeedsYou["cards"][number];
  return { cards: v.cards.map(card), deferred: v.deferred.map(card), triaging: [], interactions: [], presets: [], badge: v.cards.length, ...extra };
}

const three = [{ label: "One" }, { label: "Two" }, { label: "Three" }];

test("a retired thread gets no lane: once its work is over it must not look like it still works on the project", () => {
  const s = setup();
  const t1 = s.e.register("T-1", "thread", "alpha", "T-la");
  s.e.register("T-2", "thread", "alpha", "T-la");
  s.e.setStatus(t1.threadId, "archived"); // bb archived it: its role retires
  const lanes = buildLanes(s.e.agents().map((a) => row(a)), needsOf(s.e));
  assert.deepEqual(lanes.get("alpha")!.map((l) => l.agent.address), ["lead:alpha", "thread:alpha:2"]);
});

test("a thread's question the lead forwarded to the owner puts both lanes on 'waits on you', linked to that card", () => {
  const s = setup();
  const t1 = s.e.register("T-1", "thread", "alpha", "T-la");
  const t2 = s.e.register("T-2", "thread", "alpha", "T-la");
  const q = s.e.ask(t2, { title: "Port?", question: "Which port?", options: three });
  s.e.forward(s.lead, q.id, null);
  s.e.triageAskPerson(s.cos, q.id, { question: "Which port?", options: three, allowText: true });
  s.advance(5 * 60_000);
  const lanes = buildLanes(s.e.agents().map((a) => row(a)), needsOf(s.e)).get("alpha")!;
  const by = new Map(lanes.map((l) => [l.agent.address, l]));
  assert.equal(by.get(t2.address)!.state, "waiting", "the thread that first asked waits");
  assert.equal(by.get("lead:alpha")!.state, "waiting", "and the lead that asked the owner");
  assert.deepEqual(by.get(t2.address)!.wait, { on: "owner", cardId: q.id, threadId: null }, "the lane links to the very card");
  assert.equal(by.get(t1.address)!.state, "idle", "a thread that asked nothing doesn't");
  assert.equal(age(by.get(t2.address)!.since, s.now()), "5m", "waiting since the card was asked");
  // waiting lanes first; among them the lead before its threads
  assert.deepEqual(lanes.map((l) => l.agent.address), ["lead:alpha", t2.address, t1.address]);
});

test("a deferred card doesn't make a lane wait: the owner said not now, and Needs me shows only what needs them now", () => {
  const s = setup();
  const q = s.e.ask(s.lead, { title: "Ship?", question: "Ship it?", options: three });
  s.e.triageAskPerson(s.cos, q.id, { question: "Ship it?", options: three, allowText: true });
  const v = needsOf(s.e);
  const deferred = { ...v, cards: [], deferred: v.cards, badge: 0 };
  assert.equal(buildLanes(s.e.agents().map((a) => row(a)), deferred).get("alpha")![0]!.state, "idle");
});

test("a thread waiting on its own prompt (a native question) waits on the owner too, linked to that prompt", () => {
  const s = setup();
  const t1 = s.e.register("T-1", "thread", "alpha", "T-la");
  const needs = needsOf(s.e, { interactions: [{ id: "ix1", threadId: t1.threadId, address: t1.address, title: "t", kind: "user_question", since: null, questions: [] }] });
  const lane = buildLanes(s.e.agents().map((a) => row(a)), needs).get("alpha")!.find((l) => l.agent.address === t1.address)!;
  assert.deepEqual(lane.wait, { on: "owner", cardId: null, threadId: t1.threadId });
});

test("projects with a lane waiting on the owner sort first, ahead of a higher priority: that is where they are needed", () => {
  const s = setup();
  const leadB = s.e.register("T-lb", "lead", "beta", "T-cos");
  const q = s.e.ask(leadB, { title: "Ship?", question: "Ship it?", options: three });
  s.e.triageAskPerson(s.cos, q.id, { question: "Ship it?", options: three, allowText: true });
  const lanes = buildLanes(s.e.agents().map((a) => row(a)), needsOf(s.e));
  const projects = [
    { slug: "alpha", priority: "urgent" as const },
    { slug: "beta", priority: "low" as const },
    { slug: "gamma", priority: "high" as const },
  ];
  assert.deepEqual([...projects].sort(projectOrder(lanes)).map((p) => p.slug), ["beta", "alpha", "gamma"]);
});

test("threads sort by number, so thread 10 comes after thread 2", () => {
  const s = setup();
  for (let i = 1; i <= 10; i++) s.e.register(`T-${i}`, "thread", "alpha", "T-la");
  const order = buildLanes(s.e.agents().map((a) => row(a)), needsOf(s.e)).get("alpha")!.map((l) => l.agent.address);
  assert.deepEqual(order.slice(0, 3), ["lead:alpha", "thread:alpha:1", "thread:alpha:2"]);
  assert.equal(order.at(-1), "thread:alpha:10");
});

test("a stopped or bb-archived agent shows released and waits on nothing, even with its PR still open", () => {
  const s = setup();
  const pr = { url: "https://example.com/pr/1", number: 1, state: "open", attention: "review_requested", checks: "pending", review: "review_required" };
  const lane = laneFor(row(s.lead, { status: "idle", engineStatus: "archived", pr }), undefined);
  assert.equal(lane.state, "released");
  assert.equal(lane.wait, null);
});

test("what a lane waits on comes from its PR: running checks are CI, a review still to come is a reviewer, a merged PR is nothing", () => {
  const s = setup();
  const base = { url: "https://example.com/pr/2", number: 2, attention: null, review: null } as const;
  const wait = (pr: Partial<NonNullable<Agents[number]["pr"]>>) => laneFor(row(s.lead, { pr: { ...base, state: "open", checks: "passing", ...pr } }), undefined).wait;
  assert.deepEqual(wait({ checks: "pending" }), { on: "ci" });
  assert.deepEqual(wait({ state: "draft", checks: "pending" }), { on: "ci" });
  assert.deepEqual(wait({ review: "review_required" }), { on: "review" });
  assert.equal(wait({ review: "approved" }), null, "approved and green: the agent's move");
  assert.equal(wait({ review: "changes_requested" }), null, "changes requested: the agent's move");
  assert.equal(wait({ state: "merged", checks: "pending" }), null);
});

test("state and since: a failed turn is blocked, a running one working (no since: nothing tracks it), idle since it went idle", () => {
  const s = setup();
  s.e.setStatus(s.lead.threadId, "idle");
  const idle = s.e.agentByThread(s.lead.threadId)!;
  const l = laneFor(row(idle), undefined);
  assert.equal(l.state, "idle");
  assert.equal(l.since, s.now());
  assert.equal(laneFor(row(idle, { status: "active", engineStatus: "active", idleAt: null }), undefined).since, null);
  assert.equal(laneFor(row(idle, { status: "active", engineStatus: "active" }), undefined).state, "working");
  assert.equal(laneFor(row(idle, { status: "error", engineStatus: "error" }), undefined).state, "blocked");
});

test("the activity line is the bb title, else the last report; the model reads as a family, else the provider", () => {
  const s = setup();
  assert.equal(laneFor(row(s.lead, { title: "Fix the port", lastReport: "Done" }), undefined).activity, "Fix the port");
  assert.equal(laneFor(row(s.lead, { lastReport: "Done" }), undefined).activity, "Done");
  s.e.report(s.lead, "Shipped the fix", "", null);
  assert.equal(s.e.lastReport("lead:alpha"), "Shipped the fix");
  assert.equal(modelLabel("claude-opus-5-5", "claude-code"), "Opus");
  assert.equal(modelLabel("claude-sonnet-5-5", null), "Sonnet");
  assert.equal(modelLabel("gpt-6.1-sol", null), "Codex");
  assert.equal(modelLabel(null, "codex"), "Codex");
  assert.equal(modelLabel(null, "claude-code"), "Claude", "bb's Claude provider id, before the first turn reports a model");
  assert.equal(modelLabel(null, null), null);
});

test("the review decision reaches the lane's PR chip from pr-watch's signature", () => {
  const s = setup();
  s.e.setEnvironment(s.lead.threadId, "env1");
  const a = s.e.agentByThread(s.lead.threadId)!;
  s.e.prSeen(a, "env1", { outcome: "available", pullRequest: { url: "https://example.com/pr/3", number: 3, state: "open", attention: "none", checks: { state: "passing" }, review: { state: "approved" }, mergeability: { mergeable: "MERGEABLE", state: "mergeable" } } } as never);
  assert.equal(s.e.prFor("env1")!.review, "approved");
});

test("a restart's status re-report keeps when an agent went idle, so its lane doesn't read 'idle <1m' after every reinstall", () => {
  const s = setup();
  s.e.setStatus(s.lead.threadId, "idle");
  const wentIdle = s.now();
  s.advance(3 * 3600_000);
  s.e.setStatus(s.lead.threadId, "idle"); // the clock's startup reconcile reports bb's status again
  assert.equal(s.e.agentByThread(s.lead.threadId)!.idleAt, wentIdle);
  s.e.setStatus(s.lead.threadId, "active");
  s.advance(60_000);
  s.e.setStatus(s.lead.threadId, "idle");
  assert.equal(s.e.agentByThread(s.lead.threadId)!.idleAt, s.now(), "a new turn's end is a new idle");
});
