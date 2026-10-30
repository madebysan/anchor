import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTheme } from "next-themes";
import { Check, FolderOpen, Keyboard, Info, Palette, Settings2, Sparkles, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FONTS,
  FONT_CHOICES,
  THEMES,
  hasChanges,
  resolveAppearance,
  useAppearanceStore,
  type ColorKey,
  type FontKind,
  type Variant,
} from "@/lib/appearance";
import { CLAUDE_UNAVAILABLE_STATUS, checkClaudeStatus, type ClaudeStatus } from "@/lib/ai-cli";
import { useTerminalStore } from "@/lib/terminal";
import {
  LINE_HEIGHT_OPTIONS,
  SIZE_OPTIONS,
  SPACING_OPTIONS,
  type LineHeightOption,
  type SizeOption,
  type SpacingOption,
} from "@/lib/editor-preferences";

type Section = "general" | "appearance" | "claude" | "shortcuts" | "about";

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings2 className="size-4" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="size-4" /> },
  { id: "claude", label: "Claude", icon: <Sparkles className="size-4" /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard className="size-4" /> },
  { id: "about", label: "About", icon: <Info className="size-4" /> },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notesFolder?: string;
  onChangeNotesFolder?: () => void;
  currentSize?: SizeOption;
  currentLineHeight?: LineHeightOption;
  onSizeChange?: (id: string) => void;
  onLineHeightChange?: (id: string) => void;
  currentSpacing?: SpacingOption;
  onSpacingChange?: (id: string) => void;
}

