
import { create } from "zustand";
import { markdownToHtml } from "./markdown";
import {
  saveDocContent,
  loadDocContent,
  saveDocThreads,
  loadDocThreads,
  saveDocIndex,
  loadDocIndex,
  deleteDocData,
  saveActiveDocId,
  loadActiveDocId,
  extractTitle,
  allocateNoteId,
  registerNewNote,
  refreshPersistence,
  getDocIdByPath,
  getDocPath,
  getDocMarkdown,
  hasNotesFolderContent,
  getNoteTree,
} from "./persistence";
import { moveFolder as moveFolderOnDisk, readNote, renameNote, sanitizeNoteId, writeNote, type NoteTreeNode } from "./notes-fs";
import type { CommentAnchor, DocumentMeta, CommentThread, ThreadMessage } from "@/types";
import { useClaudeChatStore } from "./claude-chat";

/** Keep a note's Claude conversation with it when Anchor renames or moves it. */
function moveNoteConversation(oldPath: string | null, newId: string): void {
  const newPath = getDocPath(newId);
  if (oldPath && newPath && oldPath !== newPath) useClaudeChatStore.getState().renamePath(oldPath, newPath);
}

function findFolderPath(nodes: NoteTreeNode[], id: string): string | null {
  for (const node of nodes) {
    if (node.type !== "folder") continue;
    if (node.id === id) return node.path;
    const inner = findFolderPath(node.children, id);
    if (inner) return inner;
  }
  return null;
}

export type SaveStatus = "idle" | "saving" | "saved";

const SAVE_DEBOUNCE_MS = 1000;
const SAVED_RESET_MS = 2000;

// Timers live outside state. They're imperative coordination, not data.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savedResetTimer: ReturnType<typeof setTimeout> | null = null;
let threadSaveTimer: ReturnType<typeof setTimeout> | null = null;
let refreshRunning: Promise<void> | null = null;
let refreshQueued: { path?: string; promise: Promise<void> } | null = null;

interface DocumentStore {
  // ---- State ----
  documents: DocumentMeta[];
  activeDocId: string | null;
  /** Current HTML content. Mirrors editor state for persistence. */
  content: string;
  /**
   * Signal to the editor that it should load this content. Cleared by
   * acknowledgeContentLoad. `outside` marks a change another app (usually
   * Claude) wrote to the open note: the editor applies just the changed part,
   * selects it, and ⌘Z undoes it.
   */
  pendingContentLoad: { docId: string; html: string; outside?: boolean; baseHtml?: string } | null;
  threads: CommentThread[];
  activeThreadId: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  initialized: boolean;

  // ---- Lifecycle ----
  initialize: () => void;
  refreshFromDisk: (changedPath?: string) => Promise<void>;
  /** The refresh itself; call refreshFromDisk, which runs one at a time. */
  runRefreshFromDisk: (changedPath?: string) => Promise<void>;
  acknowledgeContentLoad: () => void;
  cancelPendingSaves: () => void;

  // ---- Documents ----
  createDocument: (parentFolderId?: string) => void;
  createDocumentFromMarkdown: (input: {
    title: string;
    markdown: string;
    parentFolderId?: string;
  }) => Promise<string>;
  switchDocument: (id: string) => void;
  deleteDocument: (id: string) => void;
  renameDocument: (id: string, title: string) => Promise<void>;
  duplicateDocument: (id: string) => Promise<void>;
  moveDocumentToFolder: (id: string, targetFolderId: string | null) => Promise<void>;
  /** Move a folder and everything in it into another folder (null: the top level). */
  moveFolder: (id: string, targetParentId: string | null) => Promise<void>;

  // ---- Content ----
  updateContent: (html: string) => void;

  // ---- Threads ----
  setActiveThreadId: (id: string | null) => void;
  createThread: (
    selectedText: string,
    anchor?: CommentAnchor,
    intent?: CommentThread["intent"]
  ) => string;
  addMessage: (threadId: string, message: Omit<ThreadMessage, "id" | "createdAt">) => string;
  setAppliedEditStatus: (
    threadId: string,
    messageId: string,
    editId: string,
    status: NonNullable<ThreadMessage["appliedEdit"]>["status"]
  ) => void;
  resolveThread: (threadId: string) => void;
  unresolveThread: (threadId: string) => void;
  updateThread: (threadId: string, updater: (t: CommentThread) => CommentThread) => void;
}

