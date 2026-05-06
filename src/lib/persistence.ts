import type { CommentThread, DocumentMeta } from "@/types";

// --- Legacy keys (kept for migration) ---
const STORAGE_KEY_DOC = "inlineai-document";
const STORAGE_KEY_THREADS = "inlineai-threads";

// --- Multi-doc keys ---
const KEY_DOC_INDEX = "inlineai-docs-index";
const KEY_ACTIVE_DOC = "inlineai-active-doc";

function docContentKey(id: string) {
  return `inlineai-doc-${id}`;
}
function docThreadsKey(id: string) {
  return `inlineai-threads-${id}`;
}

// Tagged error so callers can distinguish "out of space" from generic save failure.
// localStorage QuotaExceededError detection works across modern browsers (name match) and
// legacy Firefox (numeric code 1014). Modern Safari/Chrome use code 22.
export class QuotaError extends Error {
  constructor() {
    super("localStorage quota exceeded");
    this.name = "QuotaError";
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "QuotaExceededError") return true;
  // DOMException codes for legacy browsers
  const code = (e as unknown as { code?: number }).code;
  return code === 22 || code === 1014;
}

// Pub/sub for quota events so any save path can notify the UI without
// each call site needing to handle the throw individually. The document
// store subscribes once at module init.
type QuotaListener = () => void;
const quotaListeners = new Set<QuotaListener>();

export function onQuotaExceeded(listener: QuotaListener): () => void {
  quotaListeners.add(listener);
  return () => quotaListeners.delete(listener);
}

function notifyQuota(): void {
  for (const l of quotaListeners) l();
}

// =====================
// Document index (list of all docs)
// =====================

export function saveDocIndex(docs: DocumentMeta[]): void {
  // The index is small; swallow errors here to keep multi-doc operations
  // resilient. Big writes (content, threads) throw QuotaError so callers
  // can surface a recovery dialog.
  try {
    localStorage.setItem(KEY_DOC_INDEX, JSON.stringify(docs));
  } catch (e) {
    console.warn("localStorage save failed:", e);
  }
}

export function loadDocIndex(): DocumentMeta[] | null {
  try {
    const stored = localStorage.getItem(KEY_DOC_INDEX);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// =====================
// Per-document content
// =====================

export function saveDocContent(id: string, html: string): void {
  try {
    localStorage.setItem(docContentKey(id), html);
  } catch (e) {
    if (isQuotaError(e)) {
      notifyQuota();
      throw new QuotaError();
    }
    console.warn("localStorage save failed:", e);
  }
}

export function loadDocContent(id: string): string | null {
  try {
    return localStorage.getItem(docContentKey(id));
  } catch {
    return null;
  }
}

// =====================
// Per-document threads
// =====================

export function saveDocThreads(id: string, threads: CommentThread[]): void {
  try {
    localStorage.setItem(docThreadsKey(id), JSON.stringify(threads));
  } catch (e) {
    if (isQuotaError(e)) {
      notifyQuota();
      throw new QuotaError();
    }
    console.warn("localStorage save failed:", e);
  }
}

export function loadDocThreads(id: string): CommentThread[] | null {
  try {
    const stored = localStorage.getItem(docThreadsKey(id));
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// =====================
// Delete a document's data (content + threads keys)
// =====================

export function deleteDocData(id: string): void {
  try {
    localStorage.removeItem(docContentKey(id));
    localStorage.removeItem(docThreadsKey(id));
  } catch {
    // ignore
  }
}

// =====================
// Active document ID
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
// Title extraction — pull first <h1> or <h2> text from HTML
// =====================

export function extractTitle(html: string): string {
  // Match the content inside the first <h1> or <h2> tag (handles nested tags like <strong>)
  const match = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (match) {
    // Strip any nested HTML tags from the heading text
    const text = match[1].replace(/<[^>]*>/g, "").trim();
    if (text.length > 0) return text;
  }
  return "Untitled";
}

// =====================
// Migration: move old single-doc keys into multi-doc structure
// =====================

export function migrateFromSingleDoc(): DocumentMeta[] | null {
  try {
    // Only migrate if there's no index yet but old keys exist
    const existingIndex = localStorage.getItem(KEY_DOC_INDEX);
    if (existingIndex) return null; // already migrated

    const oldDoc = localStorage.getItem(STORAGE_KEY_DOC);
    const oldThreads = localStorage.getItem(STORAGE_KEY_THREADS);

    // Nothing to migrate
    if (!oldDoc && !oldThreads) return null;

    const now = Date.now();
    const id = `doc-${now}-${Math.random().toString(36).slice(2, 7)}`;

    const meta: DocumentMeta = {
      id,
      title: oldDoc ? extractTitle(oldDoc) : "Untitled",
      createdAt: now,
      updatedAt: now,
    };

    // Save under new keys
    if (oldDoc) {
      localStorage.setItem(docContentKey(id), oldDoc);
    }
    if (oldThreads) {
      localStorage.setItem(docThreadsKey(id), oldThreads);
    }

    const index = [meta];
    localStorage.setItem(KEY_DOC_INDEX, JSON.stringify(index));
    localStorage.setItem(KEY_ACTIVE_DOC, id);

    // Clean up old keys
    localStorage.removeItem(STORAGE_KEY_DOC);
    localStorage.removeItem(STORAGE_KEY_THREADS);

    return index;
  } catch {
    return null;
  }
}

