import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSelection } from "../core/provider.ts";

function catalog(over: Record<string, unknown> = {}) {
  const calls: unknown[] = [];
  const providers = { models: async (p: unknown) => {
    calls.push(p);
    return { modelLoadError: null, providers: [{ id: "codex", available: true }], models: [{ id: "gpt-6-astra", model: "gpt-6-astra", isDefault: true, reasoningDiscovery: "known", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }], ...over };
  } };
  return { calls, providers: providers as unknown as Parameters<typeof spawnSelection>[0] };
}

test("selection validates on the target host and preserves explicit provider/model/reasoning", async () => {
  const c = catalog();
  assert.deepEqual(await spawnSelection(c.providers, { hostId: "h1", projectId: "p1" }, { provider: "codex", model: "gpt-6-astra", reasoning: "high" }), { providerId: "codex", model: "gpt-6-astra", reasoningLevel: "high" });
  assert.deepEqual(c.calls, [{ hostId: "h1", projectId: "p1", providerId: "codex", preferCached: false }]);
});

test("missing models, unavailable providers, catalog errors and unsupported reasoning fail closed", async () => {
  for (const [over, choice, why] of [
    [{}, { provider: "codex", model: "missing" }, /model missing is unavailable/],
    [{ providers: [{ id: "codex", available: false }] }, { provider: "codex" }, /provider codex is unavailable/],
    [{ modelLoadError: { code: "auth_required" } }, { provider: "codex" }, /auth_required/],
    [{}, { provider: "codex", reasoning: "unsupported" }, /reasoning unsupported/],
    [{ models: [] }, { provider: "codex" }, /select one explicitly/],
    [{}, { provider: " " }, /must not be empty/],
  ] as const) {
    const c = catalog(over);
    await assert.rejects(spawnSelection(c.providers, { environmentId: "env" }, choice), why);
  }
});

test("a model routed to another provider is not a silent provider fallback", async () => {
  const c = catalog({ models: [{ id: "gpt-6-astra", model: "gpt-6-astra", routeProviderId: "other" }] });
  await assert.rejects(spawnSelection(c.providers, { projectId: "p" }, { provider: "codex", model: "gpt-6-astra" }), /unavailable/);
});

// A catalog that can't be read must not stop the owner's ordinary starts (the Projects tab's Start buttons, a lead's
// plan threads without a choice): those spawn as they did before the check, with a warning. Only a choice someone made
// is held to what the catalog confirms.
test("a start with the defaults fails open with a warning when the catalog throws, errors or lacks the default", async () => {
  const down = { models: async () => { throw new Error("host offline"); } } as unknown as Parameters<typeof spawnSelection>[0];
  const startButton = { provider: "claude-code", model: "claude-opus-5-5", reasoning: "high" }; // the lead Start button's settings
  for (const providers of [down, catalog({ modelLoadError: { code: "auth_required" } }).providers, catalog().providers]) {
    const warned: string[] = [];
    assert.deepEqual(
      await spawnSelection(providers, { hostId: "h", projectId: "p" }, startButton, { defaults: startButton, warn: (m) => warned.push(m) }),
      { providerId: "claude-code", model: "claude-opus-5-5", reasoningLevel: "high" },
    );
    assert.equal(warned.length, 1, "the fail-open is never silent");
    const plain: string[] = [];
    assert.deepEqual(await spawnSelection(providers, { projectId: "p" }, {}, { defaults: {}, warn: (m) => plain.push(m) }), { providerId: "claude-code" }, "no choice: bb picks its default model");
    assert.equal(plain.length, 1);
  }
});

test("an explicit choice is still refused when the catalog can't confirm it, defaults or not", async () => {
  const down = { models: async () => { throw new Error("host offline"); } } as unknown as Parameters<typeof spawnSelection>[0];
  const defaults = { provider: "claude-code", model: "claude-opus-5-5", reasoning: "high" };
  await assert.rejects(spawnSelection(down, { projectId: "p" }, { ...defaults, model: "claude-typo" }, { defaults }), /host offline/, "a changed setting is a choice");
  await assert.rejects(spawnSelection(catalog().providers, { projectId: "p" }, { provider: "codex", model: "missing" }, { defaults: {} }), /model missing is unavailable/);
  await assert.rejects(spawnSelection(down, { environmentId: "e" }, { provider: "codex" }), /host offline/, "a handoff names its provider: no fail-open");
  await assert.rejects(spawnSelection(catalog().providers, { projectId: "p" }, { provider: " " }, { defaults: {} }), /must not be empty/);
});
