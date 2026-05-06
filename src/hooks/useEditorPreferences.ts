
import { useState, useEffect, useCallback, useRef } from "react";
import {
  type EditorPreferences,
  DEFAULT_EDITOR_PREFS,
  FONT_OPTIONS,
  SIZE_OPTIONS,
  loadEditorPrefs,
  saveEditorPrefs,
} from "@/lib/editor-preferences";

export function useEditorPreferences() {
  const [prefs, setPrefs] = useState<EditorPreferences>(DEFAULT_EDITOR_PREFS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Load from localStorage on mount
  useEffect(() => {
    setPrefs(loadEditorPrefs());
    setLoaded(true);
  }, []);

  // Debounced save whenever prefs change (skip initial load)
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveEditorPrefs(prefs);
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [prefs, loaded]);

  const setFont = useCallback((fontId: string) => {
    setPrefs((prev) => ({ ...prev, fontId }));
  }, []);

  const setFontSize = useCallback((sizeId: string) => {
    setPrefs((prev) => ({ ...prev, sizeId }));
  }, []);

  // Resolve current font/size objects
  const currentFont = FONT_OPTIONS.find((f) => f.id === prefs.fontId) ?? FONT_OPTIONS[0];
  const currentSize = SIZE_OPTIONS.find((s) => s.id === prefs.sizeId) ?? SIZE_OPTIONS[2];

  return { prefs, currentFont, currentSize, setFont, setFontSize };
}
