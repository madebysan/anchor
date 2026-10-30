
import { lazy, Suspense, useRef, useCallback, useEffect, useState, useMemo } from "react";
import Editor from "./Editor";
import CommentSidebar from "@/components/comments/CommentSidebar";
import DocumentSidebar from "@/components/documents/DocumentSidebar";
import WelcomeDialog from "@/components/onboarding/WelcomeDialog";
import FolderOverview from "./FolderOverview";
import { scheduleIdeContextPush } from "@/lib/ide-context";
import { applyOutsideEdit } from "@/lib/outside-edit";
import { installWindowDrag } from "@/lib/window-drag";
import { isToggleShortcut, useTerminalStore } from "@/lib/terminal";
import { useClaudeChatStore } from "@/lib/claude-chat";
import { useEditorPreferences } from "@/hooks/useEditorPreferences";
import {
  buildAnchorForRange,
  findThreadRange,
} from "@/lib/ai/document-snapshot";
import { useDocumentStore } from "@/lib/document-store";
import { markdownToHtml } from "@/lib/markdown";
import { getDocIdByPath, getDocPath, getNoteTree } from "@/lib/persistence";
import type { NoteTreeNode } from "@/lib/notes-fs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppliedEdit, CommentAnchor, CommentThread, SuggestedEdit } from "@/types";
import { DOMParser as ProseMirrorDOMParser, type Mark } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { GripVertical } from "lucide-react";

interface NotesChangedPayload {
  path: string;
  kind: "modified" | "created" | "removed" | "renamed";
}

// xterm.js is large; load it the first time the terminal opens.
const TerminalPanel = lazy(() => import("@/components/terminal/TerminalPanel"));

const NOTES_REFRESH_DEBOUNCE_MS = 250;
// The file watcher reports changes as they happen; this slower check only
// catches what it misses (cloud-synced folders can drop events). A check
// reads only the notes whose version changed.
const NOTES_POLL_INTERVAL_MS = 15000;
const EDITOR_CONTENT_SYNC_DEBOUNCE_MS = 200;

function looksLikeStructuredMarkdown(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\n\s*\n/.test(trimmed)) return true;
  if (/^#{1,6}\s+\S/m.test(trimmed)) return true;
  if (/^[-*+]\s+\S/m.test(trimmed)) return true;
  if (/^\d+\.\s+\S/m.test(trimmed)) return true;
  if (/^>\s+\S/m.test(trimmed)) return true;
  if (/```[\s\S]*```/.test(trimmed)) return true;
  if (/^\|.+\|\s*$/m.test(trimmed) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(trimmed)) return true;
  if (/<table[\s>]/i.test(trimmed)) return true;
  return false;
}

function hasMultiplePlainLines(text: string): boolean {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length > 1;
}

function shouldApplyAsMarkdownBlock(text: string): boolean {
  return looksLikeStructuredMarkdown(text) || hasMultiplePlainLines(text);
}

function normalizeMarkdownBlock(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (looksLikeStructuredMarkdown(trimmed)) return trimmed;

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

function parseMarkdownSlice(editor: TiptapEditor, markdown: string) {
  const html = markdownToHtml(markdown);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return ProseMirrorDOMParser
    .fromSchema(editor.state.schema)
    .parseSlice(wrapper);
}

function plainTextForRange(editor: TiptapEditor, from: number, to: number): string {
  return editor.state.doc.textBetween(from, to, " ");
}

function selectedListMarkdownForRange(
  editor: TiptapEditor,
  from: number,
  to: number,
): string | null {
  const items: Array<{ marker: string; text: string }> = [];

  editor.state.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (node.type.name !== "listItem") return true;
    if (!parent || (parent.type.name !== "bulletList" && parent.type.name !== "orderedList")) {
      return true;
    }

    const contentStart = pos + 1;
    const contentFrom = Math.max(0, from - contentStart);
    const contentTo = Math.min(node.content.size, to - contentStart);
    if (contentTo <= contentFrom) return false;

    const text = node.textBetween(contentFrom, contentTo, "\n").trim();
    if (!text) return false;

    const marker = parent.type.name === "orderedList"
      ? `${((parent.attrs.start as number | undefined) ?? 1) + index}.`
      : "-";
    items.push({ marker, text });
    return false;
  });

  if (items.length === 0) return null;
  return items.map((item) => `${item.marker} ${item.text}`).join("\n");
}

