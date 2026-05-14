
import type { ThreadMessage, SuggestedEdit as SuggestedEditType } from "@/types";
import SuggestedEditComponent from "./SuggestedEdit";
import { Bot, User } from "lucide-react";

interface CommentMessageProps {
  message: ThreadMessage;
  suggestion?: SuggestedEditType | null;
  onAcceptSuggestion?: () => void;
  onRejectSuggestion?: () => void;
}

export default function CommentMessage({
  message,
  suggestion,
  onAcceptSuggestion,
  onRejectSuggestion,
}: CommentMessageProps) {
  const isAI = message.role === "assistant";

  // Tool calls deliver suggestions as typed payloads now (Phase 4) — text
  // content is just the persona's prose explanation, no XML to strip.
  const displayContent = message.content;

  return (
    <div className="flex gap-2">
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${
          isAI
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isAI ? (
          <Bot className="h-3.5 w-3.5" />
        ) : (
          <User className="h-3.5 w-3.5" />
        )}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground mb-0.5">
          {isAI ? "AI" : "You"}
        </p>

        {/* Text content */}
        {displayContent && (
          <div
            className={`text-sm leading-relaxed rounded-lg px-3 py-2 ${
              isAI
                ? "bg-muted/50 text-foreground"
                : "bg-primary/5 text-foreground"
            }`}
          >
            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
          </div>
        )}

        {/* Suggestion card (if this message has one) */}
        {suggestion && onAcceptSuggestion && onRejectSuggestion && (
          <div className="mt-2">
            {suggestion.reason && (
              <p className="mb-1.5 text-xs leading-relaxed text-muted-foreground">
                {suggestion.reason}
              </p>
            )}
            <SuggestedEditComponent
              suggestion={suggestion}
              onAccept={onAcceptSuggestion}
              onReject={onRejectSuggestion}
            />
          </div>
        )}
      </div>
    </div>
  );
}
