
import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { CommentMark } from "@/extensions/comment-mark";
import { EditHighlight } from "@/extensions/edit-highlight";
import CommentBubbleMenu from "./CommentBubbleMenu";
import EditorToolbar from "./EditorToolbar";
import { markdownToHtml } from "@/lib/markdown";
import type { SizeOption } from "@/lib/editor-preferences";
import type { SaveStatus } from "@/lib/document-store";
import type { LineHeightOption } from "@/lib/editor-preferences";

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
  onAddComment?: () => void;
  onAskAI?: () => void;
  onReady?: () => void;
  onUpdate?: () => void;
  onOpenSettings?: () => void;
  editorRef?: React.MutableRefObject<ReturnType<typeof useEditor> | null>;
  proseSize?: string;
  currentSize?: SizeOption;
  currentLineHeight?: LineHeightOption;
  onSizeChange?: (sizeId: string) => void;
  onLineHeightChange?: (lineHeightId: string) => void;
  documentTitle?: string;
  saveStatus?: SaveStatus;
  lastSavedAt?: number | null;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
  formattingCollapsed?: boolean;
  onToggleFormattingCollapsed?: () => void;
}

// Sample content so the editor isn't empty on first load
export const defaultContent = `<h1>Welcome to Anchor</h1>
<p>This is a document editor where AI lives in the margins. Select any text and click "Comment" to start a conversation about it.</p>
<h2>How it works</h2>
<p>Anchor lets you have AI-powered conversations anchored to specific passages in your document. Instead of a separate chat sidebar, your AI interactions live right where the text is.</p>
<p>Try selecting some text and adding a comment. You can type regular comments, or type <strong>@</strong> to see available AI triggers like <strong>@copywriter</strong>, <strong>@editor</strong>, <strong>@researcher</strong>, or <strong>@challenger</strong>.</p>
<h2>Example passage</h2>
<p>The quick brown fox jumped over the lazy dog. This sentence contains every letter of the English alphabet, making it useful for typography testing. It has been used by typists and designers since the late 19th century.</p>
<p>Another paragraph to experiment with. You can highlight any portion of text and start a threaded conversation about it. Multiple comments can overlap on the same text.</p>`;

export default function Editor({
  onAddComment,
  onAskAI,
  onReady,
  onUpdate,
  onOpenSettings,
  editorRef,
  proseSize = "prose-lg",
  currentSize,
  currentLineHeight,
  onSizeChange,
  onLineHeightChange,
  documentTitle,
  saveStatus,
  lastSavedAt,
  focusMode,
  onToggleFocusMode,
  formattingCollapsed,
  onToggleFormattingCollapsed,
}: EditorProps) {
  const editor = useEditor({
    // Prevent SSR hydration mismatch — Tiptap renders client-only
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Start writing, or paste some text...",
      }),
      CommentMark,
      EditHighlight,
    ],
    content: defaultContent,
    editorProps: {
      attributes: {
        class:
          `prose ${proseSize} dark:prose-invert max-w-none focus:outline-none min-h-[500px] px-12 py-8`,
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
        },
      },
    });
  }, [editor, proseSize]);

  useEffect(() => {
    if (!editor || !currentLineHeight) return;
    editor.view.dom.style.lineHeight = currentLineHeight.cssValue;
  }, [editor, currentLineHeight]);

  useEffect(() => {
    if (!editor) return;
    if (editorRef) editorRef.current = editor;
    onReady?.();
  }, [editor, editorRef, onReady]);

  return (
    <div className="flex flex-col h-full">
      {/* Drag strip aligning with the sidebar's traffic-light spacer. */}
      <div
        className="h-7 shrink-0 bg-background"
        style={{ ["WebkitAppRegion" as never]: "drag" }}
      />
      <EditorToolbar
        editor={editor}
        onOpenSettings={onOpenSettings}
        currentSize={currentSize}
        currentLineHeight={currentLineHeight}
        onSizeChange={onSizeChange}
        onLineHeightChange={onLineHeightChange}
        documentTitle={documentTitle}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        focusMode={focusMode}
        onToggleFocusMode={onToggleFocusMode}
        formattingCollapsed={formattingCollapsed}
        onToggleFormattingCollapsed={onToggleFormattingCollapsed}
      />
      <div className="flex-1 overflow-y-auto">
        {editor && (
          <CommentBubbleMenu
            editor={editor}
            onAddComment={() => onAddComment?.()}
            onAskAI={() => onAskAI?.()}
          />
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
