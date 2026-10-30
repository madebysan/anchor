import type { CSSProperties } from "react";
import { FONTS, mix, readableOn, themeById, withContrast, type ThemePreset, type Variant } from "@/lib/appearance";

// The theme tiles repaint the whole landing page with a theme's real colors
// and fonts, taken from the app's own presets. Like the app, only three colors
// come from the theme; every other tone is mixed from them, and text keeps
// at least 5:1 contrast.

export interface ThemeTile {
  theme: ThemePreset;
  variant: Variant;
}

/** Three light and three dark, as the tiles show them. */
export const THEME_TILES: ThemeTile[] = (
  [
    ["anchor", "light"],
    ["clay", "light"],
    ["sepia", "light"],
    ["graphite", "dark"],
    ["nord", "dark"],
    ["catppuccin", "dark"],
  ] as const
).map(([id, variant]) => ({ theme: themeById(id), variant }));

export const tileKey = (tile: ThemeTile) => `${tile.theme.id}-${tile.variant}`;

export function tileFonts(tile: ThemeTile) {
  const { editor, ui, code } = tile.theme.fonts;
  return { editor: FONTS[editor].stack, ui: FONTS[ui].stack, code: FONTS[code].stack };
}

/** `color` adjusted until it reads at `min` on every one of `surfaces`. */
function readableOnAll(color: string, surfaces: string[], min = 4.6): string {
  let out = color;
  for (let pass = 0; pass < 3; pass++) for (const surface of surfaces) out = withContrast(out, surface, min);
  return out;
}

export function previewStyle(tile: ThemeTile): CSSProperties {
  const dark = tile.variant === "dark";
  const { background: bg, accent } = tile.theme[tile.variant];
  const base = withContrast(tile.theme[tile.variant].text, bg, 5);
  const tone = (amount: number) => mix(base, bg, amount);
  // Text also sits on the tinted surfaces: selected rows and the highlight.
  const active = tone(dark ? 0.12 : 0.07);
  const mark = mix(accent, bg, dark ? 0.28 : 0.18);
  const surfaces = [bg, active, mark];
  const ink = readableOnAll(base, surfaces);
  const fonts = tileFonts(tile);
  const tokens: Record<string, string> = {
    "--lp-bg": bg,
    "--lp-ink": ink,
    "--lp-body": readableOnAll(tone(0.8), surfaces),
    "--lp-text": readableOnAll(tone(0.88), surfaces),
    "--lp-muted": readableOnAll(tile.theme[tile.variant].muted, [bg, active]),
    "--lp-line": tone(dark ? 0.14 : 0.1),
    "--lp-line-strong": tone(dark ? 0.24 : 0.18),
    "--lp-dot": tone(dark ? 0.16 : 0.14),
    "--lp-soft": tone(0.04),
    "--lp-chip": tone(0.03),
    "--lp-card": dark ? tone(0.05) : bg,
    "--lp-card-head": tone(dark ? 0.07 : 0.025),
    "--lp-active": active,
    "--lp-mark": mark,
    "--lp-accent": withContrast(accent, bg, 3),
    "--lp-pill-bg": bg,
    "--lp-btn-bg": ink,
    "--lp-btn-hover": mix(ink, bg, 0.86),
    "--lp-btn-ink": readableOn(ink),
    "--lp-ui": fonts.ui,
    "--lp-display": fonts.editor,
    "--lp-display-tracking": "-0.02em",
    "--lp-note": fonts.editor,
    "--lp-serif": fonts.editor,
    "--lp-mono": fonts.code,
  };
  return tokens as CSSProperties;
}

/** Start loading a tile's fonts so a hover swaps them without a second reflow. */
export function preloadFonts(tiles: ThemeTile[]) {
  if (typeof document === "undefined" || !document.fonts) return;
  for (const tile of tiles) {
    const { editor, ui, code } = tileFonts(tile);
    for (const spec of [`400 16px ${ui}`, `600 16px ${ui}`, `400 16px ${editor}`, `700 16px ${editor}`, `400 16px ${code}`]) {
      document.fonts.load(spec).catch(() => undefined);
    }
  }
}
