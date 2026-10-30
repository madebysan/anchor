// All TypeScript types for Anchor

export interface DocumentMeta {
  id: string;         // "doc-{timestamp}-{random5}"
  title: string;      // auto-derived from first <h1>/<h2>
  createdAt: number;
  updatedAt: number;
}

export interface CommentThread {
  id: string;
  selectedText: string;
  anchor?: CommentAnchor;
  intent?: "note" | "ai" | "chat";
  messages: ThreadMessage[];
  status: "active" | "resolved";
  createdAt: number;
}

export interface CommentAnchor {
  text: string;
  pmFrom: number;
  pmTo: number;
  sourceText?: string;
  sourceFrom?: number;
  sourceTo?: number;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestedEdit?: SuggestedEdit;
  appliedEdit?: AppliedEdit;
  createdAt: number;
}

export interface SuggestedEdit {
  id: string;
  originalText: string;
  suggestedText: string;
  status: "pending" | "accepted" | "rejected";
  /** Optional one-sentence rationale from the AI (Phase 4 tool calls). */
  reason?: string;
}

export interface AppliedEdit {
  id: string;
  originalText: string;
  replacementText: string;
  scope?: "selection" | "replace-all" | "document";
  occurrenceCount?: number;
  status: "applied" | "reverted";
}
