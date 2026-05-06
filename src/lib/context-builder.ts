import type { AISettings, CommentThread, ParsedTrigger } from "@/types";
import { applyContextStrategy, type DocumentSnapshot } from "./ai/context-router";

// Base system prompt prepended to every AI request. Trigger-specific prompts
// live in settings (see lib/settings.ts → DEFAULT_TRIGGER_PROMPTS) and are user-editable.
const BASE_PROMPT = `You are InlineAI, an intelligent writing assistant embedded in a document editor. You help users improve their writing by responding to comments anchored to specific text passages.

You will receive:
- A slice of the document chosen by the user's selected context strategy
- The specific highlighted passage the user is asking about
- The conversation history in this comment thread
- The user's message (which may include an @trigger command)

Keep responses concise and focused. Use markdown for formatting when helpful. Stay on topic — your responses should be directly relevant to the highlighted passage.`;

// Follow-up prompt for messages after the first AI exchange in a thread.
const FOLLOWUP_PROMPT = `${BASE_PROMPT}

You are continuing a conversation in a comment thread. The user is following up on a previous exchange. Stay in context and continue helping with whatever was being discussed.`;

const MAX_PASSAGE_LENGTH = 4000;

export interface AIContext {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** What the context router decided to send — surfaced in the chip. */
  routed: { charCount: number; strategy: string; truncated: boolean };
}

export interface BuildAIContextInput {
  thread: CommentThread;
  doc: DocumentSnapshot;
  trigger: ParsedTrigger | null;
  userMessage: string;
  aiSettings?: AISettings;
}

// Build the full context payload for an AI request, dispatching the document
// slice through the context router based on the trigger's contextStrategy.
export function buildAIContext({
  thread,
  doc,
  trigger,
  userMessage,
  aiSettings,
}: BuildAIContextInput): AIContext {
  const isFirstAIMessage = !thread.messages.some((m) => m.role === "assistant");
  const triggerConfig = trigger ? aiSettings?.triggers[trigger.type] : undefined;

  // System prompt: BASE + trigger persona prompt for first message, FOLLOWUP otherwise.
  let systemPrompt: string;
  if (trigger && isFirstAIMessage) {
    const triggerPrompt = triggerConfig?.prompt ?? "";
    systemPrompt = triggerPrompt ? `${BASE_PROMPT}\n\n${triggerPrompt}` : BASE_PROMPT;
  } else {
    systemPrompt = FOLLOWUP_PROMPT;
  }

  // Dispatch document context through the strategy router. Default to "tight"
  // when there's no trigger config (e.g. follow-ups) — surrounding paragraphs
  // are usually the right level for continuation responses.
  const strategy = triggerConfig?.contextStrategy ?? "tight";
  const passage = (thread.selectedText ?? "").slice(0, MAX_PASSAGE_LENGTH);
  const routed = applyContextStrategy(strategy, doc, passage);

  const contextMessage = `${routed.content}

## User Message
${userMessage}`;

  // Convert thread history to message format for multi-turn
  const messages: AIContext["messages"] = [];
  for (const msg of thread.messages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Only the first message gets the full document context; subsequent
  // messages reference the same scope implicitly via thread history.
  if (messages.length === 0) {
    messages.push({ role: "user", content: contextMessage });
  } else {
    messages.push({ role: "user", content: userMessage });
  }

  return {
    systemPrompt,
    messages,
    routed: {
      charCount: routed.charCount,
      strategy: routed.strategy,
      truncated: routed.truncated,
    },
  };
}
