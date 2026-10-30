import type { Editor as TiptapEditor } from "@tiptap/react";
import { DOMParser as ProseMirrorDOMParser, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

export interface OutsideEditResult {
  /** Whether the other app's change was put into the note. */
  applied: boolean;
  /** The editor still holds typing that is not on disk yet; save it. */
  unsavedTyping: boolean;
}

function parse(schema: Schema, html: string): ProseMirrorNode {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return ProseMirrorDOMParser.fromSchema(schema).parse(holder);
}

/** The changed span between two documents: [start, endA) in `a` became [start, endB) in `b`. */
function changedRange(a: ProseMirrorNode, b: ProseMirrorNode) {
  const start = a.content.findDiffStart(b.content);
  if (start == null) return null;
  const end = a.content.findDiffEnd(b.content);
  if (!end) return null;
  let { a: endA, b: endB } = end;
  // When the change repeats text next to it, the two ends can cross the start.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return { start, endA, endB };
}

/**
 * Another app (usually Claude) changed the open note on disk. Apply only the
 * part that changed, as one ordinary edit: it lands in the undo history (⌘Z
 * puts the old text back) and the new text is left selected so you can see
 * what was replaced.
 *
 * `baseHtml` is the note as Anchor last read or wrote it, the version the
 * other app started from. If you typed since then (not yet saved) and your
 * typing is away from the other app's change, both are kept. If they touch
 * the same text, the other app's version wins; ⌘Z brings yours back.
 */
export function applyOutsideEdit(editor: TiptapEditor, html: string, baseHtml?: string): OutsideEditResult {
  const { state, schema } = editor;
  const next = parse(schema, html);

  // Comment highlights live only in the editor, never in the file. Compare
  // against the note without them so they don't read as changes; positions
  // are the same either way.
  const commentMark = schema.marks.comment;
  const current = commentMark ? state.tr.removeMark(0, state.doc.content.size, commentMark).doc : state.doc;

  const plain = changedRange(current, next);
  if (!plain) return { applied: false, unsavedTyping: false };

  let from = plain.start;
  let to = plain.endA;
  let slice = next.slice(plain.start, plain.endB);
  let selectionEnd = plain.endB;
  let merged = false;

  const base = baseHtml === undefined ? null : parse(schema, baseHtml);
  const typed = base ? changedRange(base, current) : null;
  const theirs = base ? changedRange(base, next) : null;
  // The file matches what Anchor last saw (for example Anchor's own save
  // landing): nothing to take in, and any newer typing stays.
  if (base && !theirs) return { applied: false, unsavedTyping: typed !== null };
  if (base && typed && theirs) {
    const theirsBeforeTyping = theirs.endA <= typed.start;
    const theirsAfterTyping = theirs.start >= typed.endA;
    if (theirsBeforeTyping || theirsAfterTyping) {
      // Positions after your typing moved by how much it grew or shrank.
      const shift = theirsAfterTyping ? current.content.size - base.content.size : 0;
      from = theirs.start + shift;
      to = theirs.endA + shift;
      slice = next.slice(theirs.start, theirs.endB);
      selectionEnd = from + (theirs.endB - theirs.start);
      merged = true;
    }
  }

  const tr = state.tr.replace(from, to, slice);
  const size = tr.doc.content.size;
  const anchor = Math.min(from, size);
  const head = Math.min(Math.max(selectionEnd, anchor), size);
  tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)));
  tr.scrollIntoView();
  // The file already holds exactly this text, so don't write it back. A merge
  // also keeps your typing, which still needs saving.
  if (!merged) tr.setMeta("preventUpdate", true);
  editor.view.dispatch(tr);
  return { applied: true, unsavedTyping: merged };
}
