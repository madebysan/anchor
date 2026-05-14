// Font and size options for the editor

export interface FontOption {
  id: string;
  label: string;
  cssVar: string;
}

export interface SizeOption {
  id: string;
  label: string;
  proseClass: string;
}

export interface LineHeightOption {
  id: string;
  label: string;
  cssValue: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: "geist", label: "Geist Sans", cssVar: "var(--font-geist-sans)" },
  { id: "inter", label: "Inter", cssVar: "var(--font-inter)" },
  { id: "lora", label: "Lora", cssVar: "var(--font-lora)" },
  { id: "merriweather", label: "Merriweather", cssVar: "var(--font-merriweather)" },
  { id: "nunito", label: "Nunito", cssVar: "var(--font-nunito)" },
  { id: "open-sans", label: "Open Sans", cssVar: "var(--font-open-sans)" },
  { id: "playfair", label: "Playfair Display", cssVar: "var(--font-playfair)" },
  { id: "roboto", label: "Roboto", cssVar: "var(--font-roboto)" },
  { id: "source-serif", label: "Source Serif 4", cssVar: "var(--font-source-serif)" },
  { id: "ibm-plex", label: "IBM Plex Sans", cssVar: "var(--font-ibm-plex)" },
];

export const SIZE_OPTIONS: SizeOption[] = [
  { id: "sm", label: "Small", proseClass: "prose-sm" },
  { id: "base", label: "Medium", proseClass: "prose-base" },
  { id: "lg", label: "Large", proseClass: "prose-lg" },
  { id: "xl", label: "X-Large", proseClass: "prose-xl" },
];

export const LINE_HEIGHT_OPTIONS: LineHeightOption[] = [
  { id: "tight", label: "Tight", cssValue: "1.45" },
  { id: "normal", label: "Normal", cssValue: "1.65" },
  { id: "relaxed", label: "Relaxed", cssValue: "1.85" },
  { id: "loose", label: "Loose", cssValue: "2" },
];

export interface EditorPreferences {
  fontId: string;
  sizeId: string;
  lineHeightId: string;
  /** Hide the formatting cluster (B/I/H1.../font/size) — chrome buttons stay. */
  formattingCollapsed: boolean;
}

export const DEFAULT_EDITOR_PREFS: EditorPreferences = {
  fontId: "geist",
  sizeId: "lg",
  lineHeightId: "normal",
  formattingCollapsed: true,
};

const STORAGE_KEY = "inline-md-editor-prefs";

export function loadEditorPrefs(): EditorPreferences {
  if (typeof window === "undefined") return DEFAULT_EDITOR_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_EDITOR_PREFS;
    const parsed = JSON.parse(raw);

    // Validate that stored IDs match known options, fall back to defaults if not
    const fontId =
      typeof parsed.fontId === "string" && FONT_OPTIONS.some((f) => f.id === parsed.fontId)
        ? parsed.fontId
        : DEFAULT_EDITOR_PREFS.fontId;
    const sizeId =
      typeof parsed.sizeId === "string" && SIZE_OPTIONS.some((s) => s.id === parsed.sizeId)
        ? parsed.sizeId
        : DEFAULT_EDITOR_PREFS.sizeId;
    const formattingCollapsed =
      typeof parsed.formattingCollapsed === "boolean"
        ? parsed.formattingCollapsed
        : DEFAULT_EDITOR_PREFS.formattingCollapsed;
    const lineHeightId =
      typeof parsed.lineHeightId === "string" &&
      LINE_HEIGHT_OPTIONS.some((l) => l.id === parsed.lineHeightId)
        ? parsed.lineHeightId
        : DEFAULT_EDITOR_PREFS.lineHeightId;

    return { fontId, sizeId, lineHeightId, formattingCollapsed };
  } catch {
    return DEFAULT_EDITOR_PREFS;
  }
}

export function saveEditorPrefs(prefs: EditorPreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage might be full or unavailable
  }
}
