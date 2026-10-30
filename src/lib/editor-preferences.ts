// Size and line-height options for the editor.

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

/** Space between paragraphs and between list items. */
export interface SpacingOption {
  id: string;
  label: string;
}

export const SPACING_OPTIONS: SpacingOption[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

export interface EditorPreferences {
  sizeId: string;
  lineHeightId: string;
  spacingId: string;
}

export const DEFAULT_EDITOR_PREFS: EditorPreferences = {
  sizeId: "lg",
  lineHeightId: "normal",
  spacingId: "medium",
};

const STORAGE_KEY = "anchor-editor-prefs";
const LEGACY_STORAGE_KEYS = ["inline-md-editor-prefs"];

export function loadEditorPrefs(): EditorPreferences {
  if (typeof window === "undefined") return DEFAULT_EDITOR_PREFS;
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (!raw) return DEFAULT_EDITOR_PREFS;
    const parsed = JSON.parse(raw);

    // Validate that stored IDs match known options, fall back to defaults if not
    const sizeId =
      typeof parsed.sizeId === "string" && SIZE_OPTIONS.some((s) => s.id === parsed.sizeId)
        ? parsed.sizeId
        : DEFAULT_EDITOR_PREFS.sizeId;
    const lineHeightId =
      typeof parsed.lineHeightId === "string" &&
      LINE_HEIGHT_OPTIONS.some((l) => l.id === parsed.lineHeightId)
        ? parsed.lineHeightId
        : DEFAULT_EDITOR_PREFS.lineHeightId;

    const spacingId =
      typeof parsed.spacingId === "string" && SPACING_OPTIONS.some((o) => o.id === parsed.spacingId)
        ? parsed.spacingId
        : DEFAULT_EDITOR_PREFS.spacingId;

    return { sizeId, lineHeightId, spacingId };
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
