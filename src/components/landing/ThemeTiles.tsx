import { useRef, type RefObject } from "react";
import { preloadFonts, THEME_TILES, tileFonts, tileKey, type ThemeTile } from "./themePreview";

interface ThemeTilesProps {
  gridRef: RefObject<HTMLDivElement | null>;
  /** The theme on the page; null is the page's own style, shown as Anchor. */
  selected: ThemeTile | null;
  onSelect: (tile: ThemeTile | null) => void;
}

/** Click a tile to see the whole page in that theme. Anchor is the page's own look. */
export default function ThemeTiles({ gridRef, selected, onSelect }: ThemeTilesProps) {
  const preloaded = useRef(false);
  const warmUp = () => {
    if (preloaded.current) return;
    preloaded.current = true;
    preloadFonts(THEME_TILES);
  };
  const selectedKey = selected ? tileKey(selected) : tileKey(THEME_TILES[0]);

  return (
    <div ref={gridRef} className="lp-themes" role="group" aria-label="Theme for this page" onPointerEnter={warmUp} onFocus={warmUp}>
      {THEME_TILES.map((tile, index) => {
        const colors = tile.theme[tile.variant];
        const key = tileKey(tile);
        return (
          <button
            key={key}
            type="button"
            className="lp-theme"
            aria-pressed={key === selectedKey}
            style={{ background: colors.background, color: colors.text }}
            onClick={() => onSelect(index === 0 ? null : tile)}
          >
            <span style={{ fontFamily: tileFonts(tile).editor }}>Aa</span>
            <i style={{ background: colors.accent }} />
            <small>{tile.theme.name}</small>
          </button>
        );
      })}
    </div>
  );
}
