import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { EngineError } from "./model.ts";

type Providers = BbPluginApi["sdk"]["providers"];
type Target = { hostId: string; projectId?: string } | { environmentId: string } | { projectId: string };
type Choice = { provider?: string | null; model?: string | null; reasoning?: string | null };

export const DEFAULT_PROVIDER = "claude-code";
/** What the Projects tab's Start buttons use unless the owner changes the settings (server.ts reads its defaults here). */
export const START_DEFAULTS = {
  lead: { provider: DEFAULT_PROVIDER, model: "claude-opus-5-5", reasoning: "high" },
  cos: { provider: DEFAULT_PROVIDER, model: "claude-opus-5-5", reasoning: "high" },
  steward: { provider: DEFAULT_PROVIDER, model: "claude-sonnet-5-5", reasoning: "medium" },
} as const;

const norm = (c: Choice) => ({ provider: c.provider == null ? DEFAULT_PROVIDER : c.provider.trim(), model: c.model?.trim() || undefined, reasoning: c.reasoning?.trim() || undefined });

/**
 * Validate on the destination machine before spawning; never replace an explicit selection. A start that uses the
 * defaults (`defaults`: what the caller would use when nothing was chosen) is never blocked by the catalog: when the
 * catalog can't be read, or doesn't list the default, it spawns as before the check, with a warning. An explicit
 * choice that the catalog can't confirm is refused.
 */
export async function spawnSelection(providers: Providers, target: Target, choice: Choice, opts: { defaults?: Choice; warn?: (m: string) => void } = {}) {
  const c = norm(choice);
  if (!c.provider) throw new EngineError("invalid", "provider must not be empty");
  const d = opts.defaults ? norm(opts.defaults) : null;
  const usesDefaults = !!d && d.provider === c.provider && d.model === c.model && d.reasoning === c.reasoning;
  try {
    return await checked(providers, target, c);
  } catch (e) {
    if (!usesDefaults) throw e;
    opts.warn?.(`spawn: default ${c.provider}${c.model ? `/${c.model}` : ""} started without a catalog check (${e instanceof Error ? e.message : String(e)})`);
    return { providerId: c.provider, ...(c.model ? { model: c.model } : {}), ...(c.reasoning ? { reasoningLevel: c.reasoning } : {}) };
  }
}

async function checked(providers: Providers, target: Target, c: ReturnType<typeof norm>) {
  const { provider: providerId, model, reasoning: reasoningLevel } = c;
  const options = await providers.models({ ...target, providerId, preferCached: false });
  if (options.modelLoadError) throw new EngineError("bad_state", `cannot load ${providerId} models: ${options.modelLoadError.code}`);
  if (!options.providers.some((p) => p.id === providerId && p.available)) throw new EngineError("bad_state", `provider ${providerId} is unavailable on the destination`);
  const selected = model ? options.models.find((m) => (m.id === model || m.model === model) && (!m.routeProviderId || m.routeProviderId === providerId)) : options.models.find((m) => m.isDefault && (!m.routeProviderId || m.routeProviderId === providerId));
  if (!selected) throw new EngineError("bad_state", model ? `model ${model} is unavailable for ${providerId}` : `no default model for ${providerId}; select one explicitly`);
  if (reasoningLevel && selected.reasoningDiscovery === "known" && !selected.supportedReasoningEfforts.some((r) => r.reasoningEffort === reasoningLevel)) throw new EngineError("invalid", `reasoning ${reasoningLevel} is unsupported by ${providerId}/${model ?? selected.model}`);
  return { providerId, model: model ?? selected.model, ...(reasoningLevel ? { reasoningLevel } : {}) };
}
