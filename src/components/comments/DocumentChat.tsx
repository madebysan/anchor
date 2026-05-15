import { useEffect, useMemo, useRef } from "react";
import type {
  CommentThread as CommentThreadType,
  SuggestedEdit,
  TriggerConfig,
} from "@/types";
import type { DocumentSnapshot } from "@/lib/ai/context-router";
import CommentInput from "./CommentInput";
import CommentMessage from "./CommentMessage";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Square } from "lucide-react";

interface TriggerOption {
  key: string;
  name: string;
}

interface DocumentChatProps {
  thread?: CommentThreadType;
  onSubmitMessage: (text: string) => void;
  onRevertAppliedEdit?: (
    threadId: string,
    messageId: string,
    edit: NonNullable<CommentThreadType["messages"][number]["appliedEdit"]>
  ) => void;
  isLoading?: boolean;
  onStopGeneration?: () => void;
  triggerOptions?: TriggerOption[];
  triggerConfigs?: Record<string, TriggerConfig>;
  getDocumentSnapshot?: () => DocumentSnapshot;
}

export default function DocumentChat({
  thread,
  onSubmitMessage,
  onRevertAppliedEdit,
  isLoading = false,
  onStopGeneration,
  triggerOptions,
  triggerConfigs,
  getDocumentSnapshot,
}: DocumentChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messageSuggestions = useMemo(() => {
    const map: Record<string, SuggestedEdit | null> = {};
    for (const msg of thread?.messages ?? []) {
      if (msg.role === "assistant" && msg.suggestedEdit) {
        map[msg.id] = msg.suggestedEdit;
      }
    }
    return map;
  }, [thread?.messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 p-3">
          {(thread?.messages.length ?? 0) === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <MessageCircle className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
              <p className="text-sm font-medium text-muted-foreground">No chat yet</p>
            </div>
          ) : (
            thread?.messages.map((message) => {
              const suggestion = messageSuggestions[message.id];
              return (
                <CommentMessage
                  key={message.id}
                  message={message}
                  suggestion={suggestion}
                  onRevertAppliedEdit={
                    thread && message.appliedEdit && onRevertAppliedEdit
                      ? () => onRevertAppliedEdit(thread.id, message.id, message.appliedEdit!)
                      : undefined
                  }
                />
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {isLoading && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <div className="flex gap-1" aria-hidden="true">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
          </div>
          {onStopGeneration && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={onStopGeneration}
            >
              <Square className="mr-1 h-3 w-3" aria-hidden="true" />
              Stop
            </Button>
          )}
        </div>
      )}

      <div className="border-t border-border p-3">
        <CommentInput
          onSubmit={onSubmitMessage}
          placeholder="Ask about this document..."
          ariaLabel="Chat message"
          sendLabel="Send chat message"
          disabled={isLoading}
          triggerOptions={triggerOptions}
          triggerConfigs={triggerConfigs}
          selectedText=""
          getDocumentSnapshot={getDocumentSnapshot}
        />
      </div>
    </div>
  );
}
