type FontLoader = () => Promise<unknown>;

const loadedFonts = new Set<string>(["geist"]);

const fontLoaders: Record<string, FontLoader> = {
  inter: () => import("@fontsource/inter/latin-400.css"),
  lora: () => import("@fontsource/lora/latin-400.css"),
  merriweather: () => import("@fontsource/merriweather/latin-400.css"),
  nunito: () => import("@fontsource/nunito/latin-400.css"),
  "open-sans": () => import("@fontsource/open-sans/latin-400.css"),
  playfair: () => import("@fontsource/playfair-display/latin-400.css"),
  roboto: () => import("@fontsource/roboto/latin-400.css"),
  "source-serif": () => import("@fontsource/source-serif-4/latin-400.css"),
  "ibm-plex": () => import("@fontsource/ibm-plex-sans/latin-400.css"),
};

export function loadEditorFont(fontId: string): void {
  if (loadedFonts.has(fontId)) return;
  const loader = fontLoaders[fontId];
  if (!loader) return;

  loadedFonts.add(fontId);
  loader().catch((error: unknown) => {
    loadedFonts.delete(fontId);
    console.error(`Failed to load editor font "${fontId}":`, error);
  });
}
