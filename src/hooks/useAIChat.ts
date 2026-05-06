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
// Compared to the inlineai web parent (which streamed from the Vercel AI SDK
// over /api/ai), this hook:
//   - calls ai_chat_claude once and gets the full response back,
//   - reports the result via onStreamChunk in a single chunk (no token-by-token),
//   - has no tool-call surface (Claude Code returns plain text, not typed
//     suggestEdit payloads), so onToolCall is never invoked,
//   - has no per-thread cancellation yet — the subprocess can't be reliably
//     killed from JS without more Rust plumbing.
//
// The persona context-router (passage-only / tight / etc.) still runs and
// its messages array is folded into a single prompt string passed to claude
// on stdin.
export function useAIChat(
  onStreamChunk: (threadId: string, messageId: string, content: string) => void,
  _onToolCall: (threadId: string, toolName: string, input: unknown) => void,
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

        // Flatten the AI-SDK-shaped messages array into a single prompt
        // string for claude's stdin. System prompt first, then each user/
        // assistant turn labeled, then a clear cue for the assistant turn.
        const prompt = [
          `<system>\n${systemPrompt}\n</system>`,
          ...messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`),
          "<assistant>",
        ].join("\n\n");

        const result = await chatClaude(prompt);

        if (!result.success) {
          throw new Error(
            result.error ?? "Claude CLI returned an error with no detail.",
          );
        }

        const content = result.output.trim();
        onStreamChunk(threadId, messageId, content);
        return content;
      } finally {
        setIsLoading((prev) => ({ ...prev, [threadId]: false }));
      }
    },
    [aiSettings, onStreamChunk],
  );

  // Subprocess cancellation isn't wired yet. These are no-ops that satisfy
  // the existing call sites in EditorPage. If we add a Rust kill command
  // later, plug it in here.
  const stopGeneration = useCallback((_threadId: string) => {}, []);
  const stopAllGenerations = useCallback(() => {}, []);

  return { sendMessage, isLoading, stopGeneration, stopAllGenerations };
}
