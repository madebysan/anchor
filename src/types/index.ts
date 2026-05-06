// All TypeScript types for InlineAI

export interface DocumentMeta {
  id: string;         // "doc-{timestamp}-{random5}"
  title: string;      // auto-derived from first <h1>/<h2>
  createdAt: number;
  updatedAt: number;
}

export interface CommentThread {
  id: string;
  selectedText: string;
  messages: ThreadMessage[];
  status: "active" | "resolved";
  createdAt: number;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  trigger?: ParsedTrigger;
  suggestedEdit?: SuggestedEdit;
  createdAt: number;
}

export interface ParsedTrigger {
  type: string;
  promptText: string;
}

export interface SuggestedEdit {
  id: string;
  originalText: string;
  suggestedText: string;
  status: "pending" | "accepted" | "rejected";
  /** Optional one-sentence rationale from the AI (Phase 4 tool calls). */
  reason?: string;
}

// Per-comment context strategy. Each persona declares which slice of the
// document gets sent to the AI. Keeps token spend proportional to the request type.
export type ContextStrategy =
  | "passage-only"           // just the highlighted text
  | "tight"                  // passage + ±1 paragraph
  | "local-section"          // passage + section bounded by nearest headings
  | "tight-plus-thesis"      // tight + first paragraph of doc (thesis context)
  | "outline-plus-passage"   // doc headings + passage
  | "outline"                // headings only
  | "full-document";         // whole thing (use sparingly)

export interface TriggerConfig {
  name: string;
  enabled: boolean;
  prompt: string;
  contextStrategy: ContextStrategy;
  // Format: "providerId/modelName" e.g. "anthropic/claude-sonnet-4-20250514"
  // Empty string falls back to provider's first available model.
  modelId: string;
}

export interface AISettings {
  anthropicKey: string;
  deepseekKey: string;
  triggers: Record<string, TriggerConfig>;
}

export type ProviderId = "anthropic" | "deepseek";

// One model option as returned by a provider's /models endpoint and
// presented in the per-persona model dropdown.
export interface ModelOption {
  providerId: ProviderId;
  modelId: string;        // the full "providerId/modelName" composite id
  modelName: string;      // bare model name within the provider
  displayName: string;    // friendly label for the dropdown
}
