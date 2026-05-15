import { useCallback, useState } from "react";
import type { AISettings, CommentThread, ParsedTrigger } from "@/types";
import { applyContextStrategy, type DocumentSnapshot } from "@/lib/ai/context-router";
import { formatThreadHistory } from "@/lib/ai/thread-history";
import { cancelClaude, chatClaude, invokeClaudeSession } from "@/lib/ai-cli";
import { useDocumentStore } from "@/lib/document-store";
import { getDocPath } from "@/lib/persistence";

const BASE_PERSONA_PROMPT =
  "You are an AI writing assistant embedded in a document editor. The user has anchored a comment to a specific passage and given you an instruction.";

type DirectEditOperation =
  | "insert"
  | "needs-selection"
  | "replace-all"
  | "replace-document"
  | "research-first"
  | "unsupported-structure";

interface ReplaceAllInstruction {
  original: string;
  replacement: string | null;
}

interface UseAIChatReturn {
  sendMessage: (
    threadId: string,
    thread: CommentThread,
    getDocumentSnapshot: () => DocumentSnapshot,
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
const cancelledRequests = new Set<string>();

function yieldForLoadingPaint(): Promise<void> {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function stripInstructionToken(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`.,;:!?]+$/g, "")
    .trim();
}

function parseReplaceAllInstruction(message: string, selectedText: string): ReplaceAllInstruction | null {
  const trimmed = message.trim();
  const quoted = [...trimmed.matchAll(/["“']([^"”']{1,80})["”']/g)].map((match) =>
    stripInstructionToken(match[1]),
  );

  if (quoted.length >= 2 && /\b(everywhere|throughout|whole document|entire document|all occurrences|all instances|every occurrence|every instance|rename|replace|called|renamed)\b/i.test(trimmed)) {
    return { original: quoted[0], replacement: quoted[1] };
  }

  const patterns = [
    /\b(.+?)\s+is\s+now\s+called\s+(.+?)(?:\s|,|\.|;|$)/i,
    /\brename\s+(.+?)\s+to\s+(.+?)(?:\s|,|\.|;|$)/i,
    /\breplace\s+(.+?)\s+with\s+(.+?)(?:\s|,|\.|;|$)/i,
    /\bchange\s+(.+?)\s+to\s+(.+?)(?:\s|,|\.|;|$)/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const original = stripInstructionToken(match[1]);
    const replacement = stripInstructionToken(match[2]);
    if (original && replacement) return { original, replacement };
  }

  if (
    selectedText &&
    /\b(replace|rename|update|change|called|renamed)\b/i.test(trimmed) &&
    /\b(everywhere|everywhere else|throughout|whole document|entire document|all occurrences|all instances|every occurrence|every instance|rest of (the )?(doc|document))\b/i.test(trimmed)
  ) {
    return { original: selectedText, replacement: null };
  }

  return null;
}

function isWholeDocumentRewriteInstruction(message: string, isChatThread: boolean): boolean {
  if (!isChatThread) return false;
  const normalized = message.trim().toLowerCase();
  const isQuestion =
    /^(what|why|how|when|where|who|which|can you explain|tell me|summarize)\b/.test(normalized) ||
    normalized.endsWith("?");
  if (isQuestion) return false;

  return (
    /^(translate|rewrite|polish|copyedit|edit|fix|update|change|delete|remove|shorten|expand)\b/.test(normalized) ||
    /\b(make|improve|polish|clean up|tighten|revise)\b.*\b(better|clearer|stronger|shorter|longer|punchier|section|intro|paragraph|argument|copy)\b/.test(normalized) ||
    /\btranslate\b.*\b(whole document|entire document|full document|document|doc)\b/.test(normalized) ||
    /\b(whole document|entire document|full document|document|doc)\b.*\btranslate\b/.test(normalized) ||
    /\b(rewrite|polish|clean up|copyedit)\b.*\b(whole document|entire document|full document)\b/.test(normalized)
  );
}

function detectDirectEditOperation(
  message: string,
  hasSelection: boolean,
  isChatThread: boolean,
  replaceAllInstruction: ReplaceAllInstruction | null,
): DirectEditOperation | null {
  const normalized = message.trim().toLowerCase();

  if (
    /\b(research|verify|check|look up|confirm)\b.*\b(if|then|replace|rewrite|update|change|edit)\b/.test(normalized) ||
    /\b(if|once)\b.*\b(true|verified|confirmed)\b.*\b(replace|rewrite|update|change|edit)\b/.test(normalized)
  ) {
    return "research-first";
  }

  if (
    /\b(move|relocate)\b.*\b(paragraph|section|sentence|block|text|this)\b.*\b(before|after|above|below)\b/.test(normalized)
  ) {
    return "unsupported-structure";
  }

  if (replaceAllInstruction) {
    return "replace-all";
  }

  if (isWholeDocumentRewriteInstruction(message, isChatThread)) return "replace-document";

  if (!hasSelection && /\b(make|improve|polish|clean up|tighten|revise)\b.*\b(better|clearer|stronger|shorter|longer|punchier|section|intro|paragraph|argument|copy)\b/.test(normalized)) {
    return "needs-selection";
  }

  if (hasSelection) return null;

  if (
    /^(insert|add|write|draft|compose|append|prepend|put)\b/.test(normalized) ||
    /^create\s+(a|an|the)?\s*(paragraph|section|sentence|bullet|list|note)\b/.test(normalized)
  ) {
    return "insert";
  }
  if (
    /^(rewrite|replace|edit|change|fix|update|delete|remove|shorten|expand|translate)\b/.test(normalized)
  ) {
    return "needs-selection";
  }
  return null;
}

// Anchor AI hook wraps the local `claude` CLI via Tauri.
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
// onToolCall: called once with an editor operation such as "suggestEdit",
//   "insertText", "replaceAllText", or "replaceDocument". EditorPage owns
//   the actual mutation.
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
      getDocumentSnapshot: () => DocumentSnapshot,
      userMessage: string,
      trigger: ParsedTrigger | null,
    ): Promise<string> => {
      setIsLoading((prev) => ({ ...prev, [threadId]: true }));
      const messageId = `ai-${threadId}`;

      try {
        await yieldForLoadingPaint();
        if (cancelledRequests.has(threadId)) return "";

        const doc = getDocumentSnapshot();
        const hasSelection = !!thread.selectedText && thread.selectedText.trim() !== "";
        const passage = thread.selectedText ?? "";

        // Look up the persona's prompt + context strategy directly from
        // settings. Default strategy is "tight" (passage + 1 paragraph).
        const personaConfig = trigger ? aiSettings?.triggers[trigger.type] : undefined;
        const personaPrompt = personaConfig?.prompt ?? "";
        const strategy = personaConfig?.contextStrategy ?? "tight";
        const mode = personaConfig?.mode ?? "rewrite";
        const userInstruction = trigger?.promptText.trim() || userMessage;
        const isChatThread = thread.intent === "chat";
        const replaceAllInstruction = parseReplaceAllInstruction(userInstruction, passage);
        const directEditOperation = detectDirectEditOperation(
          userInstruction,
          hasSelection,
          isChatThread,
          replaceAllInstruction,
        );
        const routed = applyContextStrategy(strategy, doc, passage, thread.anchor);
        const priorThreadMessages = thread.messages.slice(0, -1);
        const threadHistory = formatThreadHistory(priorThreadMessages);

        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        // Delimiter unlikely to appear in user prose, so claude can locate
        // the passage in the prompt unambiguously.
        const FENCE = "<<<INLINEMD-PASSAGE>>>";

        const rewritePrompt = [
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
          userInstruction,
          "",
          "## Prior thread context",
          threadHistory,
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
          "- Do NOT preface with 'Here is...', 'Sure...', '-> ref:', or any header.",
          "- Match the original's length and style unless the instruction explicitly asks otherwise (e.g. 'translate', 'rewrite to be punchier').",
        ].join("\n");

        const feedbackPrompt = [
          BASE_PERSONA_PROMPT,
          personaPrompt,
          "",
          `Today's date: ${today}.`,
          "",
          "This persona is in feedback mode. Do not rewrite or replace the selected passage. Keep your response in the comment thread as critique, analysis, questions, or concrete suggestions.",
          "Ignore any global CLAUDE.md conventions (`→ ref:` headers, voice rules, etc.) for this turn. They do not apply here.",
          "",
          "## The selected passage (between fences, exclusive)",
          FENCE,
          passage,
          FENCE,
          "",
          "## The user's instruction",
          userInstruction,
          "",
          "## Prior thread context",
          threadHistory,
          "",
          `## Surrounding context (informational slice; strategy: ${routed.strategy}, ${routed.charCount.toLocaleString()} chars)`,
          routed.content,
          "",
          "## File access rules",
          "- The document is accessible via your Read tool at the file path that was passed when this session started. Use Read freely if it helps.",
          "- Do NOT use Write, Edit, or any tool that modifies the file. The user's editor is the authoritative source.",
          "",
          "## Your output",
          "Respond conversationally and concisely. Use markdown bullets when helpful.",
        ].join("\n");

        const insertionPrompt = [
          BASE_PERSONA_PROMPT,
          personaPrompt,
          "",
          `Today's date: ${today}.`,
          "",
          "The user placed the caret in the document and gave a direct insertion command. Your reply will be inserted into the document at that caret position.",
          "Treat direct edit verbs like insert, add, write, draft, append, and prepend as commands, not requests for advice.",
          "Do not argue that the request is off-topic. Do not ask whether the content belongs. Do not offer options unless the user explicitly asked for options.",
          "Ignore any global CLAUDE.md conventions (`→ ref:` headers, voice rules, etc.) for this turn. They do not apply here.",
          "",
          "## The user's insertion instruction",
          userInstruction,
          "",
          "## Prior thread context",
          threadHistory,
          "",
          `## Document context (informational slice; strategy: ${routed.strategy}, ${routed.charCount.toLocaleString()} chars)`,
          routed.content,
          "",
          "If the user's instruction needs broader context than this slice, use your Read tool on the working file to fetch what you need before producing the insertion. The file path was passed when this session started.",
          "Do NOT use Write or Edit tools — your output is applied via the editor. Direct file writes get clobbered on the next editor save.",
          "",
          "## Your output",
          "Reply with ONLY the literal text to insert at the caret. Nothing else.",
          "- Do NOT explain where it should go.",
          "- Do NOT wrap the output in quotes or code fences.",
          "- Do NOT preface with 'Here is...', 'Sure...', 'Heads-up', or any header.",
          "- If you cannot verify a factual claim, still draft the requested text and include any uncertainty inside the inserted text only if it is essential.",
        ].join("\n");

        const replaceAllPrompt = [
          BASE_PERSONA_PROMPT,
          personaPrompt,
          "",
          `Today's date: ${today}.`,
          "",
          "The user asked for a whole-document replacement based on the selected passage. Your reply will be used as the replacement text for every matching occurrence in the document.",
          "Anchor applies the replacement through the editor. Do not use Write or Edit tools.",
          "Ignore any global CLAUDE.md conventions (`→ ref:` headers, voice rules, etc.) for this turn. They do not apply here.",
          "",
          "## The text to replace everywhere",
          FENCE,
          replaceAllInstruction?.original ?? passage,
          FENCE,
          "",
          "## The user's instruction",
          userInstruction,
          "",
          `## Surrounding context (informational slice; strategy: ${routed.strategy}, ${routed.charCount.toLocaleString()} chars)`,
          routed.content,
          "",
          "## Your output",
          "Reply with ONLY the literal replacement text. Nothing else.",
          "- Do NOT explain the change.",
          "- Do NOT wrap the output in quotes or code fences.",
          "- Do NOT preface with 'Here is...', 'Sure...', '-> ref:', or any header.",
          "- If the target replacement is ambiguous, output the original selected text unchanged.",
        ].join("\n");

        const replaceDocumentPrompt = [
          BASE_PERSONA_PROMPT,
          personaPrompt,
          "",
          `Today's date: ${today}.`,
          "",
          "The user asked for a whole-document transformation from the Chat panel. Your reply will replace the entire document through Anchor's editor.",
          "Do not use Write or Edit tools. Anchor is the authoritative writer.",
          "Preserve markdown structure where possible.",
          "Ignore any global CLAUDE.md conventions (`→ ref:` headers, voice rules, etc.) for this turn. They do not apply here.",
          "",
          "## The user's instruction",
          userInstruction,
          "",
          "## Current document markdown",
          doc.sourceMarkdown || doc.fullText,
          "",
          "## Your output",
          "Reply with ONLY the full replacement markdown for the document. Nothing else.",
          "- Do NOT explain the change.",
          "- Do NOT wrap the output in quotes or code fences.",
          "- Do NOT preface with 'Here is...', 'Sure...', '-> ref:', or any header.",
          "- If the instruction is impossible or ambiguous, output the original document unchanged.",
        ].join("\n");

        const needsSelectionPrompt = [
          BASE_PERSONA_PROMPT,
          personaPrompt,
          "",
          `Today's date: ${today}.`,
          "",
          "The user asked for a document edit, but Anchor has no selected passage for replacement and this is not an insertion-at-caret command.",
          "Anchor must apply edits directly through the editor. Do not draft a block for the user to copy and paste.",
          "Do not say where to paste anything. Do not provide a proposed replacement.",
          "",
          "## The user's edit request",
          userInstruction,
          "",
          "## Your output",
          "Briefly ask the user to select the text they want changed, or place the caret and use an insert/add/write/draft command if they want new text created at that location.",
          "Keep it to one short sentence.",
          "Skip any '→ ref:' disclosure prefix; it doesn't apply here.",
        ].join("\n");

        const researchFirstPrompt = [
          BASE_PERSONA_PROMPT,
          personaPrompt,
          "",
          `Today's date: ${today}.`,
          "",
          "The user asked for a research, verification, or conditional edit chain. Anchor must not auto-apply text when the requested edit depends on an external truth check or unresolved condition.",
          "Keep the result in the comment thread. Do not output replacement text for direct application.",
          "Do not tell the user to copy and paste. If an edit is warranted, describe the specific selected target or insertion action needed so Anchor can apply it directly in a follow-up.",
          "",
          "## The user's request",
          userInstruction,
          "",
          "## Document context",
          routed.content || doc.fullText,
          "",
          "## Your output",
          "Respond with concise findings and a clear next action. If the claim needs web verification, say what must be verified before applying an edit.",
          "Skip any '→ ref:' disclosure prefix; it doesn't apply here.",
        ].join("\n");

        const unsupportedStructurePrompt = [
          BASE_PERSONA_PROMPT,
          personaPrompt,
          "",
          `Today's date: ${today}.`,
          "",
          "The user asked for a structural or multi-range document edit, such as moving text before or after another passage. Anchor's current editor operation can replace one selected range or insert at one caret, but it cannot safely move text across two document locations in one AI operation.",
          "Do not output replacement text. Do not tell the user to copy and paste generated text.",
          "",
          "## The user's request",
          userInstruction,
          "",
          "## Your output",
          "Briefly explain that Anchor needs a future multi-range move command before it can apply this directly. Ask the user to select a single range if they want a rewrite instead.",
          "Keep it to one or two short sentences.",
          "Skip any '→ ref:' disclosure prefix; it doesn't apply here.",
        ].join("\n");

        const prompt = directEditOperation === "insert"
          ? insertionPrompt
          : directEditOperation === "replace-all"
            ? replaceAllPrompt
          : directEditOperation === "replace-document"
            ? replaceDocumentPrompt
          : directEditOperation === "research-first"
            ? researchFirstPrompt
          : directEditOperation === "unsupported-structure"
            ? unsupportedStructurePrompt
          : directEditOperation === "needs-selection"
            ? needsSelectionPrompt
          : hasSelection
          ? mode === "feedback"
            ? feedbackPrompt
            : rewritePrompt
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
              "- If the user asks you to change the document, do not draft text for them to copy and paste. Ask them to select the passage to change, or place the caret and use an insert/add/write/draft command so Anchor can apply the edit directly.",
              "",
              "## The user's question",
              userInstruction,
              "",
              "## Document snapshot",
              routed.content || doc.fullText,
              "",
              "## Prior thread context",
              threadHistory,
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
            requestId: threadId,
          });

