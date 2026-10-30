import { create } from "zustand";

/**
 * Themes: a preset fills every color and font, and any field can then be
 * changed. Colors are kept per variant (light and dark); the Mode setting
 * (next-themes: system / light / dark) picks which variant shows.
 *
 * Only three colors are chosen (background, text, accent). Every other token
 * (sidebar, borders, muted text, hovers) is mixed from them, so any choice
 * stays coherent. The Anchor preset with nothing changed uses the stylesheet
 * as is.
 */

export type Variant = "light" | "dark";
export type ColorKey = "background" | "text" | "accent";
export type FontKind = "editor" | "ui" | "code";

interface Palette {
  background: string;
  text: string;
  accent: string;
  /** Secondary text; mixed from text and background when either is changed. */
  muted: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  fonts: Record<FontKind, string>;
  light: Palette;
  dark: Palette;
}

export interface FontOption {
  id: string;
  label: string;
  stack: string;
}

const SANS = "system-ui, -apple-system, sans-serif";
const SERIF = "Georgia, serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const FONTS: Record<string, FontOption> = {
  geist: { id: "geist", label: "Geist", stack: `"Geist Sans", ${SANS}` },
  inter: { id: "inter", label: "Inter", stack: `"Inter", ${SANS}` },
  "ibm-plex-sans": { id: "ibm-plex-sans", label: "IBM Plex Sans", stack: `"IBM Plex Sans", ${SANS}` },
  "source-sans-3": { id: "source-sans-3", label: "Source Sans 3", stack: `"Source Sans 3", ${SANS}` },
  atkinson: { id: "atkinson", label: "Atkinson Hyperlegible", stack: `"Atkinson Hyperlegible", ${SANS}` },
  system: { id: "system", label: "System", stack: SANS },
  newsreader: { id: "newsreader", label: "Newsreader", stack: `"Newsreader", ${SERIF}` },
  literata: { id: "literata", label: "Literata", stack: `"Literata", ${SERIF}` },
  "source-serif-4": { id: "source-serif-4", label: "Source Serif 4", stack: `"Source Serif 4", ${SERIF}` },
  "eb-garamond": { id: "eb-garamond", label: "EB Garamond", stack: `"EB Garamond", ${SERIF}` },
  "ibm-plex-serif": { id: "ibm-plex-serif", label: "IBM Plex Serif", stack: `"IBM Plex Serif", ${SERIF}` },
  "ibm-plex-mono": { id: "ibm-plex-mono", label: "IBM Plex Mono", stack: `"IBM Plex Mono", ${MONO}` },
  "geist-mono": { id: "geist-mono", label: "Geist Mono", stack: `"Geist Mono", ${MONO}` },
  "jetbrains-mono": { id: "jetbrains-mono", label: "JetBrains Mono", stack: `"JetBrains Mono", ${MONO}` },
  "source-code-pro": { id: "source-code-pro", label: "Source Code Pro", stack: `"Source Code Pro", ${MONO}` },
};

export const FONT_CHOICES: Record<FontKind, string[]> = {
  editor: [
    "geist", "inter", "ibm-plex-sans", "atkinson",
    "newsreader", "literata", "source-serif-4", "eb-garamond", "ibm-plex-serif",
    "ibm-plex-mono",
  ],
  ui: ["geist", "inter", "ibm-plex-sans", "source-sans-3", "atkinson", "system"],
  code: ["geist-mono", "jetbrains-mono", "ibm-plex-mono", "source-code-pro"],
};

