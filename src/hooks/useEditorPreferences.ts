
import { useState, useEffect, useCallback, useRef } from "react";
import {
  type EditorPreferences,
  DEFAULT_EDITOR_PREFS,
  LINE_HEIGHT_OPTIONS,
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

  const setFontSize = useCallback((sizeId: string) => {
    setPrefs((prev) => ({ ...prev, sizeId }));
  }, []);

  const setLineHeight = useCallback((lineHeightId: string) => {
    setPrefs((prev) => ({ ...prev, lineHeightId }));
  }, []);

  const toggleFormattingCollapsed = useCallback(() => {
    setPrefs((prev) => ({ ...prev, formattingCollapsed: !prev.formattingCollapsed }));
  }, []);

  // Resolve current size and line-height objects.
  const currentSize = SIZE_OPTIONS.find((s) => s.id === prefs.sizeId) ?? SIZE_OPTIONS[2];
  const currentLineHeight =
    LINE_HEIGHT_OPTIONS.find((l) => l.id === prefs.lineHeightId) ?? LINE_HEIGHT_OPTIONS[1];

  return {
    prefs,
    currentSize,
    currentLineHeight,
    setFontSize,
    setLineHeight,
    formattingCollapsed: prefs.formattingCollapsed,
    toggleFormattingCollapsed,
  };
}
