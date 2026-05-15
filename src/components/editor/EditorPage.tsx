
import { lazy, Suspense, useRef, useCallback, useEffect, useState, useMemo } from "react";
import Editor from "./Editor";
import CommentSidebar from "@/components/comments/CommentSidebar";
import DocumentSidebar from "@/components/documents/DocumentSidebar";
import { useAIChat } from "@/hooks/useAIChat";
import { useAISettings } from "@/hooks/useAISettings";
import { useEditorPreferences } from "@/hooks/useEditorPreferences";
import { createAiErrorMessage } from "@/lib/ai-errors";
import {
  buildAnchorForRange,
  buildDocumentSnapshot,
  findThreadRange,
} from "@/lib/ai/document-snapshot";
import { useDocumentStore } from "@/lib/document-store";
import { getNoteTree } from "@/lib/persistence";
import type { NoteTreeNode } from "@/lib/notes-fs";
import { parseTrigger, isPlainNote } from "@/lib/triggers";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DocumentSnapshot } from "@/lib/ai/context-router";
import type { CommentThread, SuggestedEdit } from "@/types";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { GripVertical } from "lucide-react";

interface NotesChangedPayload {
  path: string;
  kind: "modified" | "created" | "removed" | "renamed";
}

const NOTES_REFRESH_DEBOUNCE_MS = 250;
const NOTES_POLL_INTERVAL_MS = 3000;
const EDITOR_CONTENT_SYNC_DEBOUNCE_MS = 200;
const AISettingsDialog = lazy(() => import("./AISettingsDialog"));

function rangeHasCommentMark(
  editor: TiptapEditor,
  from: number,
  to: number,
  commentId: string
): boolean {
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    found = node.marks.some(
      (mark) => mark.type.name === "comment" && mark.attrs.commentId === commentId
    );
    return !found;
  });
  return found;
}

function restoreCommentMarks(editor: TiptapEditor, threads: CommentThread[]): void {
  const commentMark = editor.schema.marks.comment;
  if (!commentMark) return;

  let tr = editor.state.tr;
  let modified = false;
  for (const thread of threads) {
    if (thread.status !== "active") continue;
    const range = findThreadRange(editor, thread);
    if (!range) continue;
    if (rangeHasCommentMark(editor, range.from, range.to, thread.id)) continue;
    tr = tr.addMark(range.from, range.to, commentMark.create({ commentId: thread.id }));
    modified = true;
  }

  if (modified) editor.view.dispatch(tr);
}

