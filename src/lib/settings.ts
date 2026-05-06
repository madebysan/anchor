import type { AISettings, TriggerConfig, ContextStrategy } from "@/types";

const STORAGE_KEY = "inlineai-settings";

// Soft default model IDs for seeded personas. The Settings dialog fetches
// available models live from each provider's /models endpoint — these are
// just initial values that the user can change at any time. If a default
// model ID becomes invalid (provider drops it), the user is prompted to pick
// a new one. There is NO hardcoded model dropdown anywhere in the build.
const SEED_MODEL_SONNET = "anthropic/claude-sonnet-4-6";
const SEED_MODEL_HAIKU = "anthropic/claude-haiku-4-5-20251001";
const SEED_MODEL_OPUS = "anthropic/claude-opus-4-7";

// One-time migrations from model IDs that have been deprecated by the provider.
// When a user's persisted settings reference one of these, we silently rewrite
// it to the current equivalent on next load. Safe to remove these entries
// after a few releases once we're confident no localStorage references them.
const STALE_MODEL_MIGRATIONS: Record<string, string> = {
  "anthropic/claude-sonnet-4-20250514": SEED_MODEL_SONNET,
  "anthropic/claude-haiku-4-20250414": SEED_MODEL_HAIKU,
  "anthropic/claude-opus-4-20250414": SEED_MODEL_OPUS,
};

// Default prompts for each trigger (role-based personas).
// Personas that produce replacement text MUST call the suggestEdit tool — the
// client renders the tool's typed payload as an accept/reject card. Plain
// prose (explanation, critique) goes in the response text as usual.
export const DEFAULT_TRIGGER_PROMPTS: Record<string, string> = {
  copywriter: `Role: Senior copywriter.
Task: Improve the clarity, tone, and flow of the highlighted text.

Rules:
- Your replacement MUST be similar in length to the original — don't expand a sentence into a paragraph.
- Preserve the author's voice. Refine, don't rewrite from scratch.
- Keep your text response to 1–2 sentences of explanation, no more.
- If the user gave specific instructions after the trigger, follow those.

To propose a replacement: call the suggestEdit tool with the rewritten text.
The user sees it as an accept/reject card. Always call the tool when proposing a rewrite.`,

  editor: `Role: Detail-oriented editor.
Task: Fix grammar, punctuation, sentence structure, and consistency in the highlighted text.

Rules:
- Your replacement MUST stay as close to the original as possible — only change what's broken.
- Don't rephrase things that are already correct. Minimal edits only.
- Keep your text response to 1–2 sentences noting what you fixed.
- If the user gave specific instructions after the trigger, follow those.

To propose an edit: call the suggestEdit tool with the corrected text.
The user sees it as an accept/reject card. Always call the tool when proposing a fix.`,

  researcher: `Role: Research assistant.
Task: Fact-check claims and identify gaps in the highlighted text.

Rules:
- Be specific — name exactly which claims need verification and why.
- Suggest where to look (types of sources, not made-up URLs).
- Keep your response to 3–5 bullet points max.
- If the user gave specific instructions after the trigger, follow those.

Do NOT call the suggestEdit tool. Your job is critique, not rewriting.`,

  challenger: `Role: Critical thinker.
Task: Question assumptions and find weaknesses in the highlighted text.

Rules:
- Raise 2–3 focused objections, not an exhaustive list.
- Be constructive — the goal is to strengthen the writing, not tear it down.
- Keep each point to 1–2 sentences.
- If the user gave specific instructions after the trigger, follow those.

Do NOT call the suggestEdit tool. Your job is to surface weaknesses for the writer to address.`,
};

// Default trigger configs with name, prompt, context strategy, and model.
// Strategy is chosen to fit each persona's natural request type:
// - editor (grammar): tight passage context, no need for whole doc
// - copywriter (tone): local section so the rewrite matches surrounding voice
// - researcher (fact-check): tight + thesis for claim framing
// - challenger (assumptions): outline + passage to spot logical gaps vs structure
export const DEFAULT_TRIGGERS: Record<string, TriggerConfig> = {
  copywriter: {
    name: "Copywriter",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.copywriter,
    contextStrategy: "local-section",
    modelId: SEED_MODEL_SONNET,
  },
  editor: {
    name: "Editor",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.editor,
    contextStrategy: "tight",
    modelId: SEED_MODEL_HAIKU,
  },
  researcher: {
    name: "Researcher",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.researcher,
    contextStrategy: "tight-plus-thesis",
    modelId: SEED_MODEL_OPUS,
  },
  challenger: {
    name: "Challenger",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.challenger,
    contextStrategy: "outline-plus-passage",
    modelId: SEED_MODEL_SONNET,
  },
};

