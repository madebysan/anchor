import { invoke } from "@tauri-apps/api/core";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { create } from "zustand";
import { htmlToMarkdown } from "@/lib/markdown";
import { getDocIdByPath, getDocMarkdown } from "@/lib/persistence";

// Claude Code shows "In note.md" or "3 lines selected" from the
// `selection_changed` notifications Anchor's IDE server forwards. Claude reads
// the note from disk, so positions are lines of the file as it is on disk (a
// file another app wrote keeps its own formatting until Anchor saves it), not
// ProseMirror positions.

/** Matches the editor's typing rhythm without flooding Claude. */
const PUSH_DEBOUNCE_MS = 100;
/** Prefix length used to find a paragraph's line in the Markdown source. */
const MATCH_PREFIX_CHARS = 40;

interface Position {
  line: number;
  character: number;
}

export interface IdeSelection {
  text: string;
  filePath: string;
  fileUrl: string;
  selection: { start: Position; end: Position; isEmpty: boolean };
}

interface TextblockSpan {
  from: number;
  to: number;
  text: string;
}

function collectTextblocks(doc: ProseMirrorNode): TextblockSpan[] {
  const spans: TextblockSpan[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    spans.push({ from: pos + 1, to: pos + 1 + node.content.size, text: node.textContent });
    return false;
  });
  return spans;
}

/** Strip Markdown syntax so a source line can be compared with editor text. */
function plainMarkdownLine(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\\(.)/g, "$1");
}

function compact(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * Map each textblock to the Markdown line it starts on, walking both in
 * order so repeated paragraphs land on the right occurrence.
 */
function mapTextblocksToLines(spans: TextblockSpan[], lines: string[]): number[] {
  const plainLines = lines.map((line) => compact(plainMarkdownLine(line)));
  const result: number[] = [];
  let cursor = 0;
  for (const span of spans) {
    const needle = compact(span.text).slice(0, MATCH_PREFIX_CHARS);
    let found = -1;
    if (needle) {
      for (let i = cursor; i < plainLines.length; i++) {
        if (plainLines[i] && (plainLines[i].startsWith(needle) || needle.startsWith(plainLines[i]))) {
          found = i;
          break;
        }
      }
    }
    if (found === -1) {
      result.push(result.length > 0 ? result[result.length - 1] : 0);
      continue;
    }
    result.push(found);
    // Code blocks and hard breaks span several source lines.
    cursor = found + 1 + (span.text.match(/\n/g)?.length ?? 0);
  }
  return result;
}

function positionAt(pos: number, spans: TextblockSpan[], startLines: number[]): Position {
  if (spans.length === 0) return { line: 0, character: 0 };
  let index = spans.findIndex((span) => pos <= span.to);
  if (index === -1) index = spans.length - 1;
  const span = spans[index];
  const offset = Math.max(0, Math.min(pos - span.from, span.text.length));
  const before = span.text.slice(0, offset);
  const extraLines = before.match(/\n/g)?.length ?? 0;
  const character = extraLines > 0 ? before.length - before.lastIndexOf("\n") - 1 : offset;
  return { line: startLines[index] + extraLines, character };
}

export function selectionForIde(editor: TiptapEditor, filePath: string): IdeSelection {
  const { from, to, empty } = editor.state.selection;
  const docId = getDocIdByPath(filePath);
  const markdown = (docId ? getDocMarkdown(docId) : null) ?? htmlToMarkdown(editor.getHTML());
  const spans = collectTextblocks(editor.state.doc);
  const startLines = mapTextblocksToLines(spans, markdown.split("\n"));
  return {
    text: empty ? "" : editor.state.doc.textBetween(from, to, "\n"),
    filePath,
    fileUrl: `file://${filePath}`,
    selection: {
      start: positionAt(from, spans, startLines),
      end: positionAt(to, spans, startLines),
      isEmpty: empty,
    },
  };
}

/** The latest open note and selection, for the chat's context chip and messages. */
export const useEditorContextStore = create<{ selection: IdeSelection | null }>(() => ({ selection: null }));

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Tell connected Claude sessions what is open and selected. Debounced; the
 * latest call wins. `filePath` null means no note is open.
 */
export function scheduleIdeContextPush(editor: TiptapEditor | null, filePath: string | null): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const selection = editor && filePath && !editor.isDestroyed ? selectionForIde(editor, filePath) : null;
    useEditorContextStore.setState({ selection });
    invoke<void>("ide_update_context", {
      activeFile: filePath,
      openFiles: filePath ? [filePath] : [],
      selection,
    }).catch((error) => {
      console.error("ide_update_context failed:", error);
    });
  }, PUSH_DEBOUNCE_MS);
}
