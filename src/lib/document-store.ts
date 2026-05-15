
import { create } from "zustand";
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
  hasNotesFolderContent,
} from "./persistence";
import { readNote, renameNote, sanitizeNoteId, writeNote } from "./notes-fs";
import type { CommentAnchor, DocumentMeta, CommentThread, ThreadMessage } from "@/types";

export type SaveStatus = "idle" | "saving" | "saved";

const SAVE_DEBOUNCE_MS = 1000;
const SAVED_RESET_MS = 2000;

// Timers live outside state. They're imperative coordination, not data.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savedResetTimer: ReturnType<typeof setTimeout> | null = null;
let threadSaveTimer: ReturnType<typeof setTimeout> | null = null;

interface DocumentStore {
  // ---- State ----
  documents: DocumentMeta[];
  activeDocId: string | null;
  /** Current HTML content. Mirrors editor state for persistence. */
  content: string;
  /** Signal to the editor that it should call setContent. Cleared by acknowledgeContentLoad. */
  pendingContentLoad: { docId: string; html: string } | null;
  threads: CommentThread[];
  activeThreadId: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  initialized: boolean;

  // ---- Lifecycle ----
  initialize: () => void;
  refreshFromDisk: (changedPath?: string) => Promise<void>;
  acknowledgeContentLoad: () => void;
  cancelPendingSaves: () => void;

  // ---- Documents ----
  createDocument: (parentFolderId?: string) => void;
  switchDocument: (id: string) => void;
  deleteDocument: (id: string) => void;
  renameDocument: (id: string, title: string) => Promise<void>;
  duplicateDocument: (id: string) => Promise<void>;
  moveDocumentToFolder: (id: string, targetFolderId: string | null) => Promise<void>;

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
  updateLastAssistantMessage: (threadId: string, content: string) => void;
  setLastAssistantSuggestion: (
    threadId: string,
    input: { replacement: string; reason?: string }
  ) => void;
  setLastAssistantAppliedEdit: (
    threadId: string,
    input: {
      originalText: string;
      replacementText: string;
      scope?: NonNullable<ThreadMessage["appliedEdit"]>["scope"];
      occurrenceCount?: number;
    }
  ) => void;
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

  refreshFromDisk: async (changedPath) => {
    const previous = get();
    const previousActiveId = previous.activeDocId;
    const previousActiveDoc = previous.documents.find((d) => d.id === previousActiveId);

    await refreshPersistence();

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
      if ((changedActiveDoc || activeDocChangedOnDisk) && previous.saveStatus !== "saving") {
        const html = loadDocContent(previousActiveId) ?? "";
        set({
          documents: docs,
          content: html,
          pendingContentLoad: { docId: previousActiveId, html },
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

      // Active doc was deleted — pick the next, or auto-create a fresh blank.
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

    await renameNote(id, nextId);
    await refreshPersistence();

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

    await renameNote(id, nextId);
    await refreshPersistence();
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

  updateLastAssistantMessage: (threadId, content) => {
    set((state) => ({
      threads: state.threads.map((t) => {
        if (t.id !== threadId) return t;
        const lastAiIdx = t.messages.findLastIndex((m) => m.role === "assistant");
        if (lastAiIdx === -1) return t;
        const updated = [...t.messages];
        updated[lastAiIdx] = { ...updated[lastAiIdx], content };
        return { ...t, messages: updated };
      }),
    }));
    // Streaming fires this many times per response; the debounce naturally batches.
    scheduleThreadSave();
  },

  setLastAssistantSuggestion: (threadId, input) => {
    set((state) => ({
      threads: state.threads.map((t) => {
        if (t.id !== threadId) return t;
        const lastAiIdx = t.messages.findLastIndex((m) => m.role === "assistant");
        if (lastAiIdx === -1) return t;
        const updated = [...t.messages];
        updated[lastAiIdx] = {
          ...updated[lastAiIdx],
          suggestedEdit: {
            id: `suggestion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            originalText: t.selectedText,
            suggestedText: input.replacement,
            status: "pending",
            reason: input.reason,
          },
        };
        return { ...t, messages: updated };
      }),
    }));
    scheduleThreadSave();
  },

  setLastAssistantAppliedEdit: (threadId, input) => {
    set((state) => ({
      threads: state.threads.map((t) => {
        if (t.id !== threadId) return t;
        const lastAiIdx = t.messages.findLastIndex((m) => m.role === "assistant");
        if (lastAiIdx === -1) return t;
        const updated = [...t.messages];
        updated[lastAiIdx] = {
          ...updated[lastAiIdx],
          appliedEdit: {
            id: `applied-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            originalText: input.originalText,
            replacementText: input.replacementText,
            scope: input.scope,
            occurrenceCount: input.occurrenceCount,
            status: "applied",
          },
        };
        return { ...t, messages: updated };
      }),
    }));
    scheduleThreadSave();
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
