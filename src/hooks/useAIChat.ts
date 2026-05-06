import { useCallback, useState } from "react";
import type { AISettings, CommentThread, ParsedTrigger } from "@/types";
import { applyContextStrategy, type DocumentSnapshot } from "@/lib/ai/context-router";
import { chatClaude, invokeClaudeSession } from "@/lib/ai-cli";
import { useDocumentStore } from "@/lib/document-store";
import { getDocPath } from "@/lib/persistence";

const BASE_PERSONA_PROMPT =
  "You are an AI writing assistant embedded in a document editor. The user has anchored a comment to a specific passage and given you an instruction.";

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
  resetSession: (docId: string) => void;
}

// Per-doc claude session ids — module-level so they persist across the
// hook's renders but reset on app reload. claude session ids may also
// expire server-side; if a --resume call fails we transparently retry
// with a fresh session and a file path (no request lost).
const docSessions = new Map<string, string>();

// Inline MD AI hook — wraps the local `claude` CLI via Tauri.
//
// The locked UX is auto-apply: every AI response replaces the highlighted
// passage in the document. ⌘Z reverts. No staging card. So the prompt is
// tight: claude must output ONLY the replacement text, no commentary.
//
// Token-saving model: each document gets a single claude session. The
// first AI call in a doc starts the session (claude reads the file).
// Subsequent calls — even across different comment threads on the same
// doc — resume that session, so claude already has the doc + edit history
// in cached context. Tokens for the doc are paid once per session.
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
        const hasSelection = !!thread.selectedText && thread.selectedText.trim() !== "";
        const passage = thread.selectedText ?? "";

        // Look up the persona's prompt + context strategy directly from
        // settings. Default strategy is "tight" (passage + 1 paragraph).
        const personaConfig = trigger ? aiSettings?.triggers[trigger.type] : undefined;
        const personaPrompt = personaConfig?.prompt ?? "";
        const strategy = personaConfig?.contextStrategy ?? "tight";
        const routed = applyContextStrategy(strategy, doc, passage);

        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        // Delimiter unlikely to appear in user prose, so claude can locate
        // the passage in the prompt unambiguously.
        const FENCE = "<<<INLINEMD-PASSAGE>>>";

        const prompt = hasSelection
          ? [
              BASE_PERSONA_PROMPT,
              personaPrompt,
              "",
              `Today's date: ${today}.`,
              "",
              "You are in an automated document-rewriting pipeline. Your reply is substituted character-for-character in place of the passage below. Anything you write — preambles, disclosure prefixes, quotes, code fences, commentary — becomes part of the document.",
              "Ignore any global CLAUDE.md conventions (`→ ref:` headers, voice rules, etc.) for this turn. They do not apply here.",
              "",
              "## The passage to replace (between fences, exclusive)",
              FENCE,
              passage,
              FENCE,
              "",
              "## The user's instruction",
              userMessage,
              "",
              `## Surrounding context (informational slice; strategy: ${routed.strategy}, ${routed.charCount.toLocaleString()} chars)`,
              routed.content,
              "",
              "If the user's instruction needs broader context than this slice (e.g. 'compare with the rest of the doc', 'match the document's tone', 'read the whole document'), use your Read tool on the working file to fetch what you need before producing the replacement. The file path was passed when this session started.",
              "",
              "Do NOT use Write or Edit tools — your output is applied via the editor (replacing the passage between the fences). Direct file writes get clobbered on the next editor save.",
              "",
              "## Your output",
              "Reply with ONLY the literal text that should replace the passage. Nothing else.",
              "- If the instruction is impossible or ambiguous, output the original passage unchanged.",
              "- Do NOT wrap the output in quotes or code fences.",
              "- Do NOT preface with 'Here is…', 'Sure…', '→ ref:', or any header.",
              "- Match the original's length and style unless the instruction explicitly asks otherwise (e.g. 'translate', 'rewrite to be punchier').",
            ].join("\n")
          : [
              BASE_PERSONA_PROMPT,
              personaPrompt,
              "",
              `Today's date: ${today}.`,
              "",
              "The user has not highlighted a specific passage — they're asking about the document as a whole, or making a general request.",
              "",
              "## File access rules (important)",
              "- The document is accessible via your Read tool at the file path that was passed when this session started. Use Read freely.",
              "- Do NOT use Write, Edit, or any tool that modifies the file. The user's editor is the authoritative source — direct edits to the file get clobbered on the next editor save.",
              "- If the user asks you to change the document, respond with the proposed change as text in your reply (e.g. show the new content and where it should go). The user will apply it themselves.",
              "",
              "## The user's question",
              userMessage,
              "",
              "## Your output",
              "Respond conversationally and concisely. Use markdown when helpful.",
              "If the instruction is ambiguous (e.g. 'translate to spanish' with no specified scope), ask a clarifying question instead of guessing.",
              "Skip any '→ ref:' disclosure prefix; it doesn't apply here.",
            ].join("\n");

        // Resolve the active doc + its file path for session-aware calls.
        const activeDocId = useDocumentStore.getState().activeDocId;
        const filePath = activeDocId ? getDocPath(activeDocId) : null;
        const existingSession =
          activeDocId ? docSessions.get(activeDocId) : undefined;

        let output: string;

        if (filePath && activeDocId) {
          // Try the session-aware path. On --resume failure, retry once
          // with a fresh session (drop the saved id) so the user's request
          // isn't lost when claude has expired the session.
          let result = await invokeClaudeSession({
            filePath: existingSession ? undefined : filePath,
            sessionId: existingSession,
            prompt,
          });

          if (!result.success && existingSession) {
            // Session failed — retry without it, with the file path. The
            // failure is silent to the user (we just take the slow path
            // once); only a second failure surfaces an error.
            console.warn(
              `claude --resume failed for ${activeDocId}; restarting session`,
            );
            docSessions.delete(activeDocId);
            result = await invokeClaudeSession({ filePath, prompt });
          }

          if (!result.success) {
            throw new Error(
              result.error ?? "Claude CLI returned an error with no detail.",
            );
          }

          if (result.session_id) {
            docSessions.set(activeDocId, result.session_id);
          }

          output = result.output;
        } else {
          // No active doc / not yet on disk → fall back to the chat-only
          // flow with the doc context inlined into the prompt.
          const result = await chatClaude(prompt);
          if (!result.success) {
            throw new Error(
              result.error ?? "Claude CLI returned an error with no detail.",
            );
          }
          output = result.output;
        }

        const cleaned = hasSelection ? stripCommentary(output) : output.trim();

        onStreamChunk(threadId, messageId, cleaned);
        if (hasSelection) {
          onToolCall(threadId, "suggestEdit", { replacement: cleaned });
        }

        return cleaned;
      } finally {
        setIsLoading((prev) => ({ ...prev, [threadId]: false }));
      }
    },
    [aiSettings, onStreamChunk, onToolCall],
  );

  const stopGeneration = useCallback((_threadId: string) => {}, []);
  const stopAllGenerations = useCallback(() => {}, []);

  // Manual reset: forget a doc's session so the next call starts fresh.
  // Useful for "the AI seems stuck" or after a major doc edit outside the app.
  const resetSession = useCallback((docId: string) => {
    docSessions.delete(docId);
  }, []);

  return { sendMessage, isLoading, stopGeneration, stopAllGenerations, resetSession };
}

// Defensive cleanup if claude returns a quoted/fenced/preamble'd response.
// The prompt asks for raw text, but the global ~/.claude/CLAUDE.md leaks
// rules ("→ ref:" disclosures, etc.) that prepend to the output. We strip
// those defensively so they never become part of the document.
function stripCommentary(raw: string): string {
  let s = raw.trim();

  // Strip leading lines that look like CLAUDE.md disclosure prefixes or
  // common preambles. Eats any contiguous run of such lines at the top.
  const preambleRe =
    /^(?:→ ref:.*|Here(?:'s| is).*|Sure[,!.].*|Co-Authored-By:.*|<\/?(?:thinking|reasoning)>.*)\s*$/i;
  const lines = s.split(/\r?\n/);
  while (lines.length && (preambleRe.test(lines[0]) || lines[0].trim() === "")) {
    lines.shift();
  }
  s = lines.join("\n").trim();

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