export const THEMES: ThemePreset[] = [
  {
    id: "anchor",
    name: "Anchor",
    description: "Neutral black and white.",
    fonts: { editor: "geist", ui: "geist", code: "geist-mono" },
    light: { background: "#ffffff", text: "#171717", accent: "#171717", muted: "#737373" },
    dark: { background: "#0a0a0a", text: "#fafafa", accent: "#fafafa", muted: "#a3a3a3" },
  },
  {
    id: "clay",
    name: "Clay",
    description: "Warm cream and charcoal, coral accent, serif notes.",
    fonts: { editor: "newsreader", ui: "inter", code: "jetbrains-mono" },
    light: { background: "#faf9f5", text: "#141413", accent: "#d97757", muted: "#6c6a64" },
    dark: { background: "#262624", text: "#faf9f5", accent: "#d97757", muted: "#a09d96" },
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Plain neutrals with a blue accent.",
    fonts: { editor: "inter", ui: "inter", code: "jetbrains-mono" },
    light: { background: "#ffffff", text: "#0d0d0d", accent: "#0285ff", muted: "#6b6b6b" },
    dark: { background: "#181818", text: "#ffffff", accent: "#339cff", muted: "#a0a0a0" },
  },
  {
    id: "paper",
    name: "Paper",
    description: "Monospaced notes on off-white, like a typewriter.",
    fonts: { editor: "ibm-plex-mono", ui: "geist", code: "ibm-plex-mono" },
    light: { background: "#f7f7f4", text: "#1f1f1f", accent: "#2f80ed", muted: "#707070" },
    dark: { background: "#1a1a1a", text: "#dadada", accent: "#4ba3ff", muted: "#8c8c8c" },
  },
  {
    id: "sepia",
    name: "Sepia",
    description: "Warm reading colors and a book serif.",
    fonts: { editor: "literata", ui: "inter", code: "jetbrains-mono" },
    light: { background: "#f4ecd8", text: "#5b4636", accent: "#a0522d", muted: "#8b7355" },
    dark: { background: "#2b2520", text: "#e8dcc8", accent: "#d4a373", muted: "#a8977f" },
  },
  {
    id: "nord",
    name: "Nord",
    description: "Cool arctic blues.",
    fonts: { editor: "ibm-plex-sans", ui: "inter", code: "jetbrains-mono" },
    light: { background: "#eceff4", text: "#2e3440", accent: "#5e81ac", muted: "#4c566a" },
    dark: { background: "#2e3440", text: "#d8dee9", accent: "#88c0d0", muted: "#9aa5b8" },
  },
  {
    id: "solarized",
    name: "Solarized",
    description: "The classic low-glare palette.",
    fonts: { editor: "source-serif-4", ui: "source-sans-3", code: "source-code-pro" },
    light: { background: "#fdf6e3", text: "#586e75", accent: "#268bd2", muted: "#93a1a1" },
    dark: { background: "#002b36", text: "#93a1a1", accent: "#2aa198", muted: "#657b83" },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    description: "Soft pastels (Latte and Mocha).",
    fonts: { editor: "atkinson", ui: "inter", code: "jetbrains-mono" },
    light: { background: "#eff1f5", text: "#4c4f69", accent: "#8839ef", muted: "#7c7f93" },
    dark: { background: "#1e1e2e", text: "#cdd6f4", accent: "#cba6f7", muted: "#9399b2" },
  },
];

export const DEFAULT_THEME_ID = "anchor";

export function themeById(id: string): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export interface AppearanceState {
  themeId: string;
  /** Per-variant color changes on top of the preset. */
  colors: Record<Variant, Partial<Record<ColorKey, string>>>;
  /** Font changes on top of the preset. */
  fonts: Partial<Record<FontKind, string>>;
}

const STORAGE_KEY = "anchor-appearance";
const HEX = /^#[0-9a-f]{6}$/i;

const EMPTY: AppearanceState = { themeId: DEFAULT_THEME_ID, colors: { light: {}, dark: {} }, fonts: {} };

function cleanColors(raw: unknown): Partial<Record<ColorKey, string>> {
  const out: Partial<Record<ColorKey, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of ["background", "text", "accent"] as ColorKey[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && HEX.test(value)) out[key] = value.toLowerCase();
  }
  return out;
}

export function loadAppearance(): AppearanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AppearanceState>;
    const fonts: Partial<Record<FontKind, string>> = {};
    for (const kind of ["editor", "ui", "code"] as FontKind[]) {
      const id = parsed.fonts?.[kind];
      if (typeof id === "string" && FONT_CHOICES[kind].includes(id)) fonts[kind] = id;
    }
    return {
      themeId: themeById(typeof parsed.themeId === "string" ? parsed.themeId : DEFAULT_THEME_ID).id,
      colors: { light: cleanColors(parsed.colors?.light), dark: cleanColors(parsed.colors?.dark) },
      fonts,
    };
  } catch {
    return EMPTY;
  }
}

function save(state: AppearanceState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ themeId: state.themeId, colors: state.colors, fonts: state.fonts }),
    );
  } catch {
    // Unavailable storage only means the choice is not remembered.
  }
}

interface AppearanceStore extends AppearanceState {
  /** Pick a preset. Clears your changes so the preset shows as designed. */
  setTheme: (id: string) => void;
  setColor: (variant: Variant, key: ColorKey, value: string) => void;
  setFont: (kind: FontKind, id: string) => void;
  /** Drop every change and show the current preset as designed. */
  resetChanges: () => void;
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => {
  const commit = (next: AppearanceState) => {
    set(next);
    save(next);
  };
  const current = (): AppearanceState => {
    const { themeId, colors, fonts } = get();
    return { themeId, colors, fonts };
  };
  return {
    ...loadAppearance(),
    setTheme: (id) => commit({ ...EMPTY, themeId: themeById(id).id }),
    setColor: (variant, key, value) => {
      if (!HEX.test(value)) return;
      const state = current();
      const preset = themeById(state.themeId)[variant][key];
      const changes = { ...state.colors[variant] };
      // Picking the preset's own value again is not a change.
      if (value.toLowerCase() === preset) delete changes[key];
      else changes[key] = value.toLowerCase();
      commit({ ...state, colors: { ...state.colors, [variant]: changes } });
    },
    setFont: (kind, id) => {
      if (!FONT_CHOICES[kind].includes(id)) return;
      const state = current();
      const fonts = { ...state.fonts };
      if (id === themeById(state.themeId).fonts[kind]) delete fonts[kind];
      else fonts[kind] = id;
      commit({ ...state, fonts });
    },
    resetChanges: () => commit({ ...EMPTY, themeId: get().themeId }),
  };
});

