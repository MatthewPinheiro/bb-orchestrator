import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { EngineError } from "./model.ts";

type Providers = BbPluginApi["sdk"]["providers"];
type Target = { hostId: string; projectId?: string } | { environmentId: string } | { projectId: string };

/** Validate on the destination machine before spawning; never replace an explicit selection. */
export async function spawnSelection(providers: Providers, target: Target, choice: { provider?: string; model?: string; reasoning?: string }) {
  const providerId = choice.provider === undefined ? "claude-code" : choice.provider.trim();
  if (!providerId) throw new EngineError("invalid", "provider must not be empty");
  const model = choice.model?.trim();
  const reasoningLevel = choice.reasoning?.trim();
  const options = await providers.models({ ...target, providerId, preferCached: false });
  if (options.modelLoadError) throw new EngineError("bad_state", `cannot load ${providerId} models: ${options.modelLoadError.code}`);
  if (!options.providers.some((p) => p.id === providerId && p.available)) throw new EngineError("bad_state", `provider ${providerId} is unavailable on the destination`);
  const selected = model ? options.models.find((m) => (m.id === model || m.model === model) && (!m.routeProviderId || m.routeProviderId === providerId)) : options.models.find((m) => m.isDefault && (!m.routeProviderId || m.routeProviderId === providerId));
  if (!selected) throw new EngineError("bad_state", model ? `model ${model} is unavailable for ${providerId}` : `no default model for ${providerId}; select one explicitly`);
  if (reasoningLevel && selected.reasoningDiscovery === "known" && !selected.supportedReasoningEfforts.some((r) => r.reasoningEffort === reasoningLevel)) throw new EngineError("invalid", `reasoning ${reasoningLevel} is unsupported by ${providerId}/${model ?? selected.model}`);
  return { providerId, model: model ?? selected.model, ...(reasoningLevel ? { reasoningLevel } : {}) };
}
