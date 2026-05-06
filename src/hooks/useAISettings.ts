
import { useState, useEffect, useCallback, useRef } from "react";
import type { AISettings, TriggerConfig } from "@/types";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TRIGGER_PROMPTS,
  loadSettings,
  saveSettings,
} from "@/lib/settings";

export function useAISettings() {
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // inline-md doesn't use API keys (Claude Code handles auth), but we keep
  // the AISettings shape from the inlineai parent for the persona/trigger
  // config it carries. Just load whatever's persisted in localStorage.
  useEffect(() => {
    setSettings(loadSettings());
    setLoaded(true);
  }, []);

  // Debounced save whenever settings change (skip initial load)
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSettings(settings);
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [settings, loaded]);

  const updateSettings = useCallback((patch: Partial<AISettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Reset a single trigger's prompt back to its default
  const resetTriggerPrompt = useCallback(
    (key: string) => {
      setSettings((prev) => ({
        ...prev,
        triggers: {
          ...prev.triggers,
          [key]: {
            ...prev.triggers[key],
            prompt: DEFAULT_TRIGGER_PROMPTS[key] ?? "",
          },
        },
      }));
    },
    []
  );

  // Update a single trigger config
  const updateTrigger = useCallback(
    (key: string, patch: Partial<TriggerConfig>) => {
      setSettings((prev) => ({
        ...prev,
        triggers: {
          ...prev.triggers,
          [key]: {
            ...prev.triggers[key],
            ...patch,
          },
        },
      }));
    },
    []
  );

  // Add a new trigger. Returns false if key already exists.
  // New triggers default to the "tight" context strategy and inherit a sane
  // model from an existing persona (or fall back to a sonnet-tier seed).
  const addTrigger = useCallback((name: string): boolean => {
    const key = name.toLowerCase().replace(/\s+/g, "-");
    setSettings((prev) => {
      if (prev.triggers[key]) return prev; // duplicate key — no-op
      // Inherit the modelId from any existing persona so the new one matches the
      // user's current provider preference. Fallback to the first DEFAULT modelId.
      const inheritedModelId =
        Object.values(prev.triggers)[0]?.modelId ??
        Object.values(DEFAULT_SETTINGS.triggers)[0]?.modelId ??
        "";
      return {
        ...prev,
        triggers: {
          ...prev.triggers,
          [key]: {
            name,
            enabled: true,
            prompt: `You are a ${name.toLowerCase()}. Help the user with the highlighted text based on your expertise. If the user gave specific instructions after the trigger, follow those instructions.`,
            contextStrategy: "tight",
            modelId: inheritedModelId,
          },
        },
      };
    });
    return true;
  }, []);

  // Remove a trigger by key
  const removeTrigger = useCallback((key: string) => {
    setSettings((prev) => {
      const { [key]: _, ...rest } = prev.triggers;
      return { ...prev, triggers: rest };
    });
  }, []);

  return {
    settings,
    updateSettings,
    updateTrigger,
    resetTriggerPrompt,
    addTrigger,
    removeTrigger,
  };
}