// Default settings on first run.
export const DEFAULT_SETTINGS: AISettings = {
  anthropicKey: "",
  deepseekKey: "",
  triggers: { ...DEFAULT_TRIGGERS },
  // Most comments are AI requests; default to @editor when nothing tagged.
  defaultPersona: "editor",
};

// Save settings to localStorage
export function saveSettings(settings: AISettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage might be full or unavailable
  }
}

// Old trigger keys from v1 — used to detect stale localStorage
const LEGACY_TRIGGER_KEYS = ["help", "explain", "rewrite", "challenge"];

const VALID_STRATEGIES: ContextStrategy[] = [
  "passage-only",
  "tight",
  "local-section",
  "tight-plus-thesis",
  "outline-plus-passage",
  "outline",
  "full-document",
];

// Backfill missing trigger fields when loading legacy settings.
// Phase 3 added contextStrategy + modelId; pre-Phase-3 triggers won't have them.
// Also rewrites deprecated model IDs to their current equivalents.
function backfillTrigger(
  key: string,
  config: Partial<TriggerConfig>,
  fallbackModelId: string
): TriggerConfig {
  const isValidStrategy =
    typeof config.contextStrategy === "string" &&
    (VALID_STRATEGIES as string[]).includes(config.contextStrategy);

  const rawModelId =
    typeof config.modelId === "string" && config.modelId.length > 0
      ? config.modelId
      : DEFAULT_TRIGGERS[key]?.modelId ?? fallbackModelId;
  const modelId = STALE_MODEL_MIGRATIONS[rawModelId] ?? rawModelId;

  return {
    name: typeof config.name === "string" ? config.name : key,
    enabled: typeof config.enabled === "boolean" ? config.enabled : true,
    prompt:
      typeof config.prompt === "string"
        ? config.prompt
        : DEFAULT_TRIGGER_PROMPTS[key] ?? "",
    contextStrategy: isValidStrategy
      ? (config.contextStrategy as ContextStrategy)
      : DEFAULT_TRIGGERS[key]?.contextStrategy ?? "tight",
    modelId,
  };
}

// Load settings from localStorage, falling back to defaults. Migrates legacy
// shapes: pre-Phase-3 had `apiKey` (Anthropic) and a global `model`; we map
// apiKey → anthropicKey and seed `model` into per-trigger modelId where missing.
export function loadSettings(): AISettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SETTINGS;

    type LegacyAISettings = Partial<AISettings> & {
      apiKey?: string;
      model?: string;
    };
    const parsed = JSON.parse(stored) as LegacyAISettings;

    // Migrate legacy keys
    const anthropicKey =
      typeof parsed.anthropicKey === "string"
        ? parsed.anthropicKey
        : typeof parsed.apiKey === "string"
        ? parsed.apiKey
        : "";
    const deepseekKey =
      typeof parsed.deepseekKey === "string" ? parsed.deepseekKey : "";

    // Legacy global model becomes the fallback for trigger backfill
    const legacyModel = typeof parsed.model === "string" ? parsed.model : "";
    const fallbackModelId = legacyModel
      ? `anthropic/${legacyModel}`
      : SEED_MODEL_SONNET;

    let triggers = parsed.triggers ?? DEFAULT_SETTINGS.triggers;

    // Detect ancient v1 trigger format and reset
    const keys = Object.keys(triggers);
    const isLegacy =
      keys.some((k) => LEGACY_TRIGGER_KEYS.includes(k)) &&
      keys.every((k) => !triggers[k]?.name);
    if (isLegacy) {
      triggers = { ...DEFAULT_TRIGGERS };
    }

    // Backfill any missing fields per trigger; discard malformed entries.
    const validated: Record<string, TriggerConfig> = {};
    for (const [key, config] of Object.entries(triggers)) {
      if (!config || typeof config !== "object") continue;
      validated[key] = backfillTrigger(key, config as Partial<TriggerConfig>, fallbackModelId);
    }
    if (Object.keys(validated).length === 0) {
      Object.assign(validated, DEFAULT_TRIGGERS);
    }

    const defaultPersona =
      typeof parsed.defaultPersona === "string"
        ? parsed.defaultPersona
        : DEFAULT_SETTINGS.defaultPersona;

    return {
      anthropicKey,
      deepseekKey,
      triggers: validated,
      defaultPersona,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
