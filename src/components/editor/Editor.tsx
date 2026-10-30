
import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { CommentMark } from "@/extensions/comment-mark";
import { EditHighlight } from "@/extensions/edit-highlight";
import { PinnedSelection } from "@/extensions/pinned-selection";
import { MermaidCodeBlock } from "@/extensions/mermaid-code-block";
import EditorToolbar from "./EditorToolbar";
import { markdownToHtml } from "@/lib/markdown";
import type { SizeOption } from "@/lib/editor-preferences";
import type { SaveStatus } from "@/lib/document-store";
import type { LineHeightOption, SpacingOption } from "@/lib/editor-preferences";

function looksLikeMarkdown(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s+\S/m.test(trimmed)) return true;
  if (/^[-*+]\s+\S/m.test(trimmed)) return true;
  if (/^\d+\.\s+\S/m.test(trimmed)) return true;
  if (/^>\s+\S/m.test(trimmed)) return true;
  if (/```[\s\S]*```/.test(trimmed)) return true;
  if (/\[[^\]]+\]\([^)]+\)/.test(trimmed)) return true;
  if (/\*\*[^*\n]+\*\*/.test(trimmed)) return true;
  return false;
}

interface EditorProps {
  onReady?: () => void;
  onUpdate?: () => void;
  onOpenSettings?: () => void;
  editorRef?: React.MutableRefObject<ReturnType<typeof useEditor> | null>;
  proseSize?: string;
  currentSize?: SizeOption;
  currentLineHeight?: LineHeightOption;
  currentSpacing?: SpacingOption;
  onSpacingChange?: (spacingId: string) => void;
  onSizeChange?: (sizeId: string) => void;
  onLineHeightChange?: (lineHeightId: string) => void;
  documentTitle?: string;
  saveStatus?: SaveStatus;
  lastSavedAt?: number | null;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
}

// Sample content so the editor isn't empty on first load
// Shown only until the open note loads.
const defaultContent = "";

export default function Editor({
  onReady,
  onUpdate,
  onOpenSettings,
  editorRef,
  proseSize = "prose-lg",
  currentSize,
  currentLineHeight,
  currentSpacing,
  onSpacingChange,
  onSizeChange,
  onLineHeightChange,
  documentTitle,
  saveStatus,
  lastSavedAt,
  focusMode,
  onToggleFocusMode,
}: EditorProps) {
  const editor = useEditor({
    // Prevent SSR hydration mismatch — Tiptap renders client-only
    immediatelyRender: false,
    extensions: [
      // The code block is replaced by one that renders ```mermaid diagrams.
      StarterKit.configure({ codeBlock: false }),
      MermaidCodeBlock,
      TableKit,
      Placeholder.configure({
        placeholder: "Start writing, or paste some text...",
      }),
      CommentMark,
      EditHighlight,
      PinnedSelection,
    ],
    content: defaultContent,
    editorProps: {
      attributes: {
        class:
          `prose ${proseSize} dark:prose-invert max-w-none focus:outline-none min-h-[500px] px-12 py-8`,
        "aria-label": "Note",
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text || !looksLikeMarkdown(text)) return false;

        event.preventDefault();
        const html = markdownToHtml(text);
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        const slice = ProseMirrorDOMParser
          .fromSchema(view.state.schema)
          .parseSlice(wrapper);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
    onUpdate: () => {
      onUpdate?.();
    },
  });

  // Dynamically update prose size class when it changes (no editor recreation)
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          class: `prose ${proseSize} dark:prose-invert max-w-none focus:outline-none min-h-[500px] px-12 py-8`,
          "aria-label": "Note",
        },
      },
    });
  }, [editor, proseSize]);

  useEffect(() => {
    if (!editor || !currentLineHeight) return;
    editor.view.dom.style.lineHeight = currentLineHeight.cssValue;
  }, [editor, currentLineHeight]);

  useEffect(() => {
    if (!editor || !currentSpacing) return;
    editor.view.dom.dataset.spacing = currentSpacing.id;
  }, [editor, currentSpacing]);

  useEffect(() => {
    if (!editor) return;
    if (editorRef) editorRef.current = editor;
    onReady?.();
  }, [editor, editorRef, onReady]);

  return (
    <div className="flex flex-col h-full">
      {/* Drag strip aligning with the sidebar's traffic-light spacer. */}
      <div className="h-7 shrink-0 bg-background" data-window-drag />
      <EditorToolbar
        editor={editor}
        onOpenSettings={onOpenSettings}
        currentSize={currentSize}
        currentLineHeight={currentLineHeight}
        currentSpacing={currentSpacing}
        onSpacingChange={onSpacingChange}
        onSizeChange={onSizeChange}
        onLineHeightChange={onLineHeightChange}
        documentTitle={documentTitle}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        focusMode={focusMode}
        onToggleFocusMode={onToggleFocusMode}
      />
      <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
