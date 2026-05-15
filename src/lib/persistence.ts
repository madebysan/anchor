import type { CommentThread, DocumentMeta } from "@/types";
import {
  listNoteTree,
  walkFiles,
  readNoteThreads,
  writeNoteThreads,
  deleteNoteThreads,
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
const threadCache = new Map<string, CommentThread[]>();

const KEY_ACTIVE_DOC = "anchor-active-doc";
const LEGACY_ACTIVE_DOC_KEYS = ["inline-md-active-doc"];
const THREAD_PREFIX = "anchor-threads-";
const LEGACY_THREAD_PREFIXES = ["inline-md-threads-"];

function threadsKey(id: string) {
  return `${THREAD_PREFIX}${id}`;
}

function legacyThreadKeys(id: string) {
  return LEGACY_THREAD_PREFIXES.map((prefix) => `${prefix}${id}`);
}

// =====================
// Boot — populate the cache from disk before the store initializes.
// =====================

export async function bootPersistence(): Promise<void> {
  await refreshPersistence();
  bootCompleted = true;
}

export async function refreshPersistence(): Promise<void> {
  const tree = await listNoteTree();
  const files = Array.from(walkFiles(tree));
  noteCache.clear();
  for (const file of files) {
    noteCache.set(file.id, {
      id: file.id,
      path: file.path,
      title: file.title,
      content: file.content,
      modified: file.modified,
    });
  }
  noteTreeCache = tree;

  const nextThreadCache = new Map<string, CommentThread[]>();
  await Promise.all(
    files.map(async (file) => {
      const threads = await loadThreadsFromSidecar(file.id);
      if (threads) {
        nextThreadCache.set(file.id, threads);
      }
    }),
  );
  threadCache.clear();
  for (const [id, threads] of nextThreadCache) {
    threadCache.set(id, threads);
  }
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

export async function saveDocContent(id: string, html: string): Promise<void> {
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

  try {
    const saved = await writeNote(id, md);
    // Reconcile cache with the post-write metadata (real mtime).
    noteCache.set(id, saved);
  } catch (e) {
    console.error(`saveDocContent(${id}) failed:`, e);
  }
}

// =====================
// Per-document threads — sidecar JSON files next to each markdown file.
// =====================

export function loadDocThreads(id: string): CommentThread[] | null {
  return threadCache.get(id) ?? null;
}

export async function saveDocThreads(id: string, threads: CommentThread[]): Promise<void> {
  threadCache.set(id, threads);
  clearLegacyThreads(id);
  try {
    if (threads.length === 0) {
      await deleteNoteThreads(id);
      return;
    }
    await writeNoteThreads(id, JSON.stringify(threads, null, 2));
  } catch (e) {
    console.warn(`saveDocThreads(${id}) failed:`, e);
  }
}

async function loadThreadsFromSidecar(id: string): Promise<CommentThread[] | null> {
  try {
    const raw = await readNoteThreads(id);
    if (raw) {
      return parseThreads(id, raw);
    }
  } catch (e) {
    console.warn(`loadDocThreads(${id}) failed:`, e);
  }

  const legacy = loadLegacyThreads(id);
  if (!legacy) return null;
  threadCache.set(id, legacy);
  await saveDocThreads(id, legacy);
  return legacy;
}

function loadLegacyThreads(id: string): CommentThread[] | null {
  try {
    const stored =
      localStorage.getItem(threadsKey(id)) ??
      legacyThreadKeys(id).map((key) => localStorage.getItem(key)).find(Boolean);
    if (!stored) return null;
    return parseThreads(id, stored);
  } catch {
    return null;
  }
}

function clearLegacyThreads(id: string): void {
  try {
    localStorage.removeItem(threadsKey(id));
    for (const key of legacyThreadKeys(id)) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function parseThreads(id: string, raw: string): CommentThread[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`Ignoring malformed thread sidecar for ${id}: expected an array`);
      return null;
    }
    if (!parsed.every(isCommentThread)) {
      console.warn(`Ignoring malformed thread sidecar for ${id}: invalid thread shape`);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn(`Ignoring malformed thread sidecar for ${id}:`, e);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommentThread(value: unknown): value is CommentThread {
  if (!isRecord(value)) return false;
  const anchor = value.anchor;
  const messages = value.messages;
  return (
    typeof value.id === "string" &&
    typeof value.selectedText === "string" &&
    (anchor === undefined || isCommentAnchor(anchor)) &&
    Array.isArray(messages) &&
    messages.every(isThreadMessage) &&
    (value.status === "active" || value.status === "resolved") &&
    typeof value.createdAt === "number"
  );
}

function isCommentAnchor(value: unknown): value is NonNullable<CommentThread["anchor"]> {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    typeof value.pmFrom === "number" &&
    typeof value.pmTo === "number" &&
    (value.sourceText === undefined || typeof value.sourceText === "string") &&
    (value.sourceFrom === undefined || typeof value.sourceFrom === "number") &&
    (value.sourceTo === undefined || typeof value.sourceTo === "number")
  );
}

function isThreadMessage(value: unknown): value is CommentThread["messages"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "number"
  );
}

// =====================
// Delete — remove file + thread cache + localStorage threads.
// =====================

export function deleteDocData(id: string): void {
  noteCache.delete(id);
  threadCache.delete(id);
  void deleteNote(id).catch((e) => {
    console.error(`deleteDocData(${id}) failed:`, e);
  });
  clearLegacyThreads(id);
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
    return (
      localStorage.getItem(KEY_ACTIVE_DOC) ??
      LEGACY_ACTIVE_DOC_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) ??
      null
    );
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
