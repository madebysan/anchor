
import { useMemo } from "react";
import type {
  CommentThread as CommentThreadType,
  SuggestedEdit,
  TriggerConfig,
} from "@/types";
import type { DocumentSnapshot } from "@/lib/ai/context-router";
import CommentMessage from "./CommentMessage";
import CommentInput from "./CommentInput";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FileText, MessageSquare, Quote, Sparkles, Square } from "lucide-react";
import { useEffect, useRef } from "react";

interface TriggerOption {
  key: string;
  name: string;
}

interface CommentThreadProps {
  thread: CommentThreadType;
  isActive: boolean;
  onSelect: () => void;
  onSubmitMessage: (threadId: string, text: string) => void;
  onResolve: (threadId: string) => void;
  onAcceptSuggestion?: (threadId: string, suggestion: SuggestedEdit, messageId: string) => void;
  onRejectSuggestion?: (threadId: string, suggestion: SuggestedEdit, messageId: string) => void;
  isLoading?: boolean;
  onStopGeneration?: () => void;
  triggerOptions?: TriggerOption[];
  triggerConfigs?: Record<string, TriggerConfig>;
  getDocumentSnapshot?: () => DocumentSnapshot;
  defaultPersona?: string;
}

export default function CommentThread({
  thread,
  isActive,
  onSelect,
  onSubmitMessage,
  onResolve,
  onAcceptSuggestion,
  onRejectSuggestion,
  isLoading = false,
  onStopGeneration,
  triggerOptions,
  triggerConfigs,
  getDocumentSnapshot,
  defaultPersona,
}: CommentThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Suggestions land on messages directly via the suggestEdit tool call —
  // no post-hoc parsing needed.
  const messageSuggestions = useMemo(() => {
    const map: Record<string, SuggestedEdit | null> = {};
    for (const msg of thread.messages) {
      if (msg.role === "assistant" && msg.suggestedEdit) {
        map[msg.id] = msg.suggestedEdit;
      }
    }
    return map;
  }, [thread.messages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (isActive && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [thread.messages, isActive]);

  return (
    <div
      className={`rounded-lg border transition-all ${
        isActive
          ? "border-primary/50 bg-background shadow-sm"
          : "border-border bg-background/50 hover:border-primary/30 cursor-pointer"
      }`}
      onClick={() => {
        if (!isActive) onSelect();
      }}
    >
      {/* Header — selected text quote */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 min-w-0">
            {thread.selectedText ? (
              <>
                {thread.intent === "ai" ? (
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                ) : thread.intent === "note" ? (
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                ) : (
                  <Quote className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                )}
                <p className="text-xs text-muted-foreground italic line-clamp-2">
                  {thread.selectedText}
                </p>
              </>
            ) : (
              <>
                <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Entire document
                </p>
              </>
            )}
          </div>
          {isActive && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve(thread.id);
                }}
                title="Resolve thread"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Messages — only show when active */}
      {isActive && (
        <div className="px-3 pb-3">
          {thread.messages.length > 0 && (
            <div className="space-y-3 mb-3 max-h-[300px] overflow-y-auto">
              {thread.messages.map((msg) => {
                const suggestion = messageSuggestions[msg.id];
                return (
                  <CommentMessage
                    key={msg.id}
                    message={msg}
                    suggestion={suggestion}
                    onAcceptSuggestion={
                      suggestion && onAcceptSuggestion
                        ? () =>
                            onAcceptSuggestion(
                              thread.id,
                              { ...suggestion, originalText: thread.selectedText },
                              msg.id
                            )
                        : undefined
                    }
                    onRejectSuggestion={
                      suggestion && onRejectSuggestion
                        ? () =>
                            onRejectSuggestion(
                              thread.id,
                              { ...suggestion, originalText: thread.selectedText },
                              msg.id
                            )
                        : undefined
                    }
                  />
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Loading indicator + stop button */}
          {isLoading && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
              </div>
              {onStopGeneration && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground"
                  onClick={onStopGeneration}
                >
                  <Square className="h-3 w-3 mr-1" />
                  Stop
                </Button>
              )}
            </div>
          )}

          {/* Input */}
          <CommentInput
            onSubmit={(text) => onSubmitMessage(thread.id, text)}
            autoFocus
            disabled={isLoading}
            triggerOptions={triggerOptions}
            triggerConfigs={triggerConfigs}
            selectedText={thread.selectedText}
            getDocumentSnapshot={getDocumentSnapshot}
            defaultPersona={defaultPersona}
            initialIntent={thread.intent ?? "ai"}
            placeholder={
              thread.intent === "note"
                ? "Leave a note for yourself..."
                : "Ask AI to edit or respond..."
            }
          />
        </div>
      )}

      {/* Collapsed preview */}
      {!isActive && thread.messages.length > 0 && (
        <div className="px-3 pb-2">
          <p className="text-xs text-muted-foreground">
            {thread.messages.length} message
            {thread.messages.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}
      {!isActive && thread.messages.length === 0 && (
        <div className="px-3 pb-2">
          <p className="text-xs text-muted-foreground">
            {thread.intent === "ai" ? "Click to ask AI" : "Click to add a comment"}
          </p>
        </div>
      )}
    </div>
  );
}
