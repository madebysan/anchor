import { useCallback, useState } from "react";
import type { AISettings, CommentThread, ParsedTrigger } from "@/types";
import { buildAIContext } from "@/lib/context-builder";
import type { DocumentSnapshot } from "@/lib/ai/context-router";
import { chatClaude } from "@/lib/ai-cli";

interface UseAIChatReturn {
  sendMessage: (
    threadId: string,
    thread: CommentThread,
    doc: DocumentSnapshot,
    userMessage: string,
    trigger: ParsedTrigger | null,
  ) => Promise<string>;
  isLoading: Record<string, boolean>;
  stopGeneration: (threadId: string) => void;
  stopAllGenerations: () => void;
}

// Inline MD AI hook — wraps the local `claude` CLI via Tauri.
//
// The locked UX is auto-apply: every AI response replaces the highlighted
// passage in the document. ⌘Z reverts. No staging card. So the prompt is
// tight: claude must output ONLY the replacement text, no commentary.
//
// onStreamChunk: called once with the full response (no token streaming
//   from `claude --print`). Used so the user sees what claude returned in
//   the thread for auditability.
// onToolCall: called once with toolName="suggestEdit" + { replacement }.
//   The EditorPage handler auto-applies this to the document.
export function useAIChat(
  onStreamChunk: (threadId: string, messageId: string, content: string) => void,
  onToolCall: (threadId: string, toolName: string, input: unknown) => void,
  aiSettings?: AISettings,
): UseAIChatReturn {
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});

  const sendMessage = useCallback(
    async (
      threadId: string,
      thread: CommentThread,
      doc: DocumentSnapshot,
      userMessage: string,
      trigger: ParsedTrigger | null,
    ): Promise<string> => {
      setIsLoading((prev) => ({ ...prev, [threadId]: true }));
      const messageId = `ai-${threadId}`;

      try {
        const { systemPrompt, messages } = buildAIContext({
          thread,
          doc,
          trigger,
          userMessage,
          aiSettings,
        });

        // Strict output contract — claude must return ONLY the replacement
        // for the highlighted passage. No explanation, no markdown fence,
        // no surrounding quotes. The text returned will be substituted
        // verbatim for the original passage in the document.
        const outputContract = [
          "<output_contract>",
          "Output ONLY the rewritten replacement for the highlighted passage.",
          "Do not include explanation, commentary, quotation marks, or markdown code fences.",
          "Do not preface with 'Here is...' or 'Sure, ...'.",
          "Just the new text that should replace the original.",
          "If you cannot fulfil the request, output the original passage unchanged.",
          "</output_contract>",
        ].join("\n");

        const prompt = [
          `<system>\n${systemPrompt}\n\n${outputContract}\n</system>`,
          ...messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`),
          "<assistant>",
        ].join("\n\n");

        const result = await chatClaude(prompt);

        if (!result.success) {
          throw new Error(
            result.error ?? "Claude CLI returned an error with no detail.",
          );
        }

        const replacement = stripCommentary(result.output);

        // Show the response in the thread (auditability).
        onStreamChunk(threadId, messageId, replacement);

        // Trigger auto-apply via the existing suggestEdit pipeline.
        onToolCall(threadId, "suggestEdit", { replacement });

        return replacement;
      } finally {
        setIsLoading((prev) => ({ ...prev, [threadId]: false }));
      }
    },
    [aiSettings, onStreamChunk, onToolCall],
  );

  const stopGeneration = useCallback((_threadId: string) => {}, []);
  const stopAllGenerations = useCallback(() => {}, []);

  return { sendMessage, isLoading, stopGeneration, stopAllGenerations };
}

// Defensive cleanup if claude returns a quoted/fenced/preamble'd response.
// The prompt asks for raw text, but models drift sometimes.
function stripCommentary(raw: string): string {
  let s = raw.trim();
  // Strip a single ```...``` fence if claude wrapped the output.
  const fence = s.match(/^```(?:\w+)?\n?([\s\S]*?)\n?```$/);
  if (fence) s = fence[1].trim();
  // Strip surrounding straight or curly quotes.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("“") && s.endsWith("”"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}
