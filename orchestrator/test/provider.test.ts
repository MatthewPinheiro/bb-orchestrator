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
