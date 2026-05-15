
import type { ThreadMessage, SuggestedEdit as SuggestedEditType } from "@/types";
import { parseAiErrorMessage } from "@/lib/ai-errors";
import AppliedEdit from "./AppliedEdit";
import SuggestedEditComponent from "./SuggestedEdit";
import { AlertTriangle, Bot, User } from "lucide-react";

interface CommentMessageProps {
  message: ThreadMessage;
  suggestion?: SuggestedEditType | null;
  onAcceptSuggestion?: () => void;
  onRejectSuggestion?: () => void;
  onRevertAppliedEdit?: () => void;
}

export default function CommentMessage({
  message,
  suggestion,
  onAcceptSuggestion,
  onRejectSuggestion,
  onRevertAppliedEdit,
}: CommentMessageProps) {
  const isAI = message.role === "assistant";

  // Tool calls deliver suggestions as typed payloads now (Phase 4) — text
  // content is just the persona's prose explanation, no XML to strip.
  const displayContent = message.content;
  const aiError = isAI ? parseAiErrorMessage(displayContent) : null;

  return (
    <div className="flex gap-2">
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${
          aiError
            ? "bg-destructive/10 text-destructive"
            : isAI
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {aiError ? (
          <AlertTriangle className="h-3.5 w-3.5" />
        ) : isAI ? (
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
        {aiError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-relaxed text-foreground"
          >
            <p className="font-medium text-destructive">{aiError.title}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">
              {aiError.description}
            </p>
            {aiError.detail && (
              <p className="mt-2 whitespace-pre-wrap break-words rounded bg-background/70 px-2 py-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {aiError.detail}
              </p>
            )}
            {aiError.recovery && (
              <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                {aiError.recovery}
              </p>
            )}
          </div>
        ) : message.appliedEdit ? (
          <AppliedEdit
            edit={message.appliedEdit}
            onRevert={message.appliedEdit.status === "applied" ? onRevertAppliedEdit : undefined}
          />
        ) : displayContent ? (
          <div
            className={`text-sm leading-relaxed rounded-lg px-3 py-2 ${
              isAI
                ? "bg-muted/50 text-foreground"
                : "bg-primary/5 text-foreground"
            }`}
          >
            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
          </div>
        ) : null}

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
