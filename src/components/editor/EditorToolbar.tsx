
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
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
  Copy,
  FileDown,
  Settings,
  Sun,
  Moon,
  Maximize2,
  Ellipsis,
  SquareTerminal,
  Minimize2,
  Check,
  EllipsisVertical,
} from "lucide-react";
import { useTerminalStore } from "@/lib/terminal";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { LINE_HEIGHT_OPTIONS, SIZE_OPTIONS, SPACING_OPTIONS } from "@/lib/editor-preferences";
import type { LineHeightOption, SizeOption, SpacingOption } from "@/lib/editor-preferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { docToMarkdown } from "@/lib/export-markdown";
import type { SaveStatus } from "@/lib/document-store";

interface EditorToolbarProps {
  editor: Editor | null;
  onOpenSettings?: () => void;
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
  currentSpacing,
  onSpacingChange,
  onSizeChange,
  onLineHeightChange,
  documentTitle = "Untitled",
  saveStatus = "idle",
  lastSavedAt = null,
  focusMode = false,
  onToggleFocusMode,
}: EditorToolbarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const terminalOpen = useTerminalStore((s) => s.open);
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);

  if (!editor) return null;

  // Highlight the Aa button when a format inside its menu applies here.
  const moreFormattingActive = ["strike", "code", "orderedList", "blockquote", "codeBlock"].some((name) =>
    editor.isActive(name),
  );

  // Sanitize title for use as a filename
  const safeTitle = documentTitle
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";

  // Export through the native save dialog, which the app opens itself.
  // Falls back to a download when running the bundle in a plain browser.
  const exportFile = async (
    extension: "md" | "txt",
    mime: string,
    serialize: () => string,
  ) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Anchor shows the save dialog and writes the file itself.
      await invoke<boolean>("export_note", { fileName: `${safeTitle}.${extension}`, extension, content: serialize() });
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
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-4 py-1.5 bg-background" data-window-drag>
      {/* The five most used tools stay visible; the rest live in the Aa menu. */}
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

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${moreFormattingActive ? "bg-muted" : ""}`}
            title="More formatting"
            aria-label="More formatting"
          >
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <FormatItem
            icon={<Strikethrough className="h-4 w-4" />}
            label="Strikethrough"
            shortcut="⌘⇧X"
            active={editor.isActive("strike")}
            onSelect={() => editor.chain().focus().toggleStrike().run()}
          />
          <FormatItem
            icon={<Code className="h-4 w-4" />}
            label="Inline code"
            shortcut="⌘E"
            active={editor.isActive("code")}
            onSelect={() => editor.chain().focus().toggleCode().run()}
          />
          <FormatItem
            icon={<ListOrdered className="h-4 w-4" />}
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onSelect={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <FormatItem
            icon={<Quote className="h-4 w-4" />}
            label="Quote"
            active={editor.isActive("blockquote")}
            onSelect={() => editor.chain().focus().toggleBlockquote().run()}
          />
          <FormatItem
            icon={<Braces className="h-4 w-4" />}
            label="Code block"
            active={editor.isActive("codeBlock")}
            onSelect={() => editor.chain().focus().toggleCodeBlock().run()}
          />
          <FormatItem
            icon={<Minus className="h-4 w-4" />}
            label="Divider"
            onSelect={() => editor.chain().focus().setHorizontalRule().run()}
          />
          {(currentSize && onSizeChange) || (currentLineHeight && onLineHeightChange) ? <DropdownMenuSeparator /> : null}
          {currentSize && onSizeChange && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Text size
                <span className="ml-auto pl-4 text-xs text-muted-foreground">{currentSize.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SIZE_OPTIONS.map((size) => (
                  <DropdownMenuItem key={size.id} onSelect={() => onSizeChange(size.id)}>
                    <Check className={`h-4 w-4 ${size.id === currentSize.id ? "" : "invisible"}`} />
                    {size.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {currentLineHeight && onLineHeightChange && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Line height
                <span className="ml-auto pl-4 text-xs text-muted-foreground">{currentLineHeight.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {LINE_HEIGHT_OPTIONS.map((lineHeight) => (
                  <DropdownMenuItem key={lineHeight.id} onSelect={() => onLineHeightChange(lineHeight.id)}>
                    <Check className={`h-4 w-4 ${lineHeight.id === currentLineHeight.id ? "" : "invisible"}`} />
                    {lineHeight.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {currentSpacing && onSpacingChange && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Paragraph spacing
                <span className="ml-auto pl-4 text-xs text-muted-foreground">{currentSpacing.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SPACING_OPTIONS.map((spacing) => (
                  <DropdownMenuItem key={spacing.id} onSelect={() => onSpacingChange(spacing.id)}>
                    <Check className={`h-4 w-4 ${spacing.id === currentSpacing.id ? "" : "invisible"}`} />
                    {spacing.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Spacer — pushes right-side tools to the end of the row */}
      <div className="flex-1 basis-4" />

      {/* Save indicator */}
      <SaveIndicator saveStatus={saveStatus} lastSavedAt={lastSavedAt} />

      {/* More: actions used now and then, kept off the toolbar row. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="More" aria-label="More">
            <Ellipsis className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={handleExportMd}>
            <FileDown className="h-4 w-4" />
            Export as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportTxt}>
            <FileDown className="h-4 w-4" />
            Export as TXT
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleTerminal}>
            <SquareTerminal className="h-4 w-4" />
            {terminalOpen ? "Hide terminal" : "Show terminal"}
            <MenuShortcut>⌃`</MenuShortcut>
          </DropdownMenuItem>
          {onToggleFocusMode && (
            <DropdownMenuItem onClick={onToggleFocusMode}>
              {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              {focusMode ? "Exit focus mode" : "Focus mode"}
              <MenuShortcut>⌘⇧M</MenuShortcut>
            </DropdownMenuItem>
          )}
          {themeMounted && (
            <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Copy to clipboard */}
      <ToolbarButton onClick={handleCopyContent} title="Copy to clipboard">
        <Copy className="h-4 w-4" />
      </ToolbarButton>


      <ToolbarButton onClick={() => onOpenSettings?.()} title="Settings">
        <Settings className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

/** Keyboard shortcut shown at the end of a menu item. */
function MenuShortcut({ children }: { children: string }) {
  return <span className="ml-auto pl-4 text-xs tracking-wide text-muted-foreground">{children}</span>;
}

/** One formatting command in the Aa menu, with a check when it applies. */
function FormatItem({
  icon,
  label,
  shortcut,
  active = false,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      {icon}
      {label}
      <span className="ml-auto flex items-center gap-2 pl-4 text-xs text-muted-foreground">
        {shortcut}
        <Check className={`h-3.5 w-3.5 ${active ? "" : "invisible"}`} aria-hidden />
      </span>
    </DropdownMenuItem>
  );
}