function applyReplacementWithHighlight(
  editor: TiptapEditor,
  threadId: string,
  replacement: string,
): { from: number; to: number } | null {
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

  if (markFrom === null || markTo === null) return null;

  const marks = [];
  const commentMark = editor.schema.marks.comment;
  if (commentMark) {
    marks.push(commentMark.create({ commentId: threadId }));
  }
  const editHighlight = editor.schema.marks.editHighlight;
  const highlightId = `edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (editHighlight) {
    marks.push(editHighlight.create({ id: highlightId }));
  }

  const replacementNode = editor.schema.text(replacement, marks);
  const tr = editor.state.tr.replaceWith(markFrom, markTo, replacementNode);
  editor.view.dispatch(tr);

  const range = { from: markFrom, to: markFrom + replacement.length };
  if (editHighlight) {
    window.setTimeout(() => {
      if (editor.isDestroyed) return;
      const to = Math.min(range.to, editor.state.doc.content.size);
      if (to <= range.from) return;
      const removeTr = editor.state.tr
        .removeMark(range.from, to, editHighlight)
        .setMeta("addToHistory", false);
      editor.view.dispatch(removeTr);
    }, 3200);
  }

  return range;
}

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
  const [docWidth, setDocWidth] = useState(240);
  const [commentWidth, setCommentWidth] = useState(360);
  const docWidthRef = useRef(docWidth);
  const commentWidthRef = useRef(commentWidth);
  const contentSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    settings,
    updateSettings,
    updateTrigger,
    resetTriggerPrompt,
    addTrigger,
    removeTrigger,
  } = useAISettings();

  const {
    currentSize,
    currentLineHeight,
    setFontSize,
    setLineHeight,
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

  // Sidebar tree = the on-disk tree from boot, augmented with any documents
  // we have in-memory that aren't on disk yet (just-created via the + button,
  // before the first save). Those land at root.
  const sidebarTree = useMemo<NoteTreeNode[]>(() => {
    const onDisk = getNoteTree();
    const seen = new Set<string>();
    const collect = (nodes: NoteTreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "file") seen.add(n.id);
        else collect(n.children);
      }
    };
    collect(onDisk);
    const synthetics: NoteTreeNode[] = documents
      .filter((d) => !seen.has(d.id))
      .map((d) => ({
        type: "file" as const,
        id: d.id,
        path: "",
        title: d.title,
        content: "",
        modified: Math.floor(d.updatedAt / 1000),
      }));
    return [...onDisk, ...synthetics];
  }, [documents]);

  const handleEditorReady = useCallback(() => {
    if (useDocumentStore.getState().initialized) return;
    useDocumentStore.getState().initialize();
  }, []);

  useEffect(() => {
    if (!initialized) return;

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let latestChangedPath: string | undefined;
    let unlisten: (() => void) | undefined;

    const flushRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      const changedPath = latestChangedPath;
      latestChangedPath = undefined;
      useDocumentStore.getState().refreshFromDisk(changedPath).catch((e) => {
        console.error("refreshFromDisk failed:", e);
      });
    };

    invoke<void>("start_watching_notes").catch((e) => {
      console.error("start_watching_notes failed:", e);
    });

    listen<NotesChangedPayload>("notes-changed", (event) => {
      if (cancelled) return;
      latestChangedPath = event.payload.path;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(flushRefresh, NOTES_REFRESH_DEBOUNCE_MS);
    })
      .then((dispose) => {
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((e) => {
        console.error("notes-changed listener failed:", e);
      });

    pollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      useDocumentStore.getState().refreshFromDisk().catch((e) => {
        console.error("refreshFromDisk poll failed:", e);
      });
    }, NOTES_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (pollTimer) clearInterval(pollTimer);
      unlisten?.();
    };
  }, [initialized]);

  // Apply pendingContentLoad to the editor without re-emitting an update
  // (otherwise the editor's onUpdate fires and writes the same content back).
  useEffect(() => {
    if (!pendingContentLoad) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.commands.setContent(pendingContentLoad.html, { emitUpdate: false });
    restoreCommentMarks(editor, useDocumentStore.getState().threads);
    useDocumentStore.getState().acknowledgeContentLoad();
  }, [pendingContentLoad]);

  const flushEditorContent = useCallback(() => {
    if (contentSyncTimerRef.current) {
      clearTimeout(contentSyncTimerRef.current);
      contentSyncTimerRef.current = null;
    }
    const editor = editorRef.current;
    if (!editor) return;
    useDocumentStore.getState().updateContent(editor.getHTML());
  }, []);

  useEffect(() => {
    return () => {
      flushEditorContent();
    };
  }, [flushEditorContent]);

  // Editor -> store: coalesce serialization so typing does not turn every
  // ProseMirror update into a full-document HTML walk.
  const handleEditorUpdate = useCallback(() => {
    if (contentSyncTimerRef.current) clearTimeout(contentSyncTimerRef.current);
    contentSyncTimerRef.current = setTimeout(
      flushEditorContent,
      EDITOR_CONTENT_SYNC_DEBOUNCE_MS,
    );
  }, [flushEditorContent]);

  // AI loop: Anchor's locked auto-apply UX.
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

      const range = applyReplacementWithHighlight(editor, threadId, replacement);
      if (!range) return;

      // Update the thread's selectedText so subsequent follow-up messages
      // operate on the post-edit passage.
      useDocumentStore.getState().updateThread(threadId, (t) => ({
        ...t,
        selectedText: replacement,
        anchor: buildAnchorForRange(editor, range.from, range.to, replacement),
      }));
    },
    settings
  );

  // Doc transitions abort in-flight AI streams before the store swaps state.
  const handleSwitchDocument = useCallback(
    (targetId: string) => {
      flushEditorContent();
      stopAllGenerations();
      useDocumentStore.getState().switchDocument(targetId);
    },
    [flushEditorContent, stopAllGenerations]
  );

  const handleCreateDocument = useCallback(() => {
    flushEditorContent();
    stopAllGenerations();
    useDocumentStore.getState().createDocument();
  }, [flushEditorContent, stopAllGenerations]);

  const handleCreateDocumentInFolder = useCallback(
    (folderId: string) => {
      flushEditorContent();
      stopAllGenerations();
      useDocumentStore.getState().createDocument(folderId);
    },
    [flushEditorContent, stopAllGenerations]
  );

  const handleDuplicateDocument = useCallback((id: string) => {
    useDocumentStore.getState().duplicateDocument(id).catch((e) => {
      console.error("duplicateDocument failed:", e);
    });
  }, []);

  const handleMoveDocumentToFolder = useCallback(
    (id: string, targetFolderId: string | null) => {
      if (id === activeDocId) flushEditorContent();
      if (id === activeDocId) stopAllGenerations();
      useDocumentStore.getState().moveDocumentToFolder(id, targetFolderId).catch((e) => {
        console.error("moveDocumentToFolder failed:", e);
      });
    },
    [activeDocId, flushEditorContent, stopAllGenerations]
  );

  const handleDeleteDocument = useCallback(
    (id: string) => {
      // If we're deleting the active doc, the store will load a different one.
      if (id === activeDocId) {
        flushEditorContent();
        stopAllGenerations();
      }
      useDocumentStore.getState().deleteDocument(id);
    },
    [activeDocId, flushEditorContent, stopAllGenerations]
  );

  const handleRenameDocument = useCallback(
    (id: string, title: string) => {
      if (id === activeDocId) flushEditorContent();
      useDocumentStore.getState().renameDocument(id, title).catch((e) => {
        console.error("renameDocument failed:", e);
      });
    },
    [activeDocId, flushEditorContent]
  );

  const toggleFocusMode = useCallback(() => setFocusMode((p) => !p), []);

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
        setSettingsOpen((p) => !p);
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
    if (!editor) return { fullText: "", sourceMarkdown: "", paragraphs: [], blocks: [], headings: [] };
    return buildDocumentSnapshot(editor, { includeSourceMarkdown: false });
  }, []);

  const handleAddComment = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const { from, to } = editor.state.selection;
    if (from === to) return;

    const selectedText = editor.state.doc.textBetween(from, to, " ");
    const threadId = useDocumentStore
      .getState()
      .createThread(selectedText, buildAnchorForRange(editor, from, to, selectedText));

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
      const threadBeforeMessage = store.threads.find((t) => t.id === threadId);
      store.addMessage(threadId, {
        role: "user",
        content: text,
        trigger: effectiveTrigger ?? undefined,
      });

      const thread = useDocumentStore.getState().threads.find((t) => t.id === threadId);
      if (!thread) return;

      const hasAIHistory =
        threadBeforeMessage?.messages.some((m) => m.role === "assistant") ?? false;

      const shouldRunAI = !plainNote && (effectiveTrigger || hasAIHistory);
      if (!shouldRunAI) return;

      store.addMessage(threadId, { role: "assistant", content: "" });

      try {
        await sendAIMessage(
          threadId,
          thread,
          getDocumentSnapshot,
          text,
          effectiveTrigger,
        );
      } catch (err) {
        console.error("AI call failed:", err);
        useDocumentStore
          .getState()
          .updateLastAssistantMessage(threadId, createAiErrorMessage(err));
      }
    },
    [sendAIMessage, getDocumentSnapshot, settings]
  );

  const handleAcceptSuggestion = useCallback(
    (threadId: string, suggestion: SuggestedEdit, messageId: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      const range = applyReplacementWithHighlight(
        editor,
        threadId,
        suggestion.suggestedText,
      );

      useDocumentStore.getState().updateThread(threadId, (t) => ({
        ...t,
        selectedText: suggestion.suggestedText,
        anchor: range
          ? buildAnchorForRange(editor, range.from, range.to, suggestion.suggestedText)
          : t.anchor,
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
          <aside
            aria-label="Documents"
            style={{ width: docWidth }}
            className="shrink-0 h-full"
          >
            <DocumentSidebar
              documents={documents}
              activeDocId={activeDocId}
              noteTree={sidebarTree}
              onCreateDocument={handleCreateDocument}
              onCreateDocumentInFolder={handleCreateDocumentInFolder}
              onSwitchDocument={handleSwitchDocument}
              onDeleteDocument={handleDeleteDocument}
              onRenameDocument={handleRenameDocument}
              onDuplicateDocument={handleDuplicateDocument}
              onMoveDocumentToFolder={handleMoveDocumentToFolder}
              notesFolder={notesFolder}
              onChangeNotesFolder={onChangeNotesFolder}
            />
          </aside>
          <DragHandle onDragStart={handleDocDragStart} onDrag={handleDocDrag} />
        </>
      )}

      <main className="flex-1 min-w-0 h-full">
        <Editor
          editorRef={editorRef}
          onReady={handleEditorReady}
          onAddComment={handleAddComment}
          onUpdate={handleEditorUpdate}
          onOpenSettings={() => setSettingsOpen(true)}
          proseSize={currentSize.proseClass}
          currentSize={currentSize}
          currentLineHeight={currentLineHeight}
          onSizeChange={setFontSize}
          onLineHeightChange={setLineHeight}
          documentTitle={documentTitle}
          saveStatus={saveStatus}
          lastSavedAt={lastSavedAt}
          focusMode={focusMode}
          onToggleFocusMode={toggleFocusMode}
          formattingCollapsed={formattingCollapsed}
          onToggleFormattingCollapsed={toggleFormattingCollapsed}
        />
      </main>

      {!focusMode && (
        <>
          <DragHandle onDragStart={handleCommentDragStart} onDrag={handleCommentDrag} />
          <aside
            aria-label="Comments"
            style={{ width: commentWidth }}
            className="shrink-0 h-full bg-muted/30"
          >
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
          </aside>
        </>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <AISettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onUpdateSettings={updateSettings}
            onUpdateTrigger={updateTrigger}
            onResetTriggerPrompt={resetTriggerPrompt}
            onAddTrigger={addTrigger}
            onRemoveTrigger={removeTrigger}
            notesFolder={notesFolder}
            onChangeNotesFolder={onChangeNotesFolder}
            currentSize={currentSize}
            currentLineHeight={currentLineHeight}
            onSizeChange={setFontSize}
            onLineHeightChange={setLineHeight}
          />
        </Suspense>
      )}

    </div>
  );
}
