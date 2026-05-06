import type { AISettings, TriggerConfig, ContextStrategy } from "@/types";

const STORAGE_KEY = "inline-md-settings";

// Default prompts for each persona. Inline MD's auto-apply contract (in
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

// Default trigger configs. Strategy is chosen to fit each persona's natural
// request type — see the comments in DEFAULT_TRIGGERS for the rationale.
export const DEFAULT_TRIGGERS: Record<string, TriggerConfig> = {
  copywriter: {
    name: "Copywriter",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.copywriter,
    contextStrategy: "local-section",
  },
  editor: {
    name: "Editor",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.editor,
    contextStrategy: "tight",
  },
  researcher: {
    name: "Researcher",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.researcher,
    contextStrategy: "tight-plus-thesis",
  },
  challenger: {
    name: "Challenger",
    enabled: true,
    prompt: DEFAULT_TRIGGER_PROMPTS.challenger,
    contextStrategy: "outline-plus-passage",
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

const VALID_STRATEGIES: ContextStrategy[] = [
  "passage-only",
  "tight",
  "local-section",
  "tight-plus-thesis",
  "outline-plus-passage",
  "outline",
  "full-document",
];

// Backfill missing trigger fields when loading; discards malformed entries.
function backfillTrigger(
  key: string,
  config: Partial<TriggerConfig>,
): TriggerConfig {
  const isValidStrategy =
    typeof config.contextStrategy === "string" &&
    (VALID_STRATEGIES as string[]).includes(config.contextStrategy);

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
  };
}

export function loadSettings(): AISettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
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
