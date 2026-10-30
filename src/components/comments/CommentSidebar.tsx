import { useEffect, useState } from "react";
import type {
  CommentThread as CommentThreadType,
  SuggestedEdit,
} from "@/types";
import CommentThread from "./CommentThread";
import ClaudeChat from "./ClaudeChat";
import { Button } from "@/components/ui/button";
import { ArchiveRestore, ChevronDown, ChevronRight } from "lucide-react";
import { useClaudeChatStore } from "@/lib/claude-chat";

interface CommentSidebarProps {
  threads: CommentThreadType[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onSubmitMessage: (threadId: string, text: string) => void;
  onResolveThread: (threadId: string) => void;
  onUnresolveThread?: (threadId: string) => void;
  onAcceptSuggestion?: (threadId: string, suggestion: SuggestedEdit, messageId: string) => void;
  onRejectSuggestion?: (threadId: string, suggestion: SuggestedEdit, messageId: string) => void;
  onRevertAppliedEdit?: (
    threadId: string,
    messageId: string,
    edit: NonNullable<CommentThreadType["messages"][number]["appliedEdit"]>
  ) => void;
}

/**
 * The right-hand panel: the open note's comments at the top, then the
 * conversation with Claude, with one input at the bottom. Comments belong to
 * the note and change when you switch notes; the conversation spans notes.
 */
export default function CommentSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onSubmitMessage,
  onResolveThread,
  onUnresolveThread,
  onAcceptSuggestion,
  onRejectSuggestion,
  onRevertAppliedEdit,
}: CommentSidebarProps) {
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  // Chat threads from earlier versions are replaced by the conversation below.
  const commentThreads = threads.filter((t) => t.intent !== "chat");
  const activeThreads = commentThreads.filter((t) => t.status === "active");
  const resolvedThreads = commentThreads.filter((t) => t.status === "resolved");
  // Comments belong to the open note; a folder's conversation shows none.
  const showingNote = useClaudeChatStore((s) => s.target?.kind !== "folder");
  const hasComments = showingNote && commentThreads.length > 0;
  const activeIsComment = commentThreads.some((t) => t.id === activeThreadId);

  // Clicking a highlighted passage selects its thread; make sure it is visible.
  useEffect(() => {
    if (activeIsComment) setCommentsOpen(true);
  }, [activeThreadId, activeIsComment]);

  const commentsBlock = hasComments ? (
    <section aria-label="Comments" className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          onClick={() => setCommentsOpen((open) => !open)}
          aria-expanded={commentsOpen}
        >
          {commentsOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          Comments ({activeThreads.length})
        </button>
        {commentsOpen && resolvedThreads.length > 0 && (
          <Button
            variant={showResolved ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            title={showResolved ? "Hide resolved" : "Show resolved"}
            onClick={() => setShowResolved(!showResolved)}
          >
            <ArchiveRestore className="mr-1 h-3 w-3" aria-hidden="true" />
            {resolvedThreads.length} resolved
          </Button>
        )}
      </div>

      {commentsOpen && (
        <>
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
            />
          ))}

          {activeThreads.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">All comments on this note are resolved.</p>
          )}

          {showResolved &&
            resolvedThreads.map((thread) => (
              <div
                key={thread.id}
                className="rounded-lg border border-border bg-muted/30 opacity-60 transition-opacity hover:opacity-100"
              >
                <div className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-xs italic text-muted-foreground">
                      {thread.selectedText || "Document comment"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {onUnresolveThread && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-2 text-[10px]"
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
    </section>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="h-7 shrink-0" data-window-drag />
      <ClaudeChat
        leading={commentsBlock}
      />
    </div>
  );
}
