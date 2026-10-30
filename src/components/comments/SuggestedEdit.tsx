
import type { SuggestedEdit as SuggestedEditType } from "@/types";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight } from "lucide-react";

interface SuggestedEditProps {
  suggestion: SuggestedEditType;
  onAccept: () => void;
  onReject: () => void;
}

export default function SuggestedEdit({
  suggestion,
  onAccept,
  onReject,
}: SuggestedEditProps) {
  if (suggestion.status === "accepted") {
    return (
      <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/50 p-3 text-sm">
        <p className="text-green-700 dark:text-green-400 font-medium text-xs mb-1">
          Edit accepted
        </p>
        <p className="text-green-800 dark:text-green-300">{suggestion.suggestedText}</p>
      </div>
    );
  }

  if (suggestion.status === "rejected") {
    return (
      <div className="rounded-md border border-muted bg-muted/30 p-3 text-sm opacity-60">
        <p className="text-muted-foreground font-medium text-xs mb-1">
          Edit rejected
        </p>
        <p className="text-muted-foreground line-through">
          {suggestion.suggestedText}
        </p>
      </div>
    );
  }

  // Pending state — show the diff with accept/reject buttons
  return (
    <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 p-3">
      <p className="text-amber-700 dark:text-amber-400 font-medium text-xs mb-2">
        Suggested edit
      </p>

      {/* Original text */}
      <div className="text-sm mb-2">
        <span className="text-xs text-muted-foreground block mb-0.5">
          Original:
        </span>
        <p className="text-red-600/80 dark:text-red-400/80 line-through bg-red-50 dark:bg-red-950/30 rounded px-2 py-1">
          {suggestion.originalText}
        </p>
      </div>

      <ArrowRight className="h-3 w-3 text-muted-foreground mx-auto mb-2" />

      {/* Suggested text */}
      <div className="text-sm mb-3">
        <span className="text-xs text-muted-foreground block mb-0.5">
          Suggested:
        </span>
        <p className="text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded px-2 py-1">
          {suggestion.suggestedText}
        </p>
      </div>

      {/* Accept / Reject buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          className="h-7 text-xs flex-1"
          onClick={onAccept}
        >
          <Check className="h-3 w-3 mr-1" />
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs flex-1"
          onClick={onReject}
        >
          <X className="h-3 w-3 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
}