export default function SettingsDialog(props: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("general");

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="h-[min(640px,85vh)] gap-0 overflow-hidden p-0 sm:max-w-[780px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Anchor settings</DialogDescription>
        <div className="grid h-full min-h-0 grid-cols-[180px_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="flex flex-col gap-0.5 border-r border-border bg-foreground/[0.02] p-2 pt-4">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => setSection(item.id)}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  section === item.id
                    ? "bg-foreground/[0.08] font-medium text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 overflow-y-auto px-7 pb-8 pt-6">
            {section === "general" && <GeneralSection {...props} />}
            {section === "appearance" && <AppearanceSection {...props} />}
            {section === "claude" && <ClaudeSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- layout pieces ----------

/**
 * Arrow keys move through a group of radio tiles and select as they go, the
 * standard radio-group behavior; only the selected tile is a Tab stop.
 */
function onRadioKeys(event: React.KeyboardEvent<HTMLElement>, ids: readonly string[], current: string, select: (id: string) => void) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const index = Math.max(0, ids.indexOf(current));
  const next = ids[(index + step + ids.length) % ids.length];
  select(next);
  const group = event.currentTarget;
  requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-radio-id="${next}"]`)?.focus());
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-base font-semibold">{children}</h2>;
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {title && <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>}
      <div className="divide-y divide-border rounded-lg border border-border">{children}</div>
    </section>
  );
}

function Row({ label, description, children }: { label: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

// ---------- General ----------

function GeneralSection({ notesFolder, onChangeNotesFolder }: SettingsDialogProps) {
  const reveal = () => {
    if (!notesFolder) return;
    invoke<void>("open_path", { path: notesFolder }).catch((e) => console.error("open_path failed:", e));
  };
  return (
    <>
      <SectionTitle>General</SectionTitle>
      <Group>
        <Row
          label="Notes folder"
          description={
            <span className="flex min-w-0 items-center gap-1.5 font-mono" title={notesFolder}>
              <FolderOpen className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{notesFolder || "Not set"}</span>
            </span>
          }
        >
          <Button variant="outline" size="sm" onClick={reveal} disabled={!notesFolder}>
            Show in Finder
          </Button>
          <Button variant="outline" size="sm" onClick={onChangeNotesFolder} disabled={!onChangeNotesFolder}>
            Change…
          </Button>
        </Row>
      </Group>
    </>
  );
}

// ---------- Appearance ----------

const MODES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

function ModeThumb({ mode }: { mode: (typeof MODES)[number]["id"] }) {
  const pane = (bg: string, line: string) => (
    <div className="grid h-full grid-cols-[1fr_2.2fr_1fr]" style={{ background: bg }}>
      <span style={{ borderRight: `1px solid ${line}` }} />
      <span className="flex flex-col gap-1 p-1.5">
        <i className="block h-1 w-3/4 rounded-full" style={{ background: line }} />
        <i className="block h-1 w-1/2 rounded-full" style={{ background: line }} />
      </span>
      <span style={{ borderLeft: `1px solid ${line}` }} />
    </div>
  );
  if (mode === "system") {
    return (
      <div className="grid h-full grid-cols-2 overflow-hidden">
        {pane("#f5f5f5", "#d4d4d4")}
        {pane("#171717", "#404040")}
      </div>
    );
  }
  return mode === "light" ? pane("#f5f5f5", "#d4d4d4") : pane("#171717", "#404040");
}

function AppearanceSection({
  currentSize,
  currentLineHeight,
  currentSpacing,
  onSizeChange,
  onLineHeightChange,
  onSpacingChange,
}: SettingsDialogProps) {
  const { theme: mode, setTheme: setMode, resolvedTheme } = useTheme();
  const appearance = useAppearanceStore();
  const variant: Variant = resolvedTheme === "dark" ? "dark" : "light";
  const resolved = resolveAppearance(appearance, variant);
  const changed = hasChanges(appearance);

  return (
    <>
      <SectionTitle>Appearance</SectionTitle>

      <section className="mb-6">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Mode</h3>
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Mode"
          onKeyDown={(e) => onRadioKeys(e, MODES.map((m) => m.id), mode ?? "system", setMode)}
        >
          {MODES.map((m) => {
            const selected = (mode ?? "system") === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-radio-id={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded-lg border p-1.5 text-xs transition-colors ${
                  selected ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="mb-1.5 h-12 overflow-hidden rounded-md border border-border">
                  <ModeThumb mode={m.id} />
                </div>
                {m.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Theme</h3>
        <div
          className="grid grid-cols-4 gap-2"
          role="radiogroup"
          aria-label="Theme"
          onKeyDown={(e) => onRadioKeys(e, THEMES.map((t) => t.id), appearance.themeId, appearance.setTheme)}
        >
          {THEMES.map((t) => {
            const selected = appearance.themeId === t.id;
            const palette = t[variant];
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-radio-id={t.id}
                title={t.description}
                onClick={() => appearance.setTheme(t.id)}
                className={`overflow-hidden rounded-lg border text-left transition-colors ${
                  selected ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-muted-foreground"
                }`}
              >
                <div className="flex h-14 flex-col justify-between px-2.5 py-2" style={{ background: palette.background, color: palette.text }}>
                  <span className="text-lg leading-none" style={{ fontFamily: FONTS[t.fonts.editor].stack }}>
                    Aa
                  </span>
                  <span className="block h-1 w-5 rounded-full" style={{ background: palette.accent }} />
                </div>
                <div className={`flex items-center justify-between px-2.5 py-1.5 text-xs ${selected ? "text-foreground" : "text-muted-foreground"}`}>
                  {t.name}
                  {selected && <Check className="size-3.5" aria-hidden />}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <Group title={`Customize · ${resolved.preset.name}, ${variant}`}>
        <ColorRow label="Accent" colorKey="accent" variant={variant} value={resolved.accent} />
        <ColorRow label="Background" colorKey="background" variant={variant} value={resolved.background} />
        <ColorRow label="Text" colorKey="text" variant={variant} value={resolved.text} />
        <FontRow label="Editor font" description="Your notes" kind="editor" value={resolved.fonts.editor} />
        <FontRow label="Interface font" description="Sidebars, menus and chat" kind="ui" value={resolved.fonts.ui} />
        <FontRow label="Code font" description="Code blocks and inline code" kind="code" value={resolved.fonts.code} />
        {changed && (
          <Row label={`Reset to ${resolved.preset.name}`} description="Undo your color and font changes for this theme.">
            <Button variant="outline" size="sm" onClick={appearance.resetChanges}>
              <RotateCcw className="size-3.5" aria-hidden />
              Reset
            </Button>
          </Row>
        )}
      </Group>

      <Group title="Text">
        <Row label="Text size">
          <Select value={currentSize?.id} onValueChange={(id) => onSizeChange?.(id)}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Text size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZE_OPTIONS.map((size) => (
                <SelectItem key={size.id} value={size.id} className="text-xs">
                  {size.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Line height">
          <Select value={currentLineHeight?.id} onValueChange={(id) => onLineHeightChange?.(id)}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Line height">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINE_HEIGHT_OPTIONS.map((lh) => (
                <SelectItem key={lh.id} value={lh.id} className="text-xs">
                  {lh.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Paragraph spacing" description="Space between paragraphs and between list items">
          <Select value={currentSpacing?.id} onValueChange={(id) => onSpacingChange?.(id)}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Paragraph spacing">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPACING_OPTIONS.map((spacing) => (
                <SelectItem key={spacing.id} value={spacing.id} className="text-xs">
                  {spacing.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Group>
    </>
  );
}

function ColorRow({ label, colorKey, variant, value }: { label: string; colorKey: ColorKey; variant: Variant; value: string }) {
  const setColor = useAppearanceStore((s) => s.setColor);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commitDraft = () => {
    const hex = draft.trim().startsWith("#") ? draft.trim() : `#${draft.trim()}`;
    if (/^#[0-9a-f]{6}$/i.test(hex)) setColor(variant, colorKey, hex);
    else setDraft(value);
  };
  return (
    <Row label={label}>
      <label className="relative size-7 cursor-pointer overflow-hidden rounded-md border border-border" title={`Pick ${label.toLowerCase()} color`}>
        <span className="absolute inset-0" style={{ background: value }} />
        <input
          type="color"
          value={value}
          onChange={(e) => setColor(variant, colorKey, e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={`${label} color`}
        />
      </label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitDraft();
        }}
        spellCheck={false}
        aria-label={`${label} hex value`}
        className="h-8 w-24 font-mono text-xs"
      />
    </Row>
  );
}