export function hasChanges(state: AppearanceState): boolean {
  return (
    Object.keys(state.fonts).length > 0 ||
    Object.keys(state.colors.light).length > 0 ||
    Object.keys(state.colors.dark).length > 0
  );
}

/** The colors and fonts in effect for one variant. */
export function resolveAppearance(state: AppearanceState, variant: Variant) {
  const preset = themeById(state.themeId);
  const base = preset[variant];
  const changes = state.colors[variant];
  const background = changes.background ?? base.background;
  const text = changes.text ?? base.text;
  const accent = changes.accent ?? base.accent;
  const muted = changes.background || changes.text ? mix(text, background, 0.6) : base.muted;
  const fonts = {
    editor: state.fonts.editor ?? preset.fonts.editor,
    ui: state.fonts.ui ?? preset.fonts.ui,
    code: state.fonts.code ?? preset.fonts.code,
  };
  return { preset, background, text, accent, muted, fonts };
}

// ---------- color math (sRGB, enough for mixing UI tones) ----------

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** `amount` of `a` over `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] * amount + y[i] * (1 - amount)) as [number, number, number]);
}

function luminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `color` itself when it reads on `background` at `min` contrast (WCAG: 4.5
 * for text), else the nearest shade toward black or white that does. Keeps
 * theme presets and any colors you pick legible.
 */
export function withContrast(color: string, background: string, min = 4.5): string {
  if (contrastRatio(color, background) >= min) return color;
  const toward = luminance(background) > 0.18 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(toward, color, step / 20);
    if (contrastRatio(candidate, background) >= min) return candidate;
  }
  return toward;
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.4 ? "#111111" : "#ffffff";
}

// ---------- applying to the document ----------

const TOKENS = [
  "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
  "--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted",
  "--muted-foreground", "--accent", "--accent-foreground", "--border", "--input", "--ring",
  "--sidebar", "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground",
  "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border", "--sidebar-ring",
  "--link", "--prose-body",
];

/** Write the theme onto <html>. `dark` is the variant currently showing. */
export function applyAppearance(state: AppearanceState, dark: boolean) {
  const root = document.documentElement;
  const variant: Variant = dark ? "dark" : "light";
  const resolved = resolveAppearance(state, variant);
  const { background, accent, fonts } = resolved;
  // Text, secondary text and links always meet 4.5:1, also on the lightly
  // tinted surfaces (selected rows, side panels), hence the 5:1 target.
  const text = withContrast(resolved.text, background, 5);
  const muted = withContrast(resolved.muted, background, 5);

  root.style.setProperty("--font-editor", FONTS[fonts.editor].stack);
  root.style.setProperty("--font-ui", FONTS[fonts.ui].stack);
  root.style.setProperty("--font-code", FONTS[fonts.code].stack);

  const stylesheetColors = state.themeId === DEFAULT_THEME_ID && Object.keys(state.colors[variant]).length === 0;
  if (stylesheetColors) {
    for (const token of TOKENS) root.style.removeProperty(token);
    delete root.dataset.anchorTheme;
    return;
  }

  const tone = (amount: number) => mix(text, background, amount);
  const raised = dark ? tone(0.06) : background;
  const fill = dark ? tone(0.1) : tone(0.05);
  const border = dark ? tone(0.13) : tone(0.11);
  const values: Record<string, string> = {
    "--background": background,
    "--foreground": text,
    "--card": raised,
    "--card-foreground": text,
    "--popover": raised,
    "--popover-foreground": text,
    "--primary": accent,
    "--primary-foreground": readableOn(accent),
    "--secondary": fill,
    "--secondary-foreground": text,
    "--muted": fill,
    "--muted-foreground": muted,
    "--accent": fill,
    "--accent-foreground": text,
    "--border": border,
    "--input": dark ? tone(0.17) : tone(0.14),
    "--ring": accent,
    "--sidebar": background,
    "--sidebar-foreground": text,
    "--sidebar-primary": accent,
    "--sidebar-primary-foreground": readableOn(accent),
    "--sidebar-accent": dark ? tone(0.1) : tone(0.06),
    "--sidebar-accent-foreground": text,
    "--sidebar-border": border,
    "--sidebar-ring": accent,
    "--link": withContrast(accent, background, 5),
    "--prose-body": withContrast(tone(0.88), background, 5),
  };
  for (const [token, value] of Object.entries(values)) root.style.setProperty(token, value);
  root.dataset.anchorTheme = state.themeId;
}