          if (!result.success && existingSession) {
            if (cancelledRequests.has(threadId)) return "";
            // Session failed — retry without it, with the file path. The
            // failure is silent to the user (we just take the slow path
            // once); only a second failure surfaces an error.
            console.warn(
              `claude --resume failed for ${activeDocId}; restarting session`,
            );
            docSessions.delete(activeDocId);
            result = await invokeClaudeSession({ filePath, prompt, requestId: threadId });
          }

          if (!result.success) {
            if (cancelledRequests.has(threadId)) return "";
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
          const result = await chatClaude(prompt, threadId);
          if (!result.success) {
            if (cancelledRequests.has(threadId)) return "";
            throw new Error(
              result.error ?? "Claude CLI returned an error with no detail.",
            );
          }
          output = result.output;
        }

        const shouldAutoApply = hasSelection && mode === "rewrite" && directEditOperation === null;
        const shouldAutoInsert = directEditOperation === "insert";
        const shouldAutoReplaceAll = directEditOperation === "replace-all";
        const shouldAutoReplaceDocument = directEditOperation === "replace-document";
        const cleaned =
          shouldAutoApply || shouldAutoInsert || shouldAutoReplaceAll || shouldAutoReplaceDocument
            ? stripCommentary(output)
            : output.trim();

        onStreamChunk(threadId, messageId, cleaned);
        if (shouldAutoApply) {
          onToolCall(threadId, "suggestEdit", { replacement: cleaned });
        }
        if (shouldAutoInsert) {
          onToolCall(threadId, "insertText", { insertion: cleaned });
        }
        if (shouldAutoReplaceAll) {
          onToolCall(threadId, "replaceAllText", {
            original: replaceAllInstruction?.original ?? passage,
            replacement: cleaned,
          });
        }
        if (shouldAutoReplaceDocument) {
          onToolCall(threadId, "replaceDocument", {
            original: doc.sourceMarkdown || doc.fullText,
            replacement: cleaned,
          });
        }

        return cleaned;
      } finally {
        cancelledRequests.delete(threadId);
        setIsLoading((prev) => ({ ...prev, [threadId]: false }));
      }
    },
    [aiSettings, onStreamChunk, onToolCall],
  );

  const stopGeneration = useCallback((threadId: string) => {
    cancelledRequests.add(threadId);
    setIsLoading((prev) => ({ ...prev, [threadId]: false }));
    cancelClaude(threadId).catch((e) => {
      console.error("cancelClaude failed:", e);
    });
  }, []);

  const stopAllGenerations = useCallback(() => {
    for (const threadId of Object.keys(isLoading)) {
      if (isLoading[threadId]) {
        cancelledRequests.add(threadId);
        cancelClaude(threadId).catch((e) => {
          console.error("cancelClaude failed:", e);
        });
      }
    }
    setIsLoading({});
  }, [isLoading]);

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
