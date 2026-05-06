"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { AISettings, CommentThread, ParsedTrigger } from "@/types";
import { buildAIContext } from "@/lib/context-builder";
import type { DocumentSnapshot } from "@/lib/ai/context-router";
import { parseModelId, keyForProvider } from "@/lib/ai/providers";

interface UseAIChatReturn {
  sendMessage: (
    threadId: string,
    thread: CommentThread,
    doc: DocumentSnapshot,
    userMessage: string,
    trigger: ParsedTrigger | null
  ) => Promise<string>;
  isLoading: Record<string, boolean>;
  stopGeneration: (threadId: string) => void;
  stopAllGenerations: () => void;
}

// Discriminated event types from Vercel AI SDK's UI message stream protocol.
// We only care about a subset; the rest pass through silently.
interface UIMessageEvent {
  type: string;
  delta?: string;
  toolName?: string;
  // toolCallId, input shape varies — kept loose since we only read what we need.
  input?: unknown;
}

// Manages AI streaming for all threads. Routes per-persona to the right
// provider + model and parses the UI message stream (text deltas + typed tool
// calls) emitted by the server route.
export function useAIChat(
  onStreamChunk: (threadId: string, messageId: string, content: string) => void,
  onToolCall: (threadId: string, toolName: string, input: unknown) => void,
  aiSettings?: AISettings
): UseAIChatReturn {
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  const abortControllers = useRef<Record<string, AbortController>>({});
  const onStreamChunkRef = useRef(onStreamChunk);
  const onToolCallRef = useRef(onToolCall);
  onStreamChunkRef.current = onStreamChunk;
  onToolCallRef.current = onToolCall;

  // Abort all in-flight requests on unmount
  useEffect(() => {
    return () => {
      for (const controller of Object.values(abortControllers.current)) {
        controller.abort();
      }
      abortControllers.current = {};
    };
  }, []);

  const sendMessage = useCallback(
    async (
      threadId: string,
      thread: CommentThread,
      doc: DocumentSnapshot,
      userMessage: string,
      trigger: ParsedTrigger | null
    ): Promise<string> => {
      // Abort any existing request for this thread before starting a new one
      if (abortControllers.current[threadId]) {
        abortControllers.current[threadId].abort();
        delete abortControllers.current[threadId];
      }

      const triggerConfig = trigger
        ? aiSettings?.triggers[trigger.type]
        : Object.values(aiSettings?.triggers ?? {})[0];
      const modelId = triggerConfig?.modelId ?? "";
      const parsed = parseModelId(modelId);

      if (!parsed) {
        throw new Error(
          `No model configured for "${trigger?.type ?? "follow-up"}". Pick a model in Settings.`
        );
      }

      const apiKey = aiSettings
        ? keyForProvider(parsed.providerId, aiSettings)
        : "";
      if (!apiKey) {
        throw new Error(
          `No API key set for ${parsed.providerId}. Add it in Settings → Model & API.`
        );
      }

      const { systemPrompt, messages } = buildAIContext({
        thread,
        doc,
        trigger,
        userMessage,
        aiSettings,
      });

      setIsLoading((prev) => ({ ...prev, [threadId]: true }));

      const controller = new AbortController();
      abortControllers.current[threadId] = controller;

      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt,
            messages,
            providerId: parsed.providerId,
            modelName: parsed.modelName,
            apiKey,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 401) {
            const body = await response.json().catch(() => null);
            throw new Error(
              body?.error ||
                "API key missing or invalid. Check your key in Settings."
            );
          }
          throw new Error(`AI request failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullContent = "";
        const messageId = `ai-${threadId}`;
        let buffer = "";

        // SSE event-stream parser. Events are separated by \n\n; each event has
        // one or more `data: ...` lines whose value is JSON. The AI SDK's
        // UI message stream emits text-delta and tool-input-available events
        // that we route to onStreamChunk and onToolCall respectively.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          // Last entry might be incomplete; keep it in the buffer.
          buffer = events.pop() ?? "";

          for (const eventBlock of events) {
            const dataLine = eventBlock
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;

            const payload = dataLine.slice(6).trim();
            if (!payload || payload === "[DONE]") continue;

            let event: UIMessageEvent;
            try {
              event = JSON.parse(payload) as UIMessageEvent;
            } catch {
              continue; // ignore malformed chunks
            }

            if (event.type === "text-delta" && typeof event.delta === "string") {
              fullContent += event.delta;
              onStreamChunkRef.current(threadId, messageId, fullContent);
            } else if (
              event.type === "tool-input-available" &&
              typeof event.toolName === "string"
            ) {
              onToolCallRef.current(threadId, event.toolName, event.input);
            } else if (event.type === "error") {
              const msg =
                (event as { errorText?: string }).errorText ??
                "AI request failed.";
              throw new Error(msg);
            }
          }
        }

        // Flush any tail bytes (handles multi-byte chars at the end).
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;
        // Process the trailing event if it finalized without a trailing \n\n.
        if (buffer.trim()) {
          const dataLine = buffer.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            const payload = dataLine.slice(6).trim();
            if (payload && payload !== "[DONE]") {
              try {
                const event = JSON.parse(payload) as UIMessageEvent;
                if (
                  event.type === "text-delta" &&
                  typeof event.delta === "string"
                ) {
                  fullContent += event.delta;
                  onStreamChunkRef.current(threadId, messageId, fullContent);
                }
              } catch {
                // ignore
              }
            }
          }
        }

        return fullContent;
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return "";
        }
        throw err;
      } finally {
        setIsLoading((prev) => ({ ...prev, [threadId]: false }));
        delete abortControllers.current[threadId];
      }
    },
    [aiSettings]
  );

  const stopGeneration = useCallback((threadId: string) => {
    abortControllers.current[threadId]?.abort();
  }, []);

  const stopAllGenerations = useCallback(() => {
    for (const controller of Object.values(abortControllers.current)) {
      controller.abort();
    }
    abortControllers.current = {};
  }, []);

  return { sendMessage, isLoading, stopGeneration, stopAllGenerations };
}
