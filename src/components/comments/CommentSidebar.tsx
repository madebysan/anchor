
import { useState } from "react";
import type {
  CommentThread as CommentThreadType,
  SuggestedEdit,
  TriggerConfig,
} from "@/types";
import type { DocumentSnapshot } from "@/lib/ai/context-router";
import CommentThread from "./CommentThread";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { MessageSquare, Plus, ArchiveRestore } from "lucide-react";

interface TriggerOption {
  key: string;
  name: string;
}

interface CommentSidebarProps {
  threads: CommentThreadType[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onSubmitMessage: (threadId: string, text: string) => void;
  onResolveThread: (threadId: string) => void;
  onUnresolveThread?: (threadId: string) => void;
  onAddDocumentComment?: () => void;
  onAcceptSuggestion?: (threadId: string, suggestion: SuggestedEdit, messageId: string) => void;
  onRejectSuggestion?: (threadId: string, suggestion: SuggestedEdit, messageId: string) => void;
  onRevertAppliedEdit?: (
    threadId: string,
    messageId: string,
    edit: NonNullable<CommentThreadType["messages"][number]["appliedEdit"]>
  ) => void;
  isLoading?: Record<string, boolean>;
  onStopGeneration?: (threadId: string) => void;
  triggerOptions?: TriggerOption[];
  /** Full trigger configs threaded through to CommentInput's preview chip. */
  triggerConfigs?: Record<string, TriggerConfig>;
  /** Editor doc snapshot getter for the chip's char-count estimate. */
  getDocumentSnapshot?: () => DocumentSnapshot;
  /** Default persona for the routing hint in CommentInput. */
  defaultPersona?: string;
}

export default function CommentSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onSubmitMessage,
  onResolveThread,
  onUnresolveThread,
  onAddDocumentComment,
  onAcceptSuggestion,
  onRejectSuggestion,
  onRevertAppliedEdit,
  isLoading = {},
  onStopGeneration,
  triggerOptions,
  triggerConfigs,
  getDocumentSnapshot,
  defaultPersona,
}: CommentSidebarProps) {
  const [showResolved, setShowResolved] = useState(false);
  const activeThreads = threads.filter((t) => t.status === "active");
  const resolvedThreads = threads.filter((t) => t.status === "resolved");

  if (activeThreads.length === 0 && resolvedThreads.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="h-7 shrink-0"
          style={{ ["WebkitAppRegion" as never]: "drag" }}
        />
        <div className="flex flex-col items-center justify-center flex-1 text-center px-6">
          <MessageSquare className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground mb-1">
          No comments yet
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Select text and click &quot;Comment&quot; to comment on a passage,
          or add a document-level comment below.
        </p>
        {onAddDocumentComment && (
          <Button variant="outline" size="sm" onClick={onAddDocumentComment}>
            <Plus className="h-4 w-4 mr-2" />
            New Comment
          </Button>
        )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="h-7 shrink-0"
        style={{ ["WebkitAppRegion" as never]: "drag" }}
      />
      <ScrollArea className="flex-1 min-h-0">
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between px-1 mb-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Comments ({activeThreads.length})
          </h2>
          <div className="flex items-center gap-0.5">
            {resolvedThreads.length > 0 && (
              <Button
                variant={showResolved ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-[10px]"
                title={showResolved ? "Hide resolved" : "Show resolved"}
                onClick={() => setShowResolved(!showResolved)}
              >
                <ArchiveRestore className="h-3 w-3 mr-1" />
                {resolvedThreads.length} resolved
              </Button>
            )}
            {onAddDocumentComment && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="New document comment"
                onClick={onAddDocumentComment}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Active threads */}
        {activeThreads.map((thread) => (
          <CommentThread
            key={thread.id}
            thread={thread}
            isActive={activeThreadId === thread.id}
            onSelect={() => onSelectThread(thread.id)}
            onSubmitMessage={onSubmitMessage}
            onResolve={onResolveThread}
            onAcceptSuggestion={onAcceptSuggestion}
            onRejectSuggestion={onRejectSuggestion}
            onRevertAppliedEdit={onRevertAppliedEdit}
            isLoading={!!isLoading[thread.id]}
            onStopGeneration={
              onStopGeneration
                ? () => onStopGeneration(thread.id)
                : undefined
            }
            triggerOptions={triggerOptions}
            triggerConfigs={triggerConfigs}
            getDocumentSnapshot={getDocumentSnapshot}
            defaultPersona={defaultPersona}
          />
        ))}

        {/* Resolved threads */}
        {showResolved && resolvedThreads.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-1 pt-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Resolved
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            {resolvedThreads.map((thread) => (
              <div
                key={thread.id}
                className="rounded-lg border border-border bg-muted/30 opacity-60 hover:opacity-100 transition-opacity"
              >
                <div className="px-3 py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground italic line-clamp-1">
                      {thread.selectedText || "Document comment"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {onUnresolveThread && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] shrink-0"
                      onClick={() => onUnresolveThread(thread.id)}
                      title="Re-open thread"
                    >
                      Re-open
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {/* Empty state when only resolved threads exist */}
        {activeThreads.length === 0 && (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground">
              All threads resolved
            </p>
            {onAddDocumentComment && (
              <Button variant="outline" size="sm" className="mt-2" onClick={onAddDocumentComment}>
                <Plus className="h-4 w-4 mr-2" />
                New Comment
              </Button>
            )}
          </div>
        )}
      </div>
      </ScrollArea>
    </div>
  );
}