function FontRow({ label, description, kind, value }: { label: string; description: string; kind: FontKind; value: string }) {
  const setFont = useAppearanceStore((s) => s.setFont);
  return (
    <Row label={label} description={description}>
      <Select value={value} onValueChange={(id) => setFont(kind, id)}>
        <SelectTrigger className="h-8 w-44 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_CHOICES[kind].map((id) => (
            <SelectItem key={id} value={id} className="text-sm" style={{ fontFamily: FONTS[id].stack }}>
              {FONTS[id].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

// ---------- Claude ----------

function ClaudeSection() {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const terminalOpen = useTerminalStore((s) => s.open);
  const setTerminalOpen = useTerminalStore((s) => s.setOpen);

  const check = () => {
    setChecking(true);
    checkClaudeStatus()
      .catch(() => CLAUDE_UNAVAILABLE_STATUS)
      .then((result) => setStatus(result))
      .finally(() => setChecking(false));
  };
  useEffect(check, []);

  const statusLabel = !status
    ? "Checking…"
    : status.ready
      ? "Ready"
      : status.installed
        ? "Installed, not ready"
        : "Not installed";

  return (
    <>
      <SectionTitle>Claude</SectionTitle>
      <Group>
        <Row label="Claude Code" description={status?.detail ?? "Anchor uses the Claude Code app you sign in to."}>
          <span className={`text-xs ${status?.ready ? "text-foreground" : "text-muted-foreground"}`}>{statusLabel}</span>
          <Button variant="outline" size="sm" onClick={check} disabled={checking}>
            Check again
          </Button>
        </Row>
      </Group>
      <Group title="Conversations">
        <Row
          label="Note conversations"
          description="Claude can edit the open note. Its change lands in place and stays selected; ⌘Z undoes it."
        />
        <Row
          label="Folder conversations"
          description="Claude works across the folder's notes with your Claude Code permission settings. There is no undo for these yet."
        />
      </Group>
      <Group title="Terminal">
        <Row label="Show terminal" description="A shell under the editor that starts Claude Code in your notes folder (⌃`).">
          <Switch checked={terminalOpen} onCheckedChange={setTerminalOpen} aria-label="Show terminal" />
        </Row>
      </Group>
    </>
  );
}

// ---------- Shortcuts ----------

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "App",
    items: [
      ["New note", "⌘ N"],
      ["Settings", "⌘ ,"],
      ["Focus mode", "⌘ ⇧ M"],
      ["Show or hide the terminal", "⌃ `"],
      ["Copy the selected note's or folder's path", "⌥ ⌘ C"],
    ],
  },
  {
    group: "Writing",
    items: [
      ["Bold", "⌘ B"],
      ["Italic", "⌘ I"],
      ["Strikethrough", "⌘ ⇧ X"],
      ["Inline code", "⌘ E"],
      ["Undo / Redo", "⌘ Z / ⌘ ⇧ Z"],
      ["Comment on the selection", "⌘ ⇧ V"],
    ],
  },
  {
    group: "Chat",
    items: [
      ["Send", "Enter"],
      ["New line", "⇧ Enter"],
    ],
  },
];

function ShortcutsSection() {
  return (
    <>
      <SectionTitle>Shortcuts</SectionTitle>
      {SHORTCUTS.map((group) => (
        <Group key={group.group} title={group.group}>
          {group.items.map(([label, keys]) => (
            <Row key={label} label={label}>
              <kbd className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{keys}</kbd>
            </Row>
          ))}
        </Group>
      ))}
    </>
  );
}

// ---------- About ----------

const RESET_KEYS = [
  "anchor-settings",
  "anchor-editor-prefs",
  "anchor-appearance",
  "anchor-expanded-folders",
  "inline-md-settings",
  "inline-md-editor-prefs",
  "inline-md-expanded-folders",
];

function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  const reset = () => {
    if (!window.confirm("Reset appearance and editor settings? Your notes folder and conversations are kept.")) return;
    try {
      for (const key of RESET_KEYS) localStorage.removeItem(key);
      localStorage.removeItem("theme");
      window.location.reload();
    } catch (e) {
      console.error("reset failed:", e);
    }
  };

  return (
    <>
      <SectionTitle>About</SectionTitle>
      <Group>
        <Row label="Anchor" description={version ? `Version ${version}` : undefined}>
          <a
            href="https://santiagoalonso.com"
            onClick={(e) => {
              e.preventDefault();
              invoke("open_external_url", { url: "https://santiagoalonso.com" }).catch(() => {});
            }}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            santiagoalonso.com
          </a>
        </Row>
        <Row label="Reset settings" description="Theme, fonts, text size and folder list state. Notes, comments and conversations are not touched.">
          <Button variant="outline" size="sm" onClick={reset} className="text-destructive hover:text-destructive">
            Reset…
          </Button>
        </Row>
      </Group>
    </>
  );
}
