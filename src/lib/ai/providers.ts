import type { ProviderId } from "@/types";

// modelId format: "providerId/modelName" e.g. "anthropic/claude-sonnet-4-20250514"
// Returns null if the modelId is malformed.
export function parseModelId(modelId: string): {
  providerId: ProviderId;
  modelName: string;
} | null {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) return null;
  const provider = modelId.slice(0, slash);
  if (provider !== "anthropic" && provider !== "deepseek") return null;
  return { providerId: provider, modelName: modelId.slice(slash + 1) };
}

// Pick the right API key for a given provider from the settings.
export function keyForProvider(
  providerId: ProviderId,
  keys: { anthropicKey: string; deepseekKey: string }
): string {
  if (providerId === "anthropic") return keys.anthropicKey;
  if (providerId === "deepseek") return keys.deepseekKey;
  return "";
}
