import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Loader2, MessageCircle, Send, Square, SquarePen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { renderChatMarkdown } from "@/lib/chat-markdown";
import {
  targetKey,
  useActiveConversation,
  useClaudeChatStore,
  type ChatItem,
  type ChatTarget,
} from "@/lib/claude-chat";
import { useEditorContextStore } from "@/lib/ide-context";
import { useSidebarStore } from "@/lib/sidebar-store";
import { cn } from "@/lib/utils";

function AssistantText({ text }: { text: string }) {
  const html = useMemo(() => renderChatMarkdown(text), [text]);
  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none min-w-0 text-sm leading-relaxed prose-p:my-1.5 prose-pre:my-2 prose-pre:whitespace-pre-wrap prose-ul:my-1.5 prose-ol:my-1.5"
      // Raw HTML in replies is escaped by renderChatMarkdown.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ToolRow({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  const icon =
    item.status === "running" ? (
      <Loader2 className="size-3 animate-spin" aria-label="Running" />
    ) : item.status === "error" ? (
      <X className="size-3 text-destructive" aria-label="Failed" />
    ) : (
      <Check className="size-3 text-emerald-500" aria-label="Done" />
    );
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-1 font-mono text-[11px] text-muted-foreground">
      {icon}
      <span className="shrink-0 text-foreground/80">{item.name}</span>
      {item.summary && <span className="min-w-0 truncate" title={item.summary}>{item.summary}</span>}
    </div>
  );
}

/** Quoted note text: the selection above the input, or what a message was sent with. */
function QuoteBlock({ text, label }: { text: string; label?: string | null }) {
  return (
    <div className="rounded-md border-l-2 border-primary/50 bg-muted/40 px-2.5 py-1.5">
      {label && <p className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>}
      <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">{text}</p>
    </div>
  );
}

/** The editor selection that will go with the next message, if any. */
function PendingSelection({ target }: { target: ChatTarget | null }) {
  const selection = useEditorContextStore((s) => s.selection);
  if (!selection || target?.kind !== "note" || selection.filePath !== target.path) return null;
  const { start, end, isEmpty } = selection.selection;
  const text = selection.text.trim();
  if (isEmpty || !text) return null;
  const count = end.line - start.line + 1;
  return <QuoteBlock text={text} label={`Selection · ${count} ${count === 1 ? "line" : "lines"}`} />;
}

function PermissionCard({ item }: { item: Extract<ChatItem, { kind: "permission" }> }) {
  const answer = (allow: boolean) => useClaudeChatStore.getState().answerPermission(item.id, allow);
  return (
    <div role="group" aria-label="Permission request" className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <p className="text-foreground">
        Claude wants to use <span className="font-medium">{item.toolName}</span>
      </p>
      {item.summary && <p className="font-mono text-[11px] text-muted-foreground">{item.summary}</p>}
      {item.status === "pending" ? (
        <div className="flex gap-1.5">
          <Button size="sm" className="h-6 text-xs" onClick={() => answer(true)}>
            Allow
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => answer(false)}>
            Deny
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">{item.status === "allowed" ? "Allowed" : "Denied"}</p>
      )}
    </div>
  );
}

function ChatItemView({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="space-y-1">
          {item.quote && <QuoteBlock text={item.quote} label={item.context} />}
          <div className="whitespace-pre-wrap break-words rounded-lg bg-primary/5 px-3 py-2 text-sm leading-relaxed">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return item.text ? <AssistantText text={item.text} /> : null;
    case "tool":
      return <ToolRow item={item} />;
    case "permission":
      return <PermissionCard item={item} />;
    case "notice":
      return (
        <div
          role={item.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex gap-2 rounded-md px-3 py-2 text-xs leading-relaxed",
            item.tone === "error"
              ? "border border-destructive/30 bg-destructive/10 text-foreground"
              : "bg-muted/50 text-muted-foreground",
          )}
        >
          {item.tone === "error" && <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />}
          <span className="whitespace-pre-wrap break-words">{item.text}</span>
        </div>
      );
  }
}

interface ClaudeChatProps {
  /** Shown above the conversation (the open note's comments). */
  leading?: ReactNode;
}

/**
 * The conversation for whatever is selected: each note and each folder has its
 * own Claude session and history.
 */
export default function ClaudeChat({ leading }: ClaudeChatProps) {
  const target = useClaudeChatStore((s) => s.target);
  const { items, busy, sessionId } = useActiveConversation();
  const key = target ? targetKey(target) : "";
  // One unsent draft per conversation, so switching notes doesn't move it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[key] ?? "";
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [key]: value }));
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusRequest = useSidebarStore((s) => s.chatFocusRequest);

  // Ask AI in the editor moves the cursor here; wait a frame for layout.
  useEffect(() => {
    if (focusRequest === 0) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items, key]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || !target) return;
    setDraft("");
    void useClaudeChatStore.getState().send(text);
  };

  // Links in replies open in the browser, never inside the app window.
  const handleLinkClick = (event: React.MouseEvent) => {
    const link = (event.target as HTMLElement).closest("a");
    if (!link) return;
    event.preventDefault();
    invoke<void>("open_external_url", { url: link.href }).catch((error) => {
      console.error("open_external_url failed:", error);
    });
  };

  const isFolder = target?.kind === "folder";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The open note is highlighted in the list and shown in the editor; a
          folder shows its own view. The header only needs Clear. */}
      <div className="flex h-11 shrink-0 items-center justify-end px-3" data-window-drag>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={items.length === 0 && !sessionId}
            title={isFolder ? "Clear this folder's conversation" : "Clear this note's conversation"}
            onClick={() => useClaudeChatStore.getState().clear()}
          >
            <SquarePen className="size-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="min-w-0 space-y-3 p-3 [overflow-wrap:anywhere]" onClick={handleLinkClick}>
          {leading}
          {leading && (
            <div className="flex items-center gap-2 pt-1" aria-hidden>
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Conversation</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          {items.length === 0 ? (
            <div
              className={cn(
                "flex flex-col items-center justify-center px-4 text-center",
                leading ? "py-6" : "min-h-48",
              )}
            >
              {!leading && <MessageCircle className="mb-2 size-6 text-muted-foreground/40" aria-hidden />}
              <p className="text-sm text-muted-foreground">
                {isFolder ? "Ask about this folder" : "Ask about this note"}
              </p>
            </div>
          ) : (
            items.map((item) => <ChatItemView key={item.id} item={item} />)
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      {busy && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <div className="flex gap-1" aria-hidden>
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => useClaudeChatStore.getState().stop()}
          >
            <Square className="mr-1 size-3" aria-hidden />
            Stop
          </Button>
        </div>
      )}

      <div className="space-y-2 border-t border-border p-3">
        <PendingSelection target={target} />
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Message…"
            aria-label="Message Claude"
            className="max-h-40 min-h-10 resize-none border-0 bg-muted/50 text-sm shadow-none focus-visible:ring-1"
            rows={1}
            disabled={!target}
          />
          <Button
            size="icon"
            className="size-9 shrink-0"
            disabled={busy || !draft.trim() || !target}
            onClick={submit}
            title="Send (Enter)"
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
