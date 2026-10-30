import type { CommentThread, DocumentMeta } from "@/types";
import {
  listNoteTree,
  walkFiles,
  readNotes,
  readNotesThreads,
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

/** Sidecar version last read for each note, to skip unchanged ones. */
const threadVersions = new Map<string, string>();
let treeSignature = "";

function signatureOf(nodes: NoteTreeNode[]): string {
  const parts: string[] = [];
  const walk = (list: NoteTreeNode[]) => {
    for (const node of list) {
      if (node.type === "folder") {
        parts.push(`d:${node.id}`);
        walk(node.children);
      } else {
        parts.push(`f:${node.id}`);
      }
    }
  };
  walk(nodes);
  return parts.join("\n");
}

/**
 * Bring the caches up to date with the notes folder. Lists names and
 * versions only, then reads just the notes and comment sidecars whose version
 * changed, so an idle refresh of a large folder costs a directory walk.
 * Returns whether anything changed.
 */
export async function refreshPersistence(): Promise<boolean> {
  const firstLoad = !bootCompleted;
  const tree = await listNoteTree(false);
  const files = Array.from(walkFiles(tree));

  const staleNotes = files.filter((file) => noteCache.get(file.id)?.version !== file.version).map((f) => f.id);
  const staleThreads = files
    .filter((file) => file.threads_version && threadVersions.get(file.id) !== file.threads_version)
    .map((f) => f.id);

  const [freshNotes, freshThreads] = await Promise.all([
    staleNotes.length ? readNotes(staleNotes) : Promise.resolve([]),
    staleThreads.length ? readNotesThreads(staleThreads) : Promise.resolve([]),
  ]);

  const signature = signatureOf(tree);
  const removedNote = noteCache.size !== files.length || signature !== treeSignature;
  const removedThreads = [...threadCache.keys()].some((id) => !files.find((f) => f.id === id && f.threads_version));
  const changed = firstLoad || freshNotes.length > 0 || freshThreads.length > 0 || removedNote || removedThreads;

  const fresh = new Map(freshNotes.map((note) => [note.id, note]));
  const nextNotes = new Map<string, NoteFile>();
  for (const file of files) {
    const note = fresh.get(file.id) ?? noteCache.get(file.id);
    // A note that vanished between listing and reading is left out.
    if (note) nextNotes.set(file.id, note);
  }
  noteCache.clear();
  for (const [id, note] of nextNotes) noteCache.set(id, note);
  noteTreeCache = tree;
  treeSignature = signature;

  const versions = new Map(files.map((file) => [file.id, file.threads_version]));
  for (const { id, content } of freshThreads) {
    const threads = parseThreads(id, content);
    if (threads) threadCache.set(id, threads);
    else threadCache.delete(id);
    threadVersions.set(id, versions.get(id) ?? "");
  }
  for (const id of [...threadCache.keys()]) {
    if (!versions.get(id)) {
      threadCache.delete(id);
      threadVersions.delete(id);
    }
  }

  // Comments from before sidecars lived in localStorage; move them once.
  if (firstLoad) {
    await Promise.all(
      files
        .filter((file) => !file.threads_version)
        .map(async (file) => {
          const legacy = loadLegacyThreads(file.id);
          if (!legacy) return;
          threadCache.set(file.id, legacy);
          await saveDocThreads(file.id, legacy);
        }),
    );
  }
  return changed;
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

/** The note's Markdown as last read from or written to disk. */
export function getDocMarkdown(id: string): string | null {
  return noteCache.get(id)?.content ?? null;
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
  const existing = noteCache.get(id);

  // Opening, selecting or leaving a note also triggers a save. If the editor
  // holds exactly what the file on disk would load as, nothing was edited:
  // leave the file alone, so notes written by other tools keep their
  // formatting until the user actually changes them.
  if (existing && htmlToMarkdown(markdownToHtml(existing.content)) === md) return;

  // Update cache optimistically so subsequent reads see the latest.
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
    (value.intent === undefined || value.intent === "note" || value.intent === "ai" || value.intent === "chat") &&
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
    (value.appliedEdit === undefined || isAppliedEdit(value.appliedEdit)) &&
    typeof value.createdAt === "number"
  );
}

function isAppliedEdit(value: unknown): value is NonNullable<CommentThread["messages"][number]["appliedEdit"]> {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.originalText === "string" &&
    typeof value.replacementText === "string" &&
    (
      value.scope === undefined ||
      value.scope === "selection" ||
      value.scope === "replace-all" ||
      value.scope === "document"
    ) &&
    (value.occurrenceCount === undefined || typeof value.occurrenceCount === "number") &&
    (value.status === "applied" || value.status === "reverted")
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
    // Not on disk yet; the first write fills in the real version.
    version: "",
  });
  void writeNote(id, "")
    .then((saved) => {
      noteCache.set(id, saved);
    })
    .catch((e) => {
      console.error(`registerNewNote(${id}) failed:`, e);
    });
}