function selectedPromptTextForRange(editor: TiptapEditor, from: number, to: number): string {
  const listMarkdown = selectedListMarkdownForRange(editor, from, to);
  if (listMarkdown) return listMarkdown;

  const blockText = editor.state.doc.textBetween(from, to, "\n\n").trim();
  if (blockText) return blockText;

  return plainTextForRange(editor, from, to).trim();
}

function buildThreadAnchorForRange(
  editor: TiptapEditor,
  from: number,
  to: number,
  selectedText: string,
): CommentAnchor {
  return {
    ...buildAnchorForRange(editor, from, to, plainTextForRange(editor, from, to)),
    sourceText: selectedText,
  };
}
const SettingsDialog = lazy(() => import("./SettingsDialog"));

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
    if (thread.intent === "chat") continue;
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
  thread: CommentThread,
  replacement: string,
): { from: number; to: number } | null {
  const threadId = thread.id;
  const existingRange = thread.intent === "chat"
    ? findStoredAnchorRange(editor, thread)
    : findThreadRange(editor, thread);
  if (!existingRange) return null;
  const markFrom = existingRange.from;
  const markTo = existingRange.to;

  const marks = [];
  const commentMark = editor.schema.marks.comment;
  if (commentMark && thread.intent !== "chat") {
    marks.push(commentMark.create({ commentId: threadId }));
  }
  const editHighlight = editor.schema.marks.editHighlight;
  const highlightId = `edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (editHighlight) {
    marks.push(editHighlight.create({ id: highlightId }));
  }

  if (replacement.length === 0) {
    editor.view.dispatch(editor.state.tr.delete(markFrom, markTo));
    return { from: markFrom, to: markFrom };
  }

  let range = { from: markFrom, to: markFrom + replacement.length };
  if (shouldApplyAsMarkdownBlock(replacement)) {
    const slice = parseMarkdownSlice(editor, normalizeMarkdownBlock(replacement));
    let tr = editor.state.tr.replaceRange(markFrom, markTo, slice);
    range = { from: markFrom, to: markFrom + slice.size };
    for (const mark of marks) {
      tr = tr.addMark(range.from, range.to, mark);
    }
    editor.view.dispatch(tr);
  } else {
    const tr = editor.state.tr.replaceWith(markFrom, markTo, editor.schema.text(replacement, marks));
    editor.view.dispatch(tr);
  }

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

function findStoredAnchorRange(
  editor: TiptapEditor,
  thread: CommentThread,
): { from: number; to: number } | null {
  const from = thread.anchor?.pmFrom;
  const to = thread.anchor?.pmTo;
  if (typeof from !== "number" || typeof to !== "number") {
    return findThreadRange(editor, thread);
  }

  const boundedFrom = Math.max(0, Math.min(from, editor.state.doc.content.size));
  const boundedTo = Math.max(boundedFrom, Math.min(to, editor.state.doc.content.size));
  if (boundedTo <= boundedFrom) return findThreadRange(editor, thread);

  return { from: boundedFrom, to: boundedTo };
}

interface ReplaceAllResult {
  count: number;
  range: { from: number; to: number };
}

interface TextMatch {
  from: number;
  to: number;
  isThreadMatch: boolean;
  marks: readonly Mark[];
}

function isWordCharacter(character: string | undefined): boolean {
  return !!character && /[\p{L}\p{N}_]/u.test(character);
}

function findTextMatchIndexes(text: string, search: string, ignoreCase = false): number[] {
  if (!search) return [];

  const indexes: number[] = [];
  const useTokenBoundaries = /^[\p{L}\p{N}_]+$/u.test(search);
  const haystack = ignoreCase ? text.toLocaleLowerCase() : text;
  const needle = ignoreCase ? search.toLocaleLowerCase() : search;
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + search.length];
    if (
      !useTokenBoundaries ||
      (!isWordCharacter(before) && !isWordCharacter(after))
    ) {
      indexes.push(index);
    }
    index = haystack.indexOf(needle, index + search.length);
  }

  return indexes;
}

function applyReplaceAllWithHighlight(
  editor: TiptapEditor,
  threadId: string,
  original: string,
  replacement: string,
): ReplaceAllResult | null {
  if (!original || original === replacement) return null;

  const matches: TextMatch[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? "";
    const exactIndexes = findTextMatchIndexes(text, original);
    const indexes = exactIndexes.length > 0
      ? exactIndexes
      : findTextMatchIndexes(text, original, true);
    for (const index of indexes) {
      matches.push({
        from: pos + index,
        to: pos + index + original.length,
        isThreadMatch: node.marks.some(
          (mark) => mark.type.name === "comment" && mark.attrs.commentId === threadId,
        ),
        marks: node.marks,
      });
    }
  });

  if (matches.length === 0) return null;

  const editHighlight = editor.schema.marks.editHighlight;
  const highlightId = `edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let tr = editor.state.tr;

  for (const match of [...matches].reverse()) {
    if (replacement.length === 0) {
      tr = tr.delete(match.from, match.to);
      continue;
    }

    const marks = editHighlight
      ? [
          ...match.marks.filter((mark) => mark.type !== editHighlight),
          editHighlight.create({ id: highlightId }),
        ]
      : match.marks;
    tr = tr.replaceWith(match.from, match.to, editor.schema.text(replacement, marks));
  }

  editor.view.dispatch(tr);

  const anchorMatch = matches.find((match) => match.isThreadMatch) ?? matches[0];
  const range = {
    from: anchorMatch.from,
    to: anchorMatch.from + replacement.length,
  };

  if (editHighlight) {
    window.setTimeout(() => {
      if (editor.isDestroyed) return;
      const removeTr = editor.state.tr
        .removeMark(0, editor.state.doc.content.size, editHighlight)
        .setMeta("addToHistory", false);
      editor.view.dispatch(removeTr);
    }, 3200);
  }

  return { count: matches.length, range };
}

