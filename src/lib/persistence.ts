import type { CommentThread, DocumentMeta } from "@/types";
import {
  listNoteTree,
  walkFiles,
  writeNote,
  deleteNote,
  sanitizeNoteId,
  type NoteFile,
  type NoteTreeNode,
} from "./notes-fs";
import { markdownToHtml, htmlToMarkdown } from "./markdown";

// In-memory cache of notes loaded from disk at boot. The store reads from
// this cache synchronously; writes are debounced and fire-and-forget to
// disk via writeNote(). This preserves the store's existing sync API while
// the source of truth lives on the filesystem.
const noteCache = new Map<string, NoteFile>();
let bootCompleted = false;
// The tree shape (with folders) is needed by the sidebar but not by the
// store's id-keyed reads. Cached separately so a re-boot can replace it
// without disturbing in-flight saves.
let noteTreeCache: NoteTreeNode[] = [];

// Threads continue to live in localStorage keyed by note id (file stem).
// Phase 3 of the backlog moves them into sidecar files alongside the .md.
function threadsKey(id: string) {
  return `inline-md-threads-${id}`;
}

const KEY_ACTIVE_DOC = "inline-md-active-doc";

// =====================
// Boot — populate the cache from disk before the store initializes.
// =====================

export async function bootPersistence(): Promise<void> {
  await refreshPersistence();
  bootCompleted = true;
}

export async function refreshPersistence(): Promise<void> {
  const tree = await listNoteTree();
  noteCache.clear();
  for (const file of walkFiles(tree)) {
    noteCache.set(file.id, {
      id: file.id,
      path: file.path,
      title: file.title,
      content: file.content,
      modified: file.modified,
    });
  }
  noteTreeCache = tree;
}

export function isPersistenceReady(): boolean {
  return bootCompleted;
}

// Snapshot of the tree (folders + files) for the sidebar. Stable across
// renders within a boot, replaced on the next bootPersistence() call.
export function getNoteTree(): NoteTreeNode[] {
  return noteTreeCache;
}

export function hasNotesFolderContent(): boolean {
  return noteTreeCache.length > 0;
}

// Resolve a doc id to its absolute path on disk. Returns null if the doc
// hasn't been written yet (e.g. a freshly created note before its first
// disk write resolves). Callers should fall back to context-only flows
// in that case.
export function getDocPath(id: string): string | null {
  const note = noteCache.get(id);
  return note?.path && note.path.length > 0 ? note.path : null;
}

export function getDocIdByPath(path: string): string | null {
  const normalizedPath = normalizePath(path);
  for (const note of noteCache.values()) {
    if (normalizePath(note.path) === normalizedPath) {
      return note.id;
    }
  }
  return null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

// =====================
// Document index — derived from the cache.
// =====================

export function loadDocIndex(): DocumentMeta[] | null {
  if (!bootCompleted) return null;
  return Array.from(noteCache.values()).map(toMeta);
}

// Filesystem is the source of truth, so the index isn't a separate write.
// Kept as a no-op so existing call sites don't need to change.
export function saveDocIndex(_docs: DocumentMeta[]): void {
  // intentionally empty
}

function toMeta(note: NoteFile): DocumentMeta {
  const ms = note.modified * 1000;
  return {
    id: note.id,
    title: note.title,
    createdAt: ms,
    updatedAt: ms,
  };
}

// =====================
// Per-document content — markdown on disk, HTML in memory.
// =====================

export function loadDocContent(id: string): string | null {
  const note = noteCache.get(id);
  if (!note) return null;
  return markdownToHtml(note.content);
}

export function saveDocContent(id: string, html: string): void {
  const md = htmlToMarkdown(html);

  // Update cache optimistically so subsequent reads see the latest.
  const existing = noteCache.get(id);
  if (existing) {
    noteCache.set(id, {
      ...existing,
      content: md,
      modified: Math.floor(Date.now() / 1000),
    });
  }

  void writeNote(id, md)
    .then((saved) => {
      // Reconcile cache with the post-write metadata (real mtime).
      noteCache.set(id, saved);
    })
    .catch((e) => {
      console.error(`saveDocContent(${id}) failed:`, e);
    });
}

// =====================
// Per-document threads — still localStorage for Phase 2.
// =====================

export function loadDocThreads(id: string): CommentThread[] | null {
  try {
    const stored = localStorage.getItem(threadsKey(id));
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function saveDocThreads(id: string, threads: CommentThread[]): void {
  try {
    localStorage.setItem(threadsKey(id), JSON.stringify(threads));
  } catch (e) {
    console.warn(`saveDocThreads(${id}) failed:`, e);
  }
}

// =====================
// Delete — remove file + thread cache + localStorage threads.
// =====================

export function deleteDocData(id: string): void {
  noteCache.delete(id);
  void deleteNote(id).catch((e) => {
    console.error(`deleteDocData(${id}) failed:`, e);
  });
  try {
    localStorage.removeItem(threadsKey(id));
  } catch {
    // ignore
  }
}

// =====================
// Active document id — small enough that localStorage is fine.
// =====================

export function saveActiveDocId(id: string): void {
  try {
    localStorage.setItem(KEY_ACTIVE_DOC, id);
  } catch {
    // ignore
  }
}

export function loadActiveDocId(): string | null {
  try {
    return localStorage.getItem(KEY_ACTIVE_DOC);
  } catch {
    return null;
  }
}

// =====================
// Title extraction (kept for the editor's first-heading-as-title fallback).
// =====================

export function extractTitle(html: string): string {
  const match = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (match) {
    const text = match[1].replace(/<[^>]*>/g, "").trim();
    if (text.length > 0) return text;
  }
  return "Untitled";
}

// =====================
// New-note id allocation — sanitized title with collision-safe suffixing.
// =====================

export function allocateNoteId(suggestedTitle = "Untitled", parentFolderId?: string): string {
  const baseName = sanitizeNoteId(suggestedTitle);
  const base = parentFolderId ? `${parentFolderId}/${baseName}` : baseName;
  if (!noteCache.has(base)) return base;
  let n = 2;
  while (noteCache.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Add a new note to the cache and write an empty .md file to disk so the
// note survives reload even if the user never types into it.
export function registerNewNote(id: string): void {
  const now = Math.floor(Date.now() / 1000);
  const title = id.split("/").pop() ?? id;
  noteCache.set(id, {
    id,
    path: "",
    title,
    content: "",
    modified: now,
  });
  void writeNote(id, "")
    .then((saved) => {
      noteCache.set(id, saved);
    })
    .catch((e) => {
      console.error(`registerNewNote(${id}) failed:`, e);
    });
}
