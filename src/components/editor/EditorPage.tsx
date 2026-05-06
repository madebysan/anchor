"use client";

import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import Editor from "./Editor";
import CommentSidebar from "@/components/comments/CommentSidebar";
import DocumentSidebar from "@/components/documents/DocumentSidebar";
import AISettingsDialog from "./AISettingsDialog";
import SetupScreen from "./SetupScreen";
import { useAIChat } from "@/hooks/useAIChat";
import { useAISettings } from "@/hooks/useAISettings";
import { useEditorPreferences } from "@/hooks/useEditorPreferences";
import { useDocumentStore } from "@/lib/document-store";
import { parseTrigger } from "@/lib/triggers";
import type { DocumentSnapshot } from "@/lib/ai/context-router";
import type { SuggestedEdit } from "@/types";
import type { Editor as TiptapEditor } from "@tiptap/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GripVertical } from "lucide-react";
import { docToMarkdown } from "@/lib/export-markdown";

const SHORTCUTS = [
  { keys: "⌘ B", desc: "Bold" },
  { keys: "⌘ I", desc: "Italic" },
  { keys: "⌘ ⇧ X", desc: "Strikethrough" },
  { keys: "⌘ E", desc: "Inline code" },
  { keys: "⌘ Z", desc: "Undo" },
  { keys: "⌘ ⇧ Z", desc: "Redo" },
  { keys: "⌘ N", desc: "New document" },
  { keys: "⌘ ⇧ M", desc: "Toggle focus mode" },
  { keys: "⌘ /", desc: "Keyboard shortcuts" },
];

function DragHandle({
  onDragStart,
  onDrag,
}: {
  onDragStart?: () => void;
  onDrag: (delta: number) => void;
}) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onDragStart?.();
      const startX = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        onDrag(ev.clientX - startX);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [onDragStart, onDrag]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1.5 shrink-0 cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex items-center justify-center group"
    >
      <div className="h-8 w-3 rounded-sm bg-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="size-2.5 text-muted-foreground" />
      </div>
    </div>
  );
}

