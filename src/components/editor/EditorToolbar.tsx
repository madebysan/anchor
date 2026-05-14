
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Braces,
  Minus,
  Undo,
  Redo,
  Copy,
  FileDown,
  Settings,
  Sun,
  Moon,
  Maximize2,
  Minimize2,
  ChevronDown,
  Type,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { LINE_HEIGHT_OPTIONS, SIZE_OPTIONS } from "@/lib/editor-preferences";
import type { LineHeightOption, SizeOption } from "@/lib/editor-preferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { docToMarkdown } from "@/lib/export-markdown";
import type { SaveStatus } from "@/lib/document-store";

interface EditorToolbarProps {
  editor: Editor | null;
  onOpenSettings?: () => void;
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

// Format a timestamp as a coarse "X ago" string. Refreshed by the parent's
// 30s interval — exact-second precision isn't useful for a save indicator.
function formatRelativeTime(ts: number, now: number): string {
  const seconds = Math.floor((now - ts) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}

// Persistent save indicator: shows "Saving…" during a save, "Saved" briefly
// after, then settles into "Saved Xs ago" with a relative timestamp.
function SaveIndicator({ saveStatus, lastSavedAt }: { saveStatus: SaveStatus; lastSavedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (saveStatus === "saving") {
    return <span className="text-[11px] text-muted-foreground mr-1">Saving…</span>;
  }
  if (saveStatus === "saved") {
    return <span className="text-[11px] text-muted-foreground mr-1">Saved</span>;
  }
  if (lastSavedAt) {
    return (
      <span className="text-[11px] text-muted-foreground mr-1" title={new Date(lastSavedAt).toLocaleString()}>
        Saved {formatRelativeTime(lastSavedAt, now)}
      </span>
    );
  }
  return null;
}

export default function EditorToolbar({
  editor,
  onOpenSettings,
  currentSize,
  currentLineHeight,
  onSizeChange,
  onLineHeightChange,
  documentTitle = "Untitled",
  saveStatus = "idle",
  lastSavedAt = null,
  focusMode = false,
  onToggleFocusMode,
  formattingCollapsed = false,
  onToggleFormattingCollapsed,
}: EditorToolbarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);

  if (!editor) return null;

  // Sanitize title for use as a filename
  const safeTitle = documentTitle
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";

  // Export via Tauri's native save dialog → user picks the destination
  // explicitly. Falls back gracefully if the dialog/write isn't available
  // (e.g. running the JS bundle in a plain browser).
  const exportFile = async (
    extension: "md" | "txt",
    mime: string,
    serialize: () => string,
  ) => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await save({
        title: `Export as ${extension.toUpperCase()}`,
        defaultPath: `${safeTitle}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (!path) return; // user cancelled
      await invoke<void>("write_export_file", { path, content: serialize() });
    } catch (e) {
      console.error(`export as ${extension} failed:`, e);
      // Browser fallback (e.g. running outside Tauri).
      const blob = new Blob([serialize()], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExportTxt = () =>
    exportFile("txt", "text/plain", () => editor.getText({ blockSeparator: "\n\n" }));

  const handleExportMd = () =>
    exportFile("md", "text/markdown", () => docToMarkdown(editor.state.doc));

  // Copy document content to clipboard with paragraph breaks
  const handleCopyContent = async () => {
    const text = editor.getText({ blockSeparator: "\n\n" });
    await navigator.clipboard.writeText(text);
  };

  const ToolbarButton = ({
    onClick,
    isActive = false,
    children,
    title,
  }: {
    onClick: () => void;
    isActive?: boolean;
    children: React.ReactNode;
    title: string;
  }) => (
    <Button
      variant="ghost"
      size="icon"
      className={`h-8 w-8 ${isActive ? "bg-muted" : ""}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-4 py-1.5 bg-background">
      {/* Collapse toggle keeps chrome buttons visible while hiding formatting controls. */}
      {onToggleFormattingCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 mr-1"
          onClick={onToggleFormattingCollapsed}
          title={formattingCollapsed ? "Show formatting toolbar" : "Hide formatting toolbar"}
        >
          {formattingCollapsed ? (
            <Type className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      )}

      {!formattingCollapsed && (
        <>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold (⌘B)"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic (⌘I)"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title="Strikethrough (⌘⇧X)"
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title="Inline code (⌘E)"
      >
        <Code className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Numbered list"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title="Quote"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive("codeBlock")}
        title="Code block"
      >
        <Braces className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        <Minus className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo (⌘Z)"
      >
        <Undo className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo (⌘⇧Z)"
      >
        <Redo className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Size selector */}
      {currentSize && onSizeChange && (
        <Select value={currentSize.id} onValueChange={onSizeChange}>
          <SelectTrigger size="sm" className="h-7 w-[90px] text-xs border-none shadow-none bg-transparent hover:bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIZE_OPTIONS.map((size) => (
              <SelectItem key={size.id} value={size.id}>
                {size.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {currentLineHeight && onLineHeightChange && (
        <Select value={currentLineHeight.id} onValueChange={onLineHeightChange}>
          <SelectTrigger size="sm" className="h-7 w-[104px] text-xs border-none shadow-none bg-transparent hover:bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINE_HEIGHT_OPTIONS.map((lineHeight) => (
              <SelectItem key={lineHeight.id} value={lineHeight.id}>
                {lineHeight.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

        </>
      )}

      {/* Spacer — pushes right-side tools to the end of the row */}
      <div className="flex-1 basis-4" />

      {/* Save indicator */}
      <SaveIndicator saveStatus={saveStatus} lastSavedAt={lastSavedAt} />

      {/* Copy to clipboard */}
      <ToolbarButton onClick={handleCopyContent} title="Copy to clipboard">
        <Copy className="h-4 w-4" />
      </ToolbarButton>

      {/* Export dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Export">
            <FileDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleExportTxt}>
            Export as TXT
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportMd}>
            Export as Markdown
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Focus mode toggle */}
      {onToggleFocusMode && (
        <ToolbarButton
          onClick={onToggleFocusMode}
          isActive={focusMode}
          title={focusMode ? "Exit focus mode (⌘⇧M)" : "Focus mode (⌘⇧M)"}
        >
          {focusMode ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </ToolbarButton>
      )}

      {/* Dark mode toggle */}
      {themeMounted && (
        <ToolbarButton
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          title="Toggle dark mode"
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </ToolbarButton>
      )}

      <div className="w-px h-5 bg-border mx-1" />

      <ToolbarButton onClick={() => onOpenSettings?.()} title="Settings">
        <Settings className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}
