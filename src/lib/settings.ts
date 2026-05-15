import type { AISettings, TriggerConfig, ContextStrategy } from "@/types";

const STORAGE_KEY = "anchor-settings";
const LEGACY_STORAGE_KEYS = ["inline-md-settings"];

// Default prompts for each persona. Anchor's auto-apply contract (in
// useAIChat) instructs claude to output ONLY the replacement passage, so
// these prompts focus on role + style, not output format.
export const DEFAULT_TRIGGER_PROMPTS: Record<string, string> = {
  copywriter: `Role: Senior copywriter.
Task: Improve the clarity, tone, and flow of the highlighted passage.

Rules:
- Stay close to the original length. Don't expand a sentence into a paragraph.
- Preserve the author's voice. Refine, don't rewrite from scratch.
- Follow any specific instructions the user gave after the trigger.`,

  editor: `Role: Detail-oriented editor.
Task: Fix grammar, punctuation, sentence structure, and consistency in the highlighted passage.

Rules:
- Make minimal edits — only fix what is actually broken.
- Don't rephrase content that is already correct.
- Follow any specific instructions the user gave after the trigger.`,

  researcher: `Role: Research assistant.
Task: Identify unsupported claims and gaps in the highlighted passage.

Rules:
- Be specific about which claims need verification and why.
- Suggest types of sources to check (don't fabricate URLs).
- Keep your output focused — 3-5 short bullet points is enough.
- Follow any specific instructions the user gave after the trigger.`,

  challenger: `Role: Critical thinker.
Task: Question the assumptions and surface weaknesses in the highlighted passage.

Rules:
- Raise 2-3 focused objections, not an exhaustive list.
- Be constructive — the goal is to strengthen the writing.
- Each point should be 1-2 sentences.
- Follow any specific instructions the user gave after the trigger.`,
};

// Default trigger configs. We expose 3 context strategies in the UI
// (passage-only / local-section / full-document); these defaults pick
// from that set so the dropdown always reflects the persona's setting.
export const DEFAULT_TRIGGERS: Record<string, TriggerConfig> = {
  copywriter: {
    name: "Copywriter",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.copywriter,
    contextStrategy: "local-section",
    mode: "rewrite",
  },
  editor: {
    name: "Editor",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.editor,
    contextStrategy: "passage-only",
    mode: "rewrite",
  },
  researcher: {
    name: "Researcher",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.researcher,
    contextStrategy: "local-section",
    mode: "feedback",
  },
  challenger: {
    name: "Challenger",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.challenger,
    contextStrategy: "full-document",
    mode: "feedback",
  },
};

// Default settings on first run.
export const DEFAULT_SETTINGS: AISettings = {
  triggers: { ...DEFAULT_TRIGGERS },
  // Most comments are AI requests; default to @editor when nothing tagged.
  defaultPersona: "editor",
};

export function saveSettings(settings: AISettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage might be unavailable; settings are recreated on next load.
  }
}

// Strategies that still resolve at the routing layer but are no longer
// exposed in the UI. We migrate them to the closest visible alternative
// on load so the dropdown always reflects what's stored.
const STRATEGY_MIGRATIONS: Record<string, ContextStrategy> = {
  "tight": "passage-only",
  "tight-plus-thesis": "local-section",
  "outline-plus-passage": "full-document",
  "outline": "full-document",
};

const VISIBLE_STRATEGY_SET = new Set<ContextStrategy>([
  "passage-only",
  "local-section",
  "full-document",
]);

// Backfill missing trigger fields when loading; discards malformed entries.
// Also migrates deprecated context strategies to their closest survivor.
function backfillTrigger(
  key: string,
  config: Partial<TriggerConfig>,
): TriggerConfig {
  const rawStrategy = typeof config.contextStrategy === "string"
    ? config.contextStrategy
    : null;
  const migrated =
    rawStrategy && STRATEGY_MIGRATIONS[rawStrategy]
      ? STRATEGY_MIGRATIONS[rawStrategy]
      : (rawStrategy as ContextStrategy | null);
  const finalStrategy: ContextStrategy =
    migrated && VISIBLE_STRATEGY_SET.has(migrated)
      ? migrated
      : DEFAULT_TRIGGERS[key]?.contextStrategy ?? "passage-only";

  return {
    name: typeof config.name === "string" ? config.name : key,
    enabled: typeof config.enabled === "boolean" ? config.enabled : true,
    prompt:
      typeof config.prompt === "string"
        ? config.prompt
        : DEFAULT_TRIGGER_PROMPTS[key] ?? "",
    contextStrategy: finalStrategy,
    mode: config.mode === "feedback" ? "feedback" : DEFAULT_TRIGGERS[key]?.mode ?? "rewrite",
  };
}

export function loadSettings(): AISettings {
  try {
    const stored =
      localStorage.getItem(STORAGE_KEY) ??
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (!stored) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(stored) as Partial<AISettings>;
    const triggers = parsed.triggers ?? DEFAULT_SETTINGS.triggers;

    const validated: Record<string, TriggerConfig> = {};
    for (const [key, config] of Object.entries(triggers)) {
      if (!config || typeof config !== "object") continue;
      validated[key] = backfillTrigger(key, config as Partial<TriggerConfig>);
    }
    if (Object.keys(validated).length === 0) {
      Object.assign(validated, DEFAULT_TRIGGERS);
    }

    return {
      triggers: validated,
      defaultPersona:
        typeof parsed.defaultPersona === "string"
          ? parsed.defaultPersona
          : DEFAULT_SETTINGS.defaultPersona,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