export default function EditorPage() {
  const editorRef = useRef<TiptapEditor | null>(null);

  // Document store — single source of truth for documents, threads, persistence.
  const documents = useDocumentStore((s) => s.documents);
  const activeDocId = useDocumentStore((s) => s.activeDocId);
  const threads = useDocumentStore((s) => s.threads);
  const activeThreadId = useDocumentStore((s) => s.activeThreadId);
  const saveStatus = useDocumentStore((s) => s.saveStatus);
  const lastSavedAt = useDocumentStore((s) => s.lastSavedAt);
  const quotaExceeded = useDocumentStore((s) => s.quotaExceeded);
  const pendingContentLoad = useDocumentStore((s) => s.pendingContentLoad);
  const initialized = useDocumentStore((s) => s.initialized);

  // Local UI state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [docWidth, setDocWidth] = useState(240);
  const [commentWidth, setCommentWidth] = useState(360);
  const docWidthRef = useRef(docWidth);
  const commentWidthRef = useRef(commentWidth);

  const {
    settings,
    updateSettings,
    updateTrigger,
    resetTriggerPrompt,
    addTrigger,
    removeTrigger,
  } = useAISettings();

  const { currentFont, currentSize, setFont, setFontSize } = useEditorPreferences();

  const triggerOptions = useMemo(
    () =>
      Object.entries(settings.triggers)
        .filter(([, config]) => config.enabled)
        .map(([key, config]) => ({ key, name: config.name })),
    [settings.triggers]
  );

  const documentTitle = useMemo(() => {
    const doc = documents.find((d) => d.id === activeDocId);
    return doc?.title || "Untitled";
  }, [documents, activeDocId]);

  // Initialize the store once the editor is ready. Tiptap mounts async
  // (immediatelyRender: false) so the ref isn't populated on EditorPage's first
  // render. A short delay lets it land before we trigger pendingContentLoad.
  useEffect(() => {
    if (initialized) return;
    const timer = setTimeout(() => {
      if (editorRef.current) {
        useDocumentStore.getState().initialize();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [initialized]);

  // Apply pendingContentLoad to the editor without re-emitting an update
  // (otherwise the editor's onUpdate fires and writes the same content back).
  useEffect(() => {
    if (!pendingContentLoad) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.commands.setContent(pendingContentLoad.html, { emitUpdate: false });
    useDocumentStore.getState().acknowledgeContentLoad();
  }, [pendingContentLoad]);

  // Editor → store: every Tiptap update writes to the store, which debounces saves.
  const handleEditorUpdate = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    useDocumentStore.getState().updateContent(editor.getHTML());
  }, []);

  // AI streaming. Text deltas flow into the last assistant message; tool calls
  // (suggestEdit) become typed suggestion cards directly — no regex parsing.
  const { sendMessage: sendAIMessage, isLoading, stopGeneration, stopAllGenerations } = useAIChat(
    (threadId, _messageId, content) => {
      useDocumentStore.getState().updateLastAssistantMessage(threadId, content);
    },
    (threadId, toolName, input) => {
      if (
        toolName === "suggestEdit" &&
        typeof input === "object" &&
        input !== null &&
        typeof (input as { replacement?: unknown }).replacement === "string"
      ) {
        const typed = input as { replacement: string; reason?: string };
        useDocumentStore.getState().setLastAssistantSuggestion(threadId, typed);
      }
    },
    settings
  );

  // Doc transitions abort in-flight AI streams before the store swaps state.
  const handleSwitchDocument = useCallback(
    (targetId: string) => {
      stopAllGenerations();
      useDocumentStore.getState().switchDocument(targetId);
    },
    [stopAllGenerations]
  );

  const handleCreateDocument = useCallback(() => {
    stopAllGenerations();
    useDocumentStore.getState().createDocument();
  }, [stopAllGenerations]);

  const handleDeleteDocument = useCallback(
    (id: string) => {
      // If we're deleting the active doc, the store will load a different one.
      if (id === activeDocId) stopAllGenerations();
      useDocumentStore.getState().deleteDocument(id);
    },
    [activeDocId, stopAllGenerations]
  );

  const handleRenameDocument = useCallback(
    (id: string, title: string) => {
      useDocumentStore.getState().renameDocument(id, title);
    },
    []
  );

  // Recovery: export current doc as Markdown when localStorage is full.
  const handleEmergencyExport = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const safeTitle = (documentTitle || "Untitled")
      .replace(/[/\\?%*:|"<>]/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "Untitled";
    const md = docToMarkdown(editor.state.doc);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [documentTitle]);

  const toggleFocusMode = useCallback(() => setFocusMode((p) => !p), []);
  const toggleShortcuts = useCallback(() => setShortcutsOpen((p) => !p), []);

  const handleDocDragStart = useCallback(() => {
    docWidthRef.current = docWidth;
  }, [docWidth]);

  const handleDocDrag = useCallback((delta: number) => {
    setDocWidth(Math.max(180, Math.min(450, docWidthRef.current + delta)));
  }, []);

  const handleCommentDragStart = useCallback(() => {
    commentWidthRef.current = commentWidth;
  }, [commentWidth]);

  const handleCommentDrag = useCallback((delta: number) => {
    setCommentWidth(Math.max(240, Math.min(600, commentWidthRef.current - delta)));
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        handleCreateDocument();
        return;
      }
      if (meta && e.shiftKey && e.key === "m") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (meta && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((p) => !p);
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCreateDocument, toggleFocusMode]);

  // Walk the editor's top-level block nodes to build a DocumentSnapshot for
  // the context router. Headings get captured separately so strategies like
  // "outline" and "outline-plus-passage" can use them without re-parsing.
  const getDocumentSnapshot = useCallback((): DocumentSnapshot => {
    const editor = editorRef.current;
    if (!editor) return { fullText: "", paragraphs: [], headings: [] };

    const paragraphs: string[] = [];
    const headings: { level: number; text: string }[] = [];

    editor.state.doc.forEach((node) => {
      const text = node.textContent;
      if (!text) return;
      paragraphs.push(text);
      if (node.type.name === "heading") {
        const level = (node.attrs as { level?: number }).level ?? 1;
        headings.push({ level, text });
      }
    });

    return {
      fullText: paragraphs.join("\n\n"),
      paragraphs,
      headings,
    };
  }, []);

  const handleAddComment = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const { from, to } = editor.state.selection;
    if (from === to) return;

    const selectedText = editor.state.doc.textBetween(from, to, " ");
    const threadId = useDocumentStore.getState().createThread(selectedText);

    editor.chain().focus().setMark("comment", { commentId: threadId }).run();
  }, []);

  const handleAddDocumentComment = useCallback(() => {
    useDocumentStore.getState().createThread("");
  }, []);

  const handleSelectThread = useCallback((id: string | null) => {
    useDocumentStore.getState().setActiveThreadId(id);
  }, []);

  const handleSubmitMessage = useCallback(
    async (threadId: string, text: string) => {
      const enabledTriggerNames = Object.entries(settings.triggers)
        .filter(([, config]) => config.enabled)
        .map(([key]) => key);
      const trigger = parseTrigger(text, enabledTriggerNames);

      const store = useDocumentStore.getState();
      store.addMessage(threadId, {
        role: "user",
        content: text,
        trigger: trigger ?? undefined,
      });

      const thread = store.threads.find((t) => t.id === threadId);
      if (!thread) return;

      const hasAIHistory = thread.messages.some((m) => m.role === "assistant");

      if (trigger || hasAIHistory) {
        store.addMessage(threadId, { role: "assistant", content: "" });

        try {
          await sendAIMessage(threadId, thread, getDocumentSnapshot(), text, trigger);
        } catch (err) {
          // Surface the real error verbatim so model/key/network problems are
          // diagnosable. Prefixed so it's visually distinct from a real reply.
          const reason = err instanceof Error ? err.message : "Unknown error";
          useDocumentStore
            .getState()
            .updateLastAssistantMessage(threadId, `⚠️ ${reason}`);
        }
      }
    },
    [sendAIMessage, getDocumentSnapshot, settings]
  );

  const handleAcceptSuggestion = useCallback(
    (threadId: string, suggestion: SuggestedEdit, messageId: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      const { doc } = editor.state;
      let markFrom: number | null = null;
      let markTo: number | null = null;

      doc.descendants((node, pos) => {
        node.marks.forEach((mark) => {
          if (mark.type.name === "comment" && mark.attrs.commentId === threadId) {
            if (markFrom === null) markFrom = pos;
            markTo = pos + node.nodeSize;
          }
        });
      });

      if (markFrom !== null && markTo !== null) {
        const commentMark = editor.schema.marks.comment.create({ commentId: threadId });
        const newText = editor.schema.text(suggestion.suggestedText, [commentMark]);
        const tr = editor.state.tr.replaceWith(markFrom, markTo, newText);
        editor.view.dispatch(tr);
      }

      useDocumentStore.getState().updateThread(threadId, (t) => ({
        ...t,
        selectedText: suggestion.suggestedText,
        messages: t.messages.map((m) =>
          m.id === messageId
            ? { ...m, suggestedEdit: { ...suggestion, status: "accepted" as const } }
            : m
        ),
      }));
    },
    []
  );

  const handleRejectSuggestion = useCallback(
    (threadId: string, suggestion: SuggestedEdit, messageId: string) => {
      useDocumentStore.getState().updateThread(threadId, (t) => ({
        ...t,
        messages: t.messages.map((m) =>
          m.id === messageId
            ? { ...m, suggestedEdit: { ...suggestion, status: "rejected" as const } }
            : m
        ),
      }));
    },
    []
  );

  const handleResolveThread = useCallback((threadId: string) => {
    const editor = editorRef.current;
    if (editor) {
      const { doc, tr } = editor.state;
      let modified = false;
      doc.descendants((node, pos) => {
        node.marks.forEach((mark) => {
          if (mark.type.name === "comment" && mark.attrs.commentId === threadId) {
            tr.removeMark(pos, pos + node.nodeSize, mark.type);
            modified = true;
          }
        });
      });
      if (modified) editor.view.dispatch(tr);
    }
    useDocumentStore.getState().resolveThread(threadId);
  }, []);

  const handleUnresolveThread = useCallback((threadId: string) => {
    useDocumentStore.getState().unresolveThread(threadId);
  }, []);

  const dismissQuotaWarning = useCallback(() => {
    useDocumentStore.getState().dismissQuotaWarning();
  }, []);

  // Gate: show setup screen until the user provides at least one API key.
  // Either Anthropic or DeepSeek is enough — the per-persona model picker
  // gates which providers any given persona can use.
  if (!settings.anthropicKey && !settings.deepseekKey) {
    return (
      <SetupScreen
        onComplete={({ anthropicKey, deepseekKey }) =>
          updateSettings({ anthropicKey, deepseekKey })
        }
      />
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {!focusMode && (
        <>
          <div style={{ width: docWidth }} className="shrink-0 h-full">
            <DocumentSidebar
              documents={documents}
              activeDocId={activeDocId}
              onCreateDocument={handleCreateDocument}
              onSwitchDocument={handleSwitchDocument}
              onDeleteDocument={handleDeleteDocument}
              onRenameDocument={handleRenameDocument}
            />
          </div>
          <DragHandle onDragStart={handleDocDragStart} onDrag={handleDocDrag} />
        </>
      )}

      <div className="flex-1 min-w-0 h-full">
        <Editor
          editorRef={editorRef}
          onAddComment={handleAddComment}
          onUpdate={handleEditorUpdate}
          onOpenSettings={() => setSettingsOpen(true)}
          fontFamily={currentFont.cssVar}
          proseSize={currentSize.proseClass}
          currentFont={currentFont}
          currentSize={currentSize}
          onFontChange={setFont}
          onSizeChange={setFontSize}
          documentTitle={documentTitle}
          saveStatus={saveStatus}
          lastSavedAt={lastSavedAt}
          focusMode={focusMode}
          onToggleFocusMode={toggleFocusMode}
          onToggleShortcuts={toggleShortcuts}
        />
      </div>

      {!focusMode && (
        <>
          <DragHandle onDragStart={handleCommentDragStart} onDrag={handleCommentDrag} />
          <div style={{ width: commentWidth }} className="shrink-0 h-full bg-muted/30">
            <CommentSidebar
              threads={threads}
              activeThreadId={activeThreadId}
              onSelectThread={handleSelectThread}
              onSubmitMessage={handleSubmitMessage}
              onResolveThread={handleResolveThread}
              onUnresolveThread={handleUnresolveThread}
              onAddDocumentComment={handleAddDocumentComment}
              onAcceptSuggestion={handleAcceptSuggestion}
              onRejectSuggestion={handleRejectSuggestion}
              isLoading={isLoading}
              onStopGeneration={stopGeneration}
              triggerOptions={triggerOptions}
              triggerConfigs={settings.triggers}
              getDocumentSnapshot={getDocumentSnapshot}
            />
          </div>
        </>
      )}

      <AISettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onUpdateSettings={updateSettings}
        onUpdateTrigger={updateTrigger}
        onResetTriggerPrompt={resetTriggerPrompt}
        onAddTrigger={addTrigger}
        onRemoveTrigger={removeTrigger}
      />

      <AlertDialog open={quotaExceeded} onOpenChange={(open) => !open && dismissQuotaWarning()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Storage full</AlertDialogTitle>
            <AlertDialogDescription>
              Your browser has run out of space for new edits. Export your current
              document now to keep it safe, then delete older documents to free up
              space. Recent edits since the last successful save may not be persisted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Dismiss</AlertDialogCancel>
            <AlertDialogAction onClick={handleEmergencyExport}>
              Export Markdown
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription className="sr-only">List of available keyboard shortcuts</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between py-1">
                <span className="text-sm text-foreground">{s.desc}</span>
                <kbd className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
