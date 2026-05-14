import type { Editor as TiptapEditor } from "@tiptap/react";
import type { CommentAnchor, CommentThread } from "@/types";
import { docToMarkdown } from "@/lib/export-markdown";
import type { DocumentSnapshot } from "./context-router";

const TEXT_SEPARATOR = " ";

export function buildDocumentSnapshot(editor: TiptapEditor): DocumentSnapshot {
  const sourceMarkdown = docToMarkdown(editor.state.doc);
  const paragraphs: string[] = [];
  const headings: { level: number; text: string }[] = [];
  const blocks: NonNullable<DocumentSnapshot["blocks"]> = [];
  let sourceCursor = 0;

  editor.state.doc.forEach((node, offset) => {
    const text = node.textContent;
    if (!text) return;

    const sourceFrom = sourceMarkdown.indexOf(text, sourceCursor);
    const sourceTo = sourceFrom === -1 ? null : sourceFrom + text.length;
    if (sourceTo !== null) {
      sourceCursor = sourceTo;
    }

    paragraphs.push(text);
    blocks.push({
      text,
      pmFrom: offset + 1,
      pmTo: offset + node.nodeSize - 1,
      sourceFrom: sourceFrom === -1 ? null : sourceFrom,
      sourceTo,
    });

    if (node.type.name === "heading") {
      const level = (node.attrs as { level?: number }).level ?? 1;
      headings.push({ level, text });
    }
  });

  return {
    fullText: paragraphs.join("\n\n"),
    sourceMarkdown,
    paragraphs,
    blocks,
    headings,
  };
}

export function buildAnchorForRange(
  editor: TiptapEditor,
  from: number,
  to: number,
  text: string,
): CommentAnchor {
  const snapshot = buildDocumentSnapshot(editor);
  const sourceRange = findSourceRange(snapshot, from, to, text);
  return {
    text,
    pmFrom: from,
    pmTo: to,
    sourceText: text,
    sourceFrom: sourceRange?.from,
    sourceTo: sourceRange?.to,
  };
}

export function findThreadRange(
  editor: TiptapEditor,
  thread: CommentThread,
): { from: number; to: number } | null {
  const text = thread.anchor?.text || thread.selectedText;
  if (!text.trim()) return null;

  const anchor = thread.anchor;
  if (anchor) {
    const direct = validateRange(editor, anchor.pmFrom, anchor.pmTo, text);
    if (direct) return direct;

    const snapshot = buildDocumentSnapshot(editor);
    const sourceMatch = findRangeFromSourceAnchor(editor, snapshot, anchor, text);
    if (sourceMatch) return sourceMatch;
  }

  return findTextRange(editor, text);
}

function findSourceRange(
  snapshot: DocumentSnapshot,
  from: number,
  to: number,
  text: string,
): { from: number; to: number } | null {
  const block = snapshot.blocks?.find(
    (candidate) => from >= candidate.pmFrom && to <= candidate.pmTo,
  );
  if (!block || block.sourceFrom === null || block.sourceTo === null) {
    return findSourceText(snapshot.sourceMarkdown ?? "", text);
  }

  const offsetInBlock = Math.max(0, from - block.pmFrom);
  const expectedFrom = block.sourceFrom + offsetInBlock;
  const expectedTo = expectedFrom + text.length;
  const sourceMarkdown = snapshot.sourceMarkdown ?? "";
  if (sourceMarkdown.slice(expectedFrom, expectedTo) === text) {
    return { from: expectedFrom, to: expectedTo };
  }

  const blockSource = sourceMarkdown.slice(block.sourceFrom, block.sourceTo);
  const blockOffset = blockSource.indexOf(text);
  if (blockOffset !== -1) {
    const sourceFrom = block.sourceFrom + blockOffset;
    return { from: sourceFrom, to: sourceFrom + text.length };
  }

  return findSourceText(sourceMarkdown, text);
}

function findSourceText(
  sourceMarkdown: string,
  text: string,
): { from: number; to: number } | null {
  const sourceFrom = sourceMarkdown.indexOf(text);
  if (sourceFrom === -1) return null;
  return { from: sourceFrom, to: sourceFrom + text.length };
}

function findRangeFromSourceAnchor(
  editor: TiptapEditor,
  snapshot: DocumentSnapshot,
  anchor: CommentAnchor,
  text: string,
): { from: number; to: number } | null {
  if (typeof anchor.sourceFrom !== "number") return null;
  const sourceFrom = anchor.sourceFrom;

  const block = snapshot.blocks?.find(
    (candidate) =>
      candidate.sourceFrom !== null &&
      candidate.sourceTo !== null &&
      sourceFrom >= candidate.sourceFrom &&
      sourceFrom <= candidate.sourceTo,
  );
  if (!block || block.sourceFrom === null) return null;

  const sourceOffset = Math.max(0, sourceFrom - block.sourceFrom);
  const direct = validateRange(
    editor,
    block.pmFrom + sourceOffset,
    block.pmFrom + sourceOffset + text.length,
    text,
  );
  if (direct) return direct;

  const blockOffset = block.text.indexOf(text);
  if (blockOffset === -1) return null;
  return validateRange(
    editor,
    block.pmFrom + blockOffset,
    block.pmFrom + blockOffset + text.length,
    text,
  );
}

function validateRange(
  editor: TiptapEditor,
  from: number,
  to: number,
  text: string,
): { from: number; to: number } | null {
  if (from < 0 || to <= from || to > editor.state.doc.content.size) return null;
  const slice = editor.state.doc.textBetween(from, to, TEXT_SEPARATOR);
  return slice === text ? { from, to } : null;
}

function findTextRange(
  editor: TiptapEditor,
  text: string,
): { from: number; to: number } | null {
  let match: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (match || !node.isText) return false;
    const content = node.text ?? "";
    const offset = content.indexOf(text);
    if (offset === -1) return true;
    match = { from: pos + offset, to: pos + offset + text.length };
    return false;
  });
  return match;
}
