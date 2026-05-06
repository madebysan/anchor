
import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import Editor from "./Editor";
import CommentSidebar from "@/components/comments/CommentSidebar";
import DocumentSidebar from "@/components/documents/DocumentSidebar";
import AISettingsDialog from "./AISettingsDialog";
import { useAIChat } from "@/hooks/useAIChat";
import { useAISettings } from "@/hooks/useAISettings";
import { useEditorPreferences } from "@/hooks/useEditorPreferences";
import { useDocumentStore } from "@/lib/document-store";
import { parseTrigger, isPlainNote } from "@/lib/triggers";
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
import { GripVertical } from "lucide-react";

const SHORTCUTS = [
  { keys: "⌘ B", desc: "Bold" },
  { keys: "⌘ I", desc: "Italic" },
  { keys: "⌘ ⇧ X", desc: "Strikethrough" },
  { keys: "⌘ E", desc: "Inline code" },
  { keys: "⌘ Z", desc: "Undo" },
  { keys: "⌘ ⇧ Z", desc: "Redo" },
  { keys: "⌘ N", desc: "New document" },
  { keys: "⌘ ⇧ V", desc: "Comment on selection" },
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

interface EditorPageProps {
  notesFolder?: string;
  onChangeNotesFolder?: () => void;
}

export default function EditorPage({
  notesFolder,
  onChangeNotesFolder,
}: EditorPageProps = {}) {
  const editorRef = useRef<TiptapEditor | null>(null);

  // Document store — single source of truth for documents, threads, persistence.
  const documents = useDocumentStore((s) => s.documents);
  const activeDocId = useDocumentStore((s) => s.activeDocId);
  const threads = useDocumentStore((s) => s.threads);
  const activeThreadId = useDocumentStore((s) => s.activeThreadId);
  const saveStatus = useDocumentStore((s) => s.saveStatus);
  const lastSavedAt = useDocumentStore((s) => s.lastSavedAt);
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

  const {
    currentFont,
    currentSize,
    setFont,
    setFontSize,
    formattingCollapsed,
    toggleFormattingCollapsed,
  } = useEditorPreferences();

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

  // AI loop — Inline MD's locked auto-apply UX.
  // 1. Claude's full response lands in the thread's last assistant message
  //    (auditability, the user can see what was applied).
  // 2. Then the same text replaces the comment-marked range in the document.
  //    Tiptap's history extension snapshots the pre-edit state, so ⌘Z reverts.
  const { sendMessage: sendAIMessage, isLoading, stopGeneration, stopAllGenerations } = useAIChat(
    (threadId, _messageId, content) => {
      useDocumentStore.getState().updateLastAssistantMessage(threadId, content);
    },
    (threadId, toolName, input) => {
      if (
        toolName !== "suggestEdit" ||
        typeof input !== "object" ||
        input === null ||
        typeof (input as { replacement?: unknown }).replacement !== "string"
      ) {
        return;
      }
      const replacement = (input as { replacement: string }).replacement;
      const editor = editorRef.current;
      if (!editor) return;

      // Find the comment mark's range for this thread and replace it.
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
      if (markFrom === null || markTo === null) return;

      const commentMark = editor.schema.marks.comment.create({ commentId: threadId });
      const newText = editor.schema.text(replacement, [commentMark]);
      const tr = editor.state.tr.replaceWith(markFrom, markTo, newText);
      editor.view.dispatch(tr);

      // Update the thread's selectedText so subsequent follow-up messages
      // operate on the post-edit passage.
      useDocumentStore.getState().updateThread(threadId, (t) => ({
        ...t,
        selectedText: replacement,
      }));
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

  // ⌘⇧V / Ctrl+Shift+V opens a comment on the current selection (or a
  // document-level comment if nothing is selected). ⌘⇧M is already taken
  // by the maximize / hide-sidebars toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === "v" || e.key === "V")) {
        const editor = editorRef.current;
        if (!editor) return;
        const { from, to } = editor.state.selection;
        if (from === to) {
          handleAddDocumentComment();
        } else {
          handleAddComment();
        }
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleAddComment]);

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

      // Comment routing:
      //   1. Explicit @trigger → that persona runs.
      //   2. Plain-note prefix ("Note:", "TODO:", "// ", etc.) → no AI, save as note.
      //   3. Existing AI history in thread → follow-up, AI continues.
      //   4. Otherwise → default persona from settings (if configured), else plain note.
      const explicitTrigger = parseTrigger(text, enabledTriggerNames);
      const plainNote = isPlainNote(text);

      let effectiveTrigger = explicitTrigger;
      if (
        !explicitTrigger &&
        !plainNote &&
        settings.defaultPersona &&
        enabledTriggerNames.includes(settings.defaultPersona)
      ) {
        effectiveTrigger = {
          type: settings.defaultPersona,
          promptText: text.trim(),
        };
      }

      const store = useDocumentStore.getState();
      store.addMessage(threadId, {
        role: "user",
        content: text,
        trigger: effectiveTrigger ?? undefined,
      });

      const thread = store.threads.find((t) => t.id === threadId);
      if (!thread) return;

      const hasAIHistory = thread.messages.some((m) => m.role === "assistant");

      const shouldRunAI = !plainNote && (effectiveTrigger || hasAIHistory);
      if (!shouldRunAI) return;

      store.addMessage(threadId, { role: "assistant", content: "" });

      // Yield once so React commits the new "thinking…" assistant message
      // before we do the synchronous prompt build + invoke. Keeps the UI
      // responsive (no spinning ball).
      await new Promise((r) => setTimeout(r, 0));

      try {
        await sendAIMessage(
          threadId,
          thread,
          getDocumentSnapshot(),
          text,
          effectiveTrigger,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        useDocumentStore
          .getState()
          .updateLastAssistantMessage(threadId, `⚠️ ${reason}`);
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
              notesFolder={notesFolder}
              onChangeNotesFolder={onChangeNotesFolder}
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
          formattingCollapsed={formattingCollapsed}
          onToggleFormattingCollapsed={toggleFormattingCollapsed}
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
              defaultPersona={settings.defaultPersona}
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
