import type { ModelOption, ProviderId } from "@/types";

// Live fetch each provider's available models. Per-provider failures collapse
// gracefully into a free-text fallback at the UI layer — we never hardcode model
// names. New models from either provider appear automatically.

interface ProviderResult {
  providerId: ProviderId;
  /** null when loading or when the key isn't configured. */
  models: ModelOption[] | null;
  /** human-readable error if the fetch failed (key invalid, network, etc). */
  error: string | null;
}

export interface ModelLoaderResult {
  anthropic: ProviderResult;
  deepseek: ProviderResult;
}

interface AnthropicModelsResponse {
  data?: Array<{ id?: string; display_name?: string }>;
}

interface DeepseekModelsResponse {
  data?: Array<{ id?: string }>;
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!response.ok) {
    throw new Error(`Anthropic /models returned ${response.status}`);
  }
  const data = (await response.json()) as AnthropicModelsResponse;
  if (!Array.isArray(data.data)) {
    throw new Error("Anthropic /models returned unexpected shape");
  }
  return data.data
    .filter((m) => typeof m.id === "string")
    .map((m) => ({
      providerId: "anthropic" as const,
      modelId: `anthropic/${m.id}`,
      modelName: m.id as string,
      displayName: m.display_name || (m.id as string),
    }));
}

async function fetchDeepseekModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.deepseek.com/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`DeepSeek /models returned ${response.status}`);
  }
  const data = (await response.json()) as DeepseekModelsResponse;
  if (!Array.isArray(data.data)) {
    throw new Error("DeepSeek /models returned unexpected shape");
  }
  return data.data
    .filter((m) => typeof m.id === "string")
    .map((m) => ({
      providerId: "deepseek" as const,
      modelId: `deepseek/${m.id}`,
      modelName: m.id as string,
      displayName: m.id as string,
    }));
}

// Fetch models for whichever providers have keys configured. Failures are
// captured per-provider so one bad key doesn't break the dropdown for the other.
export async function loadAvailableModels(keys: {
  anthropicKey: string;
  deepseekKey: string;
}): Promise<ModelLoaderResult> {
  const [anthropicResult, deepseekResult] = await Promise.allSettled([
    keys.anthropicKey
      ? fetchAnthropicModels(keys.anthropicKey)
      : Promise.resolve(null),
    keys.deepseekKey
      ? fetchDeepseekModels(keys.deepseekKey)
      : Promise.resolve(null),
  ]);

  return {
    anthropic: {
      providerId: "anthropic",
      models:
        anthropicResult.status === "fulfilled" ? anthropicResult.value : null,
      error:
        anthropicResult.status === "rejected"
          ? (anthropicResult.reason as Error).message
          : null,
    },
    deepseek: {
      providerId: "deepseek",
      models:
        deepseekResult.status === "fulfilled" ? deepseekResult.value : null,
      error:
        deepseekResult.status === "rejected"
          ? (deepseekResult.reason as Error).message
          : null,
    },
  };
}
