"use client";

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
  migrateFromSingleDoc,
  QuotaError,
  onQuotaExceeded,
  allocateNoteId,
  registerNewNote,
} from "./persistence";
import type { DocumentMeta, CommentThread, ThreadMessage } from "@/types";

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
  quotaExceeded: boolean;
  initialized: boolean;

  // ---- Lifecycle ----
  initialize: () => void;
  acknowledgeContentLoad: () => void;
  cancelPendingSaves: () => void;

  // ---- Documents ----
  createDocument: () => void;
  switchDocument: (id: string) => void;
  deleteDocument: (id: string) => void;
  renameDocument: (id: string, title: string) => void;

  // ---- Content ----
  updateContent: (html: string) => void;

  // ---- Threads ----
  setActiveThreadId: (id: string | null) => void;
  createThread: (selectedText: string) => string;
  addMessage: (threadId: string, message: Omit<ThreadMessage, "id" | "createdAt">) => string;
  updateLastAssistantMessage: (threadId: string, content: string) => void;
  setLastAssistantSuggestion: (
    threadId: string,
    input: { replacement: string; reason?: string }
  ) => void;
  resolveThread: (threadId: string) => void;
  unresolveThread: (threadId: string) => void;
  updateThread: (threadId: string, updater: (t: CommentThread) => CommentThread) => void;

  // ---- Quota ----
  dismissQuotaWarning: () => void;
}

// Note ids are now filenames (sanitized titles). allocateNoteId returns a
// collision-safe id like "Untitled" or "Untitled-2". registerNewNote adds
// it to the persistence cache and writes an empty .md to disk.
function newNote(suggestedTitle = "Untitled"): string {
  const id = allocateNoteId(suggestedTitle);
  registerNewNote(id);
  return id;
}

function makeThreadId() {
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Save the current doc + threads immediately. Returns true on success.
// QuotaErrors are swallowed (the persistence module has already notified listeners).
function flushCurrent(docId: string, content: string, threads: CommentThread[]): void {
  try {
    saveDocContent(docId, content);
    saveDocThreads(docId, threads);
  } catch (e) {
    if (!(e instanceof QuotaError)) throw e;
  }
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
  quotaExceeded: false,
  initialized: false,

  initialize: () => {
    if (get().initialized) return;

    // Migrate legacy single-doc keys if present.
    const migrated = migrateFromSingleDoc();
    let docs = migrated ?? loadDocIndex();

    if (!docs || docs.length === 0) {
      const id = newNote();
      const now = Date.now();
      docs = [{ id, title: "Untitled", createdAt: now, updatedAt: now }];
      saveDocIndex(docs);
      saveActiveDocId(id);
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
  createDocument: () => {
    const { activeDocId, content, threads } = get();

    // Flush current before transitioning.
    if (activeDocId) flushCurrent(activeDocId, content, threads);
    get().cancelPendingSaves();

    const id = newNote();
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

  renameDocument: (id, title) => {
    set((state) => {
      const updated = state.documents.map((d) =>
        d.id === id ? { ...d, title, updatedAt: Date.now() } : d
      );
      saveDocIndex(updated);
      return { documents: updated };
    });
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

      try {
        saveDocContent(docId, latest);
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
      } catch (e) {
        // QuotaError already notified listeners; reset save indicator.
        if (e instanceof QuotaError) set({ saveStatus: "idle" });
        else set({ saveStatus: "idle" });
      }
    }, SAVE_DEBOUNCE_MS);
  },

  // ---- Threads ----
  setActiveThreadId: (id) => set({ activeThreadId: id }),

  createThread: (selectedText) => {
    const id = makeThreadId();
    const thread: CommentThread = {
      id,
      selectedText,
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

  // ---- Quota ----
  dismissQuotaWarning: () => set({ quotaExceeded: false }),
}));

function scheduleThreadSave() {
  if (threadSaveTimer) clearTimeout(threadSaveTimer);
  threadSaveTimer = setTimeout(() => {
    const { activeDocId, threads } = useDocumentStore.getState();
    if (!activeDocId) return;
    try {
      saveDocThreads(activeDocId, threads);
    } catch {
      // QuotaError already notifies listeners.
    }
  }, SAVE_DEBOUNCE_MS);
}

// Surface quota events from any save path into the store.
if (typeof window !== "undefined") {
  onQuotaExceeded(() => {
    useDocumentStore.setState({ quotaExceeded: true });
  });
}
