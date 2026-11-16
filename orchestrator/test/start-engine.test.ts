// The owner's Start buttons, the engine's refusals: one live lead per project, one CoS, one Steward, nothing new on a held
// project. A second lead for a project would split its mail and its plan cards between two agents.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { EngineError } from "../core/model.ts";

function setup(pokemon = false) {
  const e = new Engine(new DatabaseSync(":memory:") as never, {
    now: () => Date.parse("2026-11-13T10:00:00Z"),
    deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }),
    mirror: () => {},
    changed: () => {},
    log: () => {},
  }, { pokemon });
  return e;
}

const refused = (kind: string) => (err: unknown) => err instanceof EngineError && err.kind === kind;

test("a project with no lead may start one; its address is lead:<slug>", () => {
  const e = setup();
  assert.equal(e.checkStart("lead", "alpha"), "lead:alpha");
});

test("a live lead refuses a second one, even when stopped or idle", () => {
  const e = setup();
  e.register("T-1", "lead", "alpha");
  assert.throws(() => e.checkStart("lead", "alpha"), refused("conflict"));
  e.setStatus("T-1", "stopped");
  assert.throws(() => e.checkStart("lead", "alpha"), refused("conflict"));
  assert.equal(e.checkStart("lead", "beta"), "lead:beta", "another project is not blocked");
});

test("a held project starts no lead until the owner resumes it", () => {
  const e = setup();
  e.ensureProject("alpha", null);
  e.setHold("alpha", true);
  assert.throws(() => e.checkStart("lead", "alpha"), refused("bad_state"));
  e.setHold("alpha", false);
  assert.equal(e.checkStart("lead", "alpha"), "lead:alpha");
});

test("one CoS and one Steward", () => {
  const e = setup();
  e.register("T-c", "cos", null);
  assert.throws(() => e.checkStart("cos", null), refused("conflict"));
  assert.equal(e.checkStart("steward", null), "steward");
});

test("threads never start from here, and a bad slug is refused", () => {
  const e = setup();
  assert.throws(() => e.checkStart("thread", "alpha"), refused("invalid"));
  assert.throws(() => e.checkStart("lead", "Not A Slug"), refused("invalid"));
  assert.throws(() => e.checkStart("lead", null), refused("invalid"));
});

test("an archived lead frees its address: the new one takes it over, and the old row is retired", () => {
  const e = setup();
  e.register("T-old", "lead", "alpha");
  e.setStatus("T-old", "archived");
  assert.equal(e.checkStart("lead", "alpha"), "lead:alpha");
  const a = e.registerStarted("T-new", "lead", "alpha");
  assert.equal(a.address, "lead:alpha");
  assert.equal(e.agentByAddress("lead:alpha")!.threadId, "T-new");
  assert.equal(e.agentByThread("T-old"), null);
});

test("registerStarted never displaces a live agent", () => {
  const e = setup();
  e.register("T-c", "cos", null);
  assert.throws(() => e.registerStarted("T-c2", "cos", null), refused("conflict"));
  assert.equal(e.agentByAddress("cos")!.threadId, "T-c");
});

test("the Pokémon named in the brief is the one the agent is registered with", () => {
  const e = setup(true);
  e.register("T-1", "lead", "alpha");
  const promised = e.monForStart("lead", "beta");
  assert.notEqual(promised, e.agentByThread("T-1")!.mon, "not one a live lead holds");
  assert.equal(e.registerStarted("T-2", "lead", "beta").mon, promised);
  assert.equal(e.monForStart("cos", null), "Rayquaza");
});

test("after an archived lead, the brief's Pokémon is still the one the new lead gets", () => {
  const e = setup(true);
  const old = e.register("T-old", "lead", "alpha");
  e.setStatus("T-old", "archived");
  const promised = e.monForStart("lead", "alpha");
  assert.ok(promised);
  assert.equal(promised, old.mon, "the archived lead's Pokémon is free again");
  assert.equal(e.registerStarted("T-new", "lead", "alpha").mon, promised);
});