function applyDocumentReplacement(
  editor: TiptapEditor,
  replacementMarkdown: string,
): void {
  const html = markdownToHtml(replacementMarkdown);
  editor.commands.setContent(html, { emitUpdate: false });
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
      className="relative w-1.5 shrink-0 cursor-col-resize before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border hover:bg-primary/30 active:bg-primary/50 transition-colors flex items-center justify-center group"
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

  // Document store: single source of truth for documents, threads, persistence.
  const documents = useDocumentStore((s) => s.documents);
  const activeDocId = useDocumentStore((s) => s.activeDocId);
  const threads = useDocumentStore((s) => s.threads);
  const activeThreadId = useDocumentStore((s) => s.activeThreadId);
  const saveStatus = useDocumentStore((s) => s.saveStatus);
  const lastSavedAt = useDocumentStore((s) => s.lastSavedAt);
  const pendingContentLoad = useDocumentStore((s) => s.pendingContentLoad);
  const initialized = useDocumentStore((s) => s.initialized);
  const terminalStarted = useTerminalStore((s) => s.started);
  const folderTarget = useClaudeChatStore((s) => (s.target?.kind === "folder" ? s.target.path : null));

  // Local UI state
  const [settingsOpen, setSettingsOpenState] = useState(false);
  // Where focus was when Settings opened, to return it on close.
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  const setSettingsOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setSettingsOpenState((open) => {
      const value = typeof next === "function" ? next(open) : next;
      if (value && !open) {
        const active = document.activeElement;
        settingsReturnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
      }
      if (!value && open) {
        // The window unmounts as it closes, so put focus back ourselves.
        window.setTimeout(() => {
          const back =
            settingsReturnFocus.current?.isConnected
              ? settingsReturnFocus.current
              : document.querySelector<HTMLElement>('button[title="Settings"]');
          back?.focus();
        }, 0);
      }
      return value;
    });
  }, []);
  const [focusMode, setFocusMode] = useState(false);
  const [docWidth, setDocWidth] = useState(240);
  const [commentWidth, setCommentWidth] = useState(360);
  const [editorReady, setEditorReady] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const [mainHeight, setMainHeight] = useState(0);
  const docWidthRef = useRef(docWidth);
  const commentWidthRef = useRef(commentWidth);
  const contentSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Editor HTML right after the note loaded (or last synced): unchanged means unedited. */
  const syncedHtmlRef = useRef<string | null>(null);
  /** Read out by screen readers (a polite live region at the end of the page). */
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((text: string) => {
    // Clear first so the same message is announced again.
    setAnnouncement("");
    window.setTimeout(() => setAnnouncement(text), 50);
  }, []);

  const {
    currentSize,
    currentLineHeight,
    setFontSize,
    setLineHeight,
    currentSpacing,
    setSpacing,
  } = useEditorPreferences();

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
        modified: Math.floor(d.updatedAt / 1000),
        version: "",
      }));
    return [...onDisk, ...synthetics];
  }, [documents]);

  const handleEditorReady = useCallback(() => {
    setEditorReady(true);
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

    const poll = () => {
      if (document.visibilityState !== "visible") return;
      useDocumentStore.getState().refreshFromDisk().catch((e) => {
        console.error("refreshFromDisk poll failed:", e);
      });
    };
    pollTimer = setInterval(poll, NOTES_POLL_INTERVAL_MS);
    // Coming back to the window checks right away.
    window.addEventListener("focus", poll);

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (pollTimer) clearInterval(pollTimer);
      window.removeEventListener("focus", poll);
      unlisten?.();
    };
  }, [initialized]);

  // Apply pendingContentLoad to the editor without re-emitting an update
  // (otherwise the editor's onUpdate fires and writes the same content back).
  useEffect(() => {
    if (!pendingContentLoad) return;
    const editor = editorRef.current;
    if (!editor) return;
    // A change written by another app to the open note goes in as one edit:
    // selected, and undone with ⌘Z. Anything else replaces the editor content.
    let unsavedTyping = false;
    if (pendingContentLoad.outside) {
      const result = applyOutsideEdit(editor, pendingContentLoad.html, pendingContentLoad.baseHtml);
      unsavedTyping = result.unsavedTyping;
      if (result.applied) {
        announce("The note changed outside Anchor. The change is selected; press Command Z to undo it.");
      }
    } else {
      editor.commands.setContent(pendingContentLoad.html, { emitUpdate: false });
      restoreCommentMarks(editor, useDocumentStore.getState().threads);
      // A newly opened note starts with its own undo history; ⌘Z must not
      // step back into the previous note.
      const { state } = editor;
      editor.view.updateState(
        EditorState.create({ doc: state.doc, plugins: state.plugins, selection: state.selection }),
      );
    }
    // The editor may still hold typing that never reached the disk (its save
    // was dropped when the outside change arrived). Mark it unsaved so it is
    // written now, on top of the other app's change.
    syncedHtmlRef.current = unsavedTyping ? pendingContentLoad.html : editor.getHTML();
    if (unsavedTyping) window.setTimeout(() => flushEditorContent(), 0);
    useDocumentStore.getState().acknowledgeContentLoad();
    const docPath = pendingContentLoad.docId ? getDocPath(pendingContentLoad.docId) : null;
    scheduleIdeContextPush(editor, docPath);
  }, [pendingContentLoad]);

  // Claude in the terminal follows the open note: push the note and the
  // selection whenever either changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor) return;
    const push = () => scheduleIdeContextPush(editor, activeDocId ? getDocPath(activeDocId) : null);
    // Working in the note brings its conversation back after a folder's.
    const focusNote = () => {
      push();
      const path = activeDocId ? getDocPath(activeDocId) : null;
      if (path) useClaudeChatStore.getState().setTarget({ kind: "note", path });
    };
    editor.on("selectionUpdate", push);
    editor.on("focus", focusNote);
    push();
    return () => {
      editor.off("selectionUpdate", push);
      editor.off("focus", focusNote);
    };
  }, [editorReady, activeDocId]);

  // Connection status for the terminal header, and Claude's "open this file".
  useEffect(() => {
    let cancelled = false;
    const disposers: Array<() => void> = [];
    invoke<number>("ide_connected_clients")
      .then((count) => {
        if (!cancelled) useTerminalStore.getState().setConnectedClaudes(count);
      })
      .catch(() => {});
    void listen<{ connected: number }>("ide-clients-changed", (event) => {
      useTerminalStore.getState().setConnectedClaudes(event.payload.connected);
    }).then((dispose) => (cancelled ? dispose() : disposers.push(dispose)));
    void listen<{ path: string }>("ide-open-file", (event) => {
      const id = getDocIdByPath(event.payload.path);
      if (id) useDocumentStore.getState().switchDocument(id);
    }).then((dispose) => (cancelled ? dispose() : disposers.push(dispose)));
    return () => {
      cancelled = true;
      disposers.forEach((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    useTerminalStore.getState().setNotesFolder(notesFolder);
  }, [notesFolder]);

  // ⌃` shows or hides the terminal from anywhere in the window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isToggleShortcut(event)) return;
      event.preventDefault();
      useTerminalStore.getState().toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The terminal's drag limit depends on the editor column's height.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const observer = new ResizeObserver(() => setMainHeight(main.clientHeight));
    observer.observe(main);
    return () => observer.disconnect();
  }, []);

  const flushEditorContent = useCallback(() => {
    if (contentSyncTimerRef.current) {
      clearTimeout(contentSyncTimerRef.current);
      contentSyncTimerRef.current = null;
    }
    const editor = editorRef.current;
    if (!editor) return;
    // Switching notes flushes too; a note that was only read must not be
    // rewritten, or files from other tools lose their formatting.
    const html = editor.getHTML();
    if (html === syncedHtmlRef.current) return;
    syncedHtmlRef.current = html;
    useDocumentStore.getState().updateContent(html);
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

  // Doc transitions abort in-flight AI streams before the store swaps state.
  const handleSwitchDocument = useCallback(
    (targetId: string) => {
      flushEditorContent();
      useDocumentStore.getState().switchDocument(targetId);
      // Clicking a note (even the open one) brings back its own conversation.
      const path = getDocPath(targetId);
      if (path) useClaudeChatStore.getState().setTarget({ kind: "note", path });
    },
    [flushEditorContent]
  );

  const handleCreateDocument = useCallback(() => {
    flushEditorContent();
    useDocumentStore.getState().createDocument();
  }, [flushEditorContent]);

  const handleCreateDocumentInFolder = useCallback(
    (folderId: string) => {
      flushEditorContent();
      useDocumentStore.getState().createDocument(folderId);
    },
    [flushEditorContent]
  );

  const handleDuplicateDocument = useCallback((id: string) => {
    useDocumentStore.getState().duplicateDocument(id).catch((e) => {
      console.error("duplicateDocument failed:", e);
    });
  }, []);

  const handleMoveDocumentToFolder = useCallback(
    (id: string, targetFolderId: string | null) => {
      if (id === activeDocId) flushEditorContent();
      useDocumentStore.getState().moveDocumentToFolder(id, targetFolderId).catch((e) => {
        console.error("moveDocumentToFolder failed:", e);
      });
    },
    [activeDocId, flushEditorContent]
  );

  const handleDeleteDocument = useCallback(
    (id: string) => {
      // If we're deleting the active doc, the store will load a different one.
      if (id === activeDocId) {
        flushEditorContent();
      }
      useDocumentStore.getState().deleteDocument(id);
    },
    [activeDocId, flushEditorContent]
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

  // Headers move the window like a title bar.
  useEffect(() => installWindowDrag(), []);

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
      // ⌘, is the macOS convention; ⌘/ is kept from earlier versions.
      if (meta && (e.key === "," || e.key === "/")) {
        e.preventDefault();
        setSettingsOpen((p) => !p);
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCreateDocument, toggleFocusMode]);

  const createAnchoredThread = useCallback((intent: "note" | "ai") => {
    const editor = editorRef.current;
    if (!editor) return;

    const { from, to } = editor.state.selection;
    if (from === to) return;

    const selectedText = selectedPromptTextForRange(editor, from, to);
    const threadId = useDocumentStore
      .getState()
      .createThread(
        selectedText,
        buildThreadAnchorForRange(editor, from, to, selectedText),
        intent
      );

    editor.chain().focus().setMark("comment", { commentId: threadId }).run();
  }, []);

  const handleAddComment = useCallback(() => {
    createAnchoredThread("note");
  }, [createAnchoredThread]);

  // Each note has its own conversation. Follow the open note, but only when it
  // changes: a refresh after Claude renames files in a folder must not pull a
  // folder conversation back to the note.
  const lastNoteTargetRef = useRef<string | null>(null);
  useEffect(() => {
    const path = activeDocId ? getDocPath(activeDocId) : null;
    if (path === lastNoteTargetRef.current) return;
    lastNoteTargetRef.current = path;
    // Opening a note from the list sets the target itself; this only follows
    // loads and moves, and never takes over while a folder is selected.
    if (useClaudeChatStore.getState().target?.kind === "folder") return;
    useClaudeChatStore.getState().setTarget(path ? { kind: "note", path } : null);
  }, [activeDocId, documents]);

  const createDocumentThread = useCallback((intent: "note" | "ai" | "chat") => {
    const editor = editorRef.current;
    const anchor = editor
      ? buildAnchorForRange(
          editor,
          editor.state.selection.from,
          editor.state.selection.from,
          "",
        )
      : undefined;
    return useDocumentStore.getState().createThread("", anchor, intent);
  }, []);

  const handleAddDocumentComment = useCallback(() => {
    createDocumentThread("note");
  }, [createDocumentThread]);

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
  }, [handleAddComment, handleAddDocumentComment]);

  const handleSelectThread = useCallback((id: string | null) => {
    useDocumentStore.getState().setActiveThreadId(id);
  }, []);

  // Comments are notes for yourself; Claude is reached through the chat.
  const handleSubmitMessage = useCallback((threadId: string, text: string) => {
    useDocumentStore.getState().addMessage(threadId, { role: "user", content: text });
  }, []);

  const handleAcceptSuggestion = useCallback(
    (threadId: string, suggestion: SuggestedEdit, messageId: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      const thread = useDocumentStore.getState().threads.find((item) => item.id === threadId);
      if (!thread) return;

      const range = applyReplacementWithHighlight(
        editor,
        thread,
        suggestion.suggestedText,
      );

      useDocumentStore.getState().updateThread(threadId, (t) => ({
        ...t,
        selectedText: suggestion.suggestedText,
        anchor: range
          ? buildThreadAnchorForRange(editor, range.from, range.to, suggestion.suggestedText)
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

  const handleRevertAppliedEdit = useCallback(
    (threadId: string, messageId: string, edit: AppliedEdit) => {
      const editor = editorRef.current;
      if (!editor) return;

      const store = useDocumentStore.getState();

      if (edit.scope === "document") {
        applyDocumentReplacement(editor, edit.originalText);
        store.updateContent(editor.getHTML());
        restoreCommentMarks(editor, store.threads);
        store.setAppliedEditStatus(threadId, messageId, edit.id, "reverted");
        return;
      }

      if (edit.scope === "replace-all") {
        const result = applyReplaceAllWithHighlight(
          editor,
          threadId,
          edit.replacementText,
          edit.originalText,
        );
        if (!result) return;
        store.updateThread(threadId, (thread) => ({
          ...thread,
          selectedText: edit.originalText,
          anchor: buildThreadAnchorForRange(
            editor,
            result.range.from,
            result.range.to,
            edit.originalText,
          ),
        }));
        store.setAppliedEditStatus(threadId, messageId, edit.id, "reverted");
        return;
      }

      const thread = store.threads.find((item) => item.id === threadId);
      if (!thread) return;

      const range = applyReplacementWithHighlight(editor, thread, edit.originalText);
      if (!range) return;

      store.updateThread(threadId, (thread) => ({
        ...thread,
        selectedText: edit.originalText,
        anchor: buildThreadAnchorForRange(editor, range.from, range.to, edit.originalText),
      }));
      store.setAppliedEditStatus(threadId, messageId, edit.id, "reverted");
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

      <main ref={mainRef} className="flex-1 min-w-0 h-full flex flex-col">
        {folderTarget && (
          <div className="flex flex-1 min-h-0 flex-col">
            {/* Stands in for the hidden toolbar so the window can still be moved here. */}
            <div className="h-[73px] shrink-0" data-window-drag />
            <div className="flex-1 min-h-0">
              <FolderOverview path={folderTarget} notesFolder={notesFolder} />
            </div>
          </div>
        )}
        {/* The editor stays mounted (hidden) while a folder is shown, so the
            open note keeps its state and comes back as it was. */}
        <div className={folderTarget ? "hidden" : "flex-1 min-h-0"}>
          <Editor
            editorRef={editorRef}
            onReady={handleEditorReady}
            onUpdate={handleEditorUpdate}
            onOpenSettings={() => setSettingsOpen(true)}
            proseSize={currentSize.proseClass}
            currentSize={currentSize}
            currentLineHeight={currentLineHeight}
            onSizeChange={setFontSize}
            onLineHeightChange={setLineHeight}
            currentSpacing={currentSpacing}
            onSpacingChange={setSpacing}
            documentTitle={documentTitle}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
            focusMode={focusMode}
            onToggleFocusMode={toggleFocusMode}
          />
        </div>
        {terminalStarted && (
          <Suspense fallback={null}>
            <TerminalPanel containerHeight={mainHeight} />
          </Suspense>
        )}
      </main>

      {!focusMode && (
        <>
          <DragHandle onDragStart={handleCommentDragStart} onDrag={handleCommentDrag} />
          <aside
            aria-label="Comments"
            style={{ width: commentWidth }}
            className="shrink-0 h-full bg-background text-sidebar-foreground"
          >
            <CommentSidebar
              threads={threads}
              activeThreadId={activeThreadId}
              onSelectThread={handleSelectThread}
              onSubmitMessage={handleSubmitMessage}
              onResolveThread={handleResolveThread}
              onUnresolveThread={handleUnresolveThread}
              onAcceptSuggestion={handleAcceptSuggestion}
              onRejectSuggestion={handleRejectSuggestion}
              onRevertAppliedEdit={handleRevertAppliedEdit}
            />
          </aside>
        </>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            notesFolder={notesFolder}
            onChangeNotesFolder={onChangeNotesFolder}
            currentSize={currentSize}
            currentLineHeight={currentLineHeight}
            onSizeChange={setFontSize}
            onLineHeightChange={setLineHeight}
            currentSpacing={currentSpacing}
            onSpacingChange={setSpacing}
          />
        </Suspense>
      )}

      <WelcomeDialog />
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