// Note ids are now filenames (sanitized titles). allocateNoteId returns a
// collision-safe id like "Untitled" or "Untitled-2". registerNewNote adds
// it to the persistence cache and writes an empty .md to disk.
function newNote(suggestedTitle = "Untitled", parentFolderId?: string): string {
  const id = allocateNoteId(suggestedTitle, parentFolderId);
  registerNewNote(id);
  return id;
}

function makeThreadId() {
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Save the current doc + threads immediately.
function flushCurrent(docId: string, content: string, threads: CommentThread[]): void {
  void saveDocContent(docId, content);
  void saveDocThreads(docId, threads);
}

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: [],
  activeDocId: null,
  content: "",
  pendingContentLoad: null,
  threads: [],
  activeThreadId: null,
  saveStatus: "idle",
  lastSavedAt: null,
  initialized: false,

  initialize: () => {
    if (get().initialized) return;

    let docs = loadDocIndex();
    if (!docs) return;

    if (docs.length === 0 && !hasNotesFolderContent()) {
      const id = newNote();
      const now = Date.now();
      docs = [{ id, title: "Untitled", createdAt: now, updatedAt: now }];
      saveDocIndex(docs);
      saveActiveDocId(id);
    }

    if (docs.length === 0) {
      set({
        documents: [],
        activeDocId: null,
        content: "",
        pendingContentLoad: null,
        threads: [],
        activeThreadId: null,
        initialized: true,
      });
      return;
    }

    let activeId = loadActiveDocId();
    if (!activeId || !docs.find((d) => d.id === activeId)) {
      activeId = docs[0].id;
      saveActiveDocId(activeId);
    }

    const html = loadDocContent(activeId) ?? "";
    const threads = loadDocThreads(activeId) ?? [];

    set({
      documents: docs,
      activeDocId: activeId,
      content: html,
      pendingContentLoad: { docId: activeId, html },
      threads,
      activeThreadId: null,
      initialized: true,
    });
  },

  refreshFromDisk: (changedPath) => {
    // One refresh at a time. Requests made meanwhile share one follow-up run,
    // and callers wait for that run, so the state they read afterwards is
    // current.
    if (refreshRunning) {
      if (!refreshQueued) {
        const queued: { path?: string; promise: Promise<void> } = { path: changedPath, promise: Promise.resolve() };
        queued.promise = refreshRunning.then(() => {
          refreshQueued = null;
          return get().refreshFromDisk(queued.path);
        });
        refreshQueued = queued;
      } else if (!refreshQueued.path) {
        refreshQueued.path = changedPath;
      }
      return refreshQueued.promise;
    }
    refreshRunning = get()
      .runRefreshFromDisk(changedPath)
      .catch((error) => console.error("refreshFromDisk failed:", error))
      .finally(() => {
        refreshRunning = null;
      });
    return refreshRunning;
  },

  runRefreshFromDisk: async (changedPath) => {
    // The open note as Anchor last read or wrote it: the version another app
    // started from, so its change can be told apart from unsaved typing.
    const baseMarkdown = get().activeDocId ? getDocMarkdown(get().activeDocId as string) : null;
    const previous = get();
    const previousActiveId = previous.activeDocId;
    const previousActivePath = previousActiveId ? getDocPath(previousActiveId) : null;
    const previousActiveDoc = previous.documents.find((d) => d.id === previousActiveId);

    // Nothing on disk changed: keep every piece of state as it is, so an idle
    // check doesn't re-render the note list.
    if (!(await refreshPersistence())) return;

    const docs = loadDocIndex() ?? [];

    if (docs.length === 0) {
      get().cancelPendingSaves();
      set({
        documents: [],
        activeDocId: null,
        content: "",
        pendingContentLoad: { docId: "", html: "" },
        threads: [],
        activeThreadId: null,
        saveStatus: "idle",
        lastSavedAt: Date.now(),
      });
      return;
    }

    const changedDocId = changedPath ? getDocIdByPath(changedPath) : null;
    const currentActiveDoc = docs.find((d) => d.id === previousActiveId);
    const activeDocChangedOnDisk =
      Boolean(currentActiveDoc && previousActiveDoc) &&
      currentActiveDoc?.updatedAt !== previousActiveDoc?.updatedAt &&
      (!previous.lastSavedAt || Date.now() - previous.lastSavedAt > SAVED_RESET_MS);
    const activeStillExists = Boolean(currentActiveDoc);
    const changedActiveDoc = changedDocId !== null && changedDocId === previousActiveId;

    if (previousActiveId && activeStillExists) {
      if (changedActiveDoc || activeDocChangedOnDisk) {
        // A save may be waiting with typing from before this change; it would
        // write over the other app's edit. Drop it: the editor merges the
        // change with that typing and saves the result.
        get().cancelPendingSaves();
        const html = loadDocContent(previousActiveId) ?? "";
        set({
          documents: docs,
          content: html,
          pendingContentLoad: {
            docId: previousActiveId,
            html,
            outside: true,
            baseHtml: baseMarkdown === null ? undefined : markdownToHtml(baseMarkdown),
          },
          saveStatus: "idle",
          lastSavedAt: Date.now(),
        });
        return;
      }

      set({ documents: docs });
      return;
    }

    const movedActiveId =
      changedDocId && docs.some((d) => d.id === changedDocId) ? changedDocId : null;
    const sameTitleDoc = previousActiveDoc
      ? docs.find((d) => d.title === previousActiveDoc.title)
      : undefined;
    const nextActiveId = movedActiveId ?? sameTitleDoc?.id ?? docs[0].id;
    const html = loadDocContent(nextActiveId) ?? "";
    const activeDocMoved = Boolean(previousActiveId && nextActiveId !== previousActiveId);
    const movedThreads = activeDocMoved ? previous.threads : loadDocThreads(nextActiveId) ?? [];

    get().cancelPendingSaves();
    saveActiveDocId(nextActiveId);
    if (activeDocMoved) {
      await saveDocThreads(nextActiveId, movedThreads);
      // The open note was renamed outside Anchor (for example by Claude in a
      // folder conversation): its conversation moves with it.
      moveNoteConversation(previousActivePath, nextActiveId);
    }

    set({
      documents: docs,
      activeDocId: nextActiveId,
      content: html,
      pendingContentLoad: { docId: nextActiveId, html },
      threads: movedThreads,
      activeThreadId: null,
      saveStatus: "idle",
      lastSavedAt: Date.now(),
    });
  },

  acknowledgeContentLoad: () => set({ pendingContentLoad: null }),

  cancelPendingSaves: () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (savedResetTimer) {
      clearTimeout(savedResetTimer);
      savedResetTimer = null;
    }
    if (threadSaveTimer) {
      clearTimeout(threadSaveTimer);
      threadSaveTimer = null;
    }
    set({ saveStatus: "idle" });
  },

  // ---- Documents ----
  createDocument: (parentFolderId) => {
    const { activeDocId, content, threads } = get();

    // Flush current before transitioning.
    if (activeDocId) flushCurrent(activeDocId, content, threads);
    get().cancelPendingSaves();

    const id = newNote("Untitled", parentFolderId);
    const now = Date.now();
    const newDoc: DocumentMeta = {
      id,
      title: "Untitled",
      createdAt: now,
      updatedAt: now,
    };

    set((state) => {
      const updated = [newDoc, ...state.documents];
      saveDocIndex(updated);
      saveActiveDocId(id);
      return {
        documents: updated,
        activeDocId: id,
        content: "",
        pendingContentLoad: { docId: id, html: "" },
        threads: [],
        activeThreadId: null,
        saveStatus: "idle",
      };
    });
  },

  createDocumentFromMarkdown: async ({ title, markdown, parentFolderId }) => {
    const { activeDocId, content, threads } = get();

    if (activeDocId) {
      get().cancelPendingSaves();
      await Promise.all([
        saveDocContent(activeDocId, content),
        saveDocThreads(activeDocId, threads),
      ]);
    }

    const id = allocateNoteId(title, parentFolderId);
    await writeNote(id, markdown);
    await refreshPersistence();

    const docs = loadDocIndex() ?? [];
    const html = loadDocContent(id) ?? "";
    saveActiveDocId(id);

    set({
      documents: docs,
      activeDocId: id,
      content: html,
      pendingContentLoad: { docId: id, html },
      threads: [],
      activeThreadId: null,
      saveStatus: "saved",
      lastSavedAt: Date.now(),
    });

    return id;
  },

  switchDocument: (targetId: string) => {
    const { activeDocId, content, threads } = get();
    if (targetId === activeDocId) return;

    if (activeDocId) flushCurrent(activeDocId, content, threads);
    get().cancelPendingSaves();

    const html = loadDocContent(targetId) ?? "";
    const newThreads = loadDocThreads(targetId) ?? [];
    saveActiveDocId(targetId);

    set({
      activeDocId: targetId,
      content: html,
      pendingContentLoad: { docId: targetId, html },
      threads: newThreads,
      activeThreadId: null,
      saveStatus: "idle",
    });
  },

  deleteDocument: (targetId: string) => {
    set((state) => {
      const remaining = state.documents.filter((d) => d.id !== targetId);
      deleteDocData(targetId);

      // If the deleted doc wasn't active, just update the index.
      if (targetId !== state.activeDocId) {
        saveDocIndex(remaining);
        return { documents: remaining };
      }

      // Active doc was deleted: pick the next, or auto-create a fresh blank.
      get().cancelPendingSaves();

      if (remaining.length === 0) {
        const id = newNote();
        const now = Date.now();
        const fresh: DocumentMeta = {
          id,
          title: "Untitled",
          createdAt: now,
          updatedAt: now,
        };
        const withFresh = [fresh];
        saveDocIndex(withFresh);
        saveActiveDocId(id);
        return {
          documents: withFresh,
          activeDocId: id,
          content: "",
          pendingContentLoad: { docId: id, html: "" },
          threads: [],
          activeThreadId: null,
          saveStatus: "idle",
        };
      }

      const next = remaining[0];
      const html = loadDocContent(next.id) ?? "";
      const threads = loadDocThreads(next.id) ?? [];
      saveDocIndex(remaining);
      saveActiveDocId(next.id);
      return {
        documents: remaining,
        activeDocId: next.id,
        content: html,
        pendingContentLoad: { docId: next.id, html },
        threads,
        activeThreadId: null,
        saveStatus: "idle",
      };
    });
  },

  renameDocument: async (id, title) => {
    const sanitizedTitle = sanitizeNoteId(title);
    const slashIndex = id.lastIndexOf("/");
    const parentId = slashIndex === -1 ? "" : id.slice(0, slashIndex);
    const nextId = parentId ? `${parentId}/${sanitizedTitle}` : sanitizedTitle;

    if (nextId === id) return;

    const { activeDocId, content, threads } = get();
    if (activeDocId === id) {
      get().cancelPendingSaves();
      await saveDocContent(id, content);
      await saveDocThreads(id, threads);
    }

    const oldPath = getDocPath(id);
    await renameNote(id, nextId);
    await refreshPersistence();
    moveNoteConversation(oldPath, nextId);

    const docs = loadDocIndex() ?? [];
    if (activeDocId === id) {
      saveActiveDocId(nextId);
      await saveDocThreads(nextId, threads);
      set({
        documents: docs,
        activeDocId: nextId,
        content,
        pendingContentLoad: null,
        threads,
        saveStatus: "idle",
        lastSavedAt: Date.now(),
      });
      return;
    }

    set({ documents: docs });
  },

  duplicateDocument: async (id) => {
    const source = await readNote(id);
    const slashIndex = id.lastIndexOf("/");
    const parentId = slashIndex === -1 ? undefined : id.slice(0, slashIndex);
    const sourceName = slashIndex === -1 ? id : id.slice(slashIndex + 1);
    const nextId = allocateNoteId(`${sourceName}-copy`, parentId);
    await writeNote(nextId, source.content);
    await refreshPersistence();
    set({ documents: loadDocIndex() ?? [] });
  },

  moveFolder: async (id, targetParentId) => {
    const name = id.slice(id.lastIndexOf("/") + 1);
    const nextId = targetParentId ? `${targetParentId}/${name}` : name;
    if (nextId === id) return;
    if (targetParentId && (targetParentId === id || targetParentId.startsWith(`${id}/`))) return;

    const { activeDocId, content, threads } = get();
    const activeInside = activeDocId !== null && activeDocId.startsWith(`${id}/`);
    if (activeInside && activeDocId) {
      get().cancelPendingSaves();
      await saveDocContent(activeDocId, content);
      await saveDocThreads(activeDocId, threads);
    }

    const oldPath = findFolderPath(getNoteTree(), id);
    const movedId = await moveFolderOnDisk(id, targetParentId);
    // Conversations of the folder and of the notes in it move with it.
    if (oldPath) {
      const root = oldPath.slice(0, oldPath.length - id.length).replace(/\/+$/, "");
      useClaudeChatStore.getState().renamePath(oldPath, `${root}/${movedId}`);
    }
    await refreshPersistence();
    const docs = loadDocIndex() ?? [];

    if (activeInside && activeDocId) {
      const nextActiveId = `${movedId}${activeDocId.slice(id.length)}`;
      saveActiveDocId(nextActiveId);
      set({
        documents: docs,
        activeDocId: nextActiveId,
        content,
        pendingContentLoad: null,
        threads,
        activeThreadId: null,
        saveStatus: "idle",
        lastSavedAt: Date.now(),
      });
      return;
    }
    set({ documents: docs });
  },

  moveDocumentToFolder: async (id, targetFolderId) => {
    const slashIndex = id.lastIndexOf("/");
    const filename = slashIndex === -1 ? id : id.slice(slashIndex + 1);
    const nextId = targetFolderId ? `${targetFolderId}/${filename}` : filename;
    if (nextId === id) return;

    const { activeDocId, content, threads } = get();
    if (activeDocId === id) {
      get().cancelPendingSaves();
      await saveDocContent(id, content);
      await saveDocThreads(id, threads);
    }

    const oldPath = getDocPath(id);
    await renameNote(id, nextId);
    await refreshPersistence();
    moveNoteConversation(oldPath, nextId);
    const docs = loadDocIndex() ?? [];

    if (activeDocId === id) {
      saveActiveDocId(nextId);
      await saveDocThreads(nextId, threads);
      set({
        documents: docs,
        activeDocId: nextId,
        content,
        pendingContentLoad: null,
        threads,
        activeThreadId: null,
        saveStatus: "idle",
        lastSavedAt: Date.now(),
      });
      return;
    }

    set({ documents: docs });
  },

  // ---- Content ----
  updateContent: (html) => {
    const { activeDocId } = get();
    if (!activeDocId) return;

    set({ content: html, saveStatus: "saving" });

    if (saveTimer) clearTimeout(saveTimer);
    if (savedResetTimer) clearTimeout(savedResetTimer);

    saveTimer = setTimeout(() => {
      const { activeDocId: docId, content: latest } = get();
      if (!docId) return;

      void saveDocContent(docId, latest);
      const newTitle = extractTitle(latest);
      set((state) => {
        const updated = state.documents.map((d) =>
          d.id === docId ? { ...d, title: newTitle, updatedAt: Date.now() } : d
        );
        saveDocIndex(updated);
        return {
          documents: updated,
          saveStatus: "saved",
          lastSavedAt: Date.now(),
        };
      });
      savedResetTimer = setTimeout(() => set({ saveStatus: "idle" }), SAVED_RESET_MS);
    }, SAVE_DEBOUNCE_MS);
  },

  // ---- Threads ----
  setActiveThreadId: (id) => set({ activeThreadId: id }),

  createThread: (selectedText, anchor, intent) => {
    const id = makeThreadId();
    const thread: CommentThread = {
      id,
      selectedText,
      anchor,
      intent,
      messages: [],
      status: "active",
      createdAt: Date.now(),
    };
    set((state) => ({
      threads: [...state.threads, thread],
      activeThreadId: id,
    }));
    scheduleThreadSave();
    return id;
  },

  addMessage: (threadId, partial) => {
    const message: ThreadMessage = {
      ...partial,
      id: makeMessageId(),
      createdAt: Date.now(),
    };
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, messages: [...t.messages, message] } : t
      ),
    }));
    scheduleThreadSave();
    return message.id;
  },

  setAppliedEditStatus: (threadId, messageId, editId, status) => {
    set((state) => ({
      threads: state.threads.map((t) => {
        if (t.id !== threadId) return t;
        return {
          ...t,
          messages: t.messages.map((message) => {
            if (message.id !== messageId || message.appliedEdit?.id !== editId) return message;
            return {
              ...message,
              appliedEdit: { ...message.appliedEdit, status },
            };
          }),
        };
      }),
    }));
    scheduleThreadSave();
  },

  resolveThread: (threadId) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, status: "resolved" } : t
      ),
      activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
    }));
    scheduleThreadSave();
  },

  unresolveThread: (threadId) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, status: "active" } : t
      ),
    }));
    scheduleThreadSave();
  },

  updateThread: (threadId, updater) => {
    set((state) => ({
      threads: state.threads.map((t) => (t.id === threadId ? updater(t) : t)),
    }));
    scheduleThreadSave();
  },
}));

function scheduleThreadSave() {
  if (threadSaveTimer) clearTimeout(threadSaveTimer);
  threadSaveTimer = setTimeout(() => {
    const { activeDocId, threads } = useDocumentStore.getState();
    if (!activeDocId) return;
    void saveDocThreads(activeDocId, threads);
  }, SAVE_DEBOUNCE_MS);
}
