"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { parseTrigger, isPlainNote } from "@/lib/triggers";
import {
  applyContextStrategy,
  STRATEGY_LABELS,
  type DocumentSnapshot,
} from "@/lib/ai/context-router";
import { parseModelId } from "@/lib/ai/providers";
import type { TriggerConfig } from "@/types";

interface TriggerOption {
  key: string;
  name: string;
}

interface CommentInputProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  triggerOptions?: TriggerOption[];
  /** Full trigger configs — used to compute the context-preview chip. */
  triggerConfigs?: Record<string, TriggerConfig>;
  /** The thread's anchored passage — fed into the chip's context router preview. */
  selectedText?: string;
  /** Lazy doc snapshot getter — only walked when a trigger is detected. */
  getDocumentSnapshot?: () => DocumentSnapshot;
  /** Default persona key to fire when no @trigger and not a plain note. */
  defaultPersona?: string;
}

export default function CommentInput({
  onSubmit,
  placeholder = "Write a message or type @ for triggers...",
  autoFocus = false,
  disabled = false,
  triggerOptions = [],
  triggerConfigs,
  selectedText = "",
  getDocumentSnapshot,
  defaultPersona,
}: CommentInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Autocomplete state
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [filteredTriggers, setFilteredTriggers] = useState<TriggerOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Track the position in the string where the @ starts
  const [atStartPos, setAtStartPos] = useState<number | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    // Tiptap may grab focus back when the bubble menu closes after the
    // comment button click. Defer + retry so the textarea wins the race.
    const focusEl = () => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    focusEl();
    const t1 = window.setTimeout(focusEl, 50);
    const t2 = window.setTimeout(focusEl, 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [autoFocus]);

  // Detect @ and filter triggers as user types
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setValue(newValue);

      const cursorPos = e.target.selectionStart ?? newValue.length;

      // Look backwards from cursor to find a @ that starts the current word
      // The @ must be at position 0 or preceded by whitespace
      let foundAt: number | null = null;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = newValue[i];
        if (ch === "@") {
          if (i === 0 || /\s/.test(newValue[i - 1])) {
            foundAt = i;
          }
          break;
        }
        if (/\s/.test(ch)) break;
      }

      if (foundAt !== null && triggerOptions.length > 0) {
        const query = newValue.slice(foundAt + 1, cursorPos).toLowerCase();
        const matches = triggerOptions.filter(
          (t) =>
            t.key.toLowerCase().startsWith(query) ||
            t.name.toLowerCase().startsWith(query)
        );
        if (matches.length > 0) {
          setFilteredTriggers(matches);
          setSelectedIndex(0);
          setAtStartPos(foundAt);
          setShowAutocomplete(true);
        } else {
          setShowAutocomplete(false);
        }
      } else {
        setShowAutocomplete(false);
      }
    },
    [triggerOptions]
  );

  // Insert a selected trigger into the textarea
  const insertTrigger = useCallback(
    (trigger: TriggerOption) => {
      if (atStartPos === null) return;
      const cursorPos = textareaRef.current?.selectionStart ?? value.length;
      const before = value.slice(0, atStartPos);
      const after = value.slice(cursorPos);
      const newValue = `${before}@${trigger.key} ${after}`;
      setValue(newValue);
      setShowAutocomplete(false);
      setAtStartPos(null);

      // Move cursor to right after the inserted trigger + space
      const newCursorPos = atStartPos + trigger.key.length + 2;
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      });
    },
    [atStartPos, value]
  );

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
    setShowAutocomplete(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Autocomplete navigation
    if (showAutocomplete && filteredTriggers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredTriggers.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredTriggers.length - 1
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertTrigger(filteredTriggers[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowAutocomplete(false);
        return;
      }
    }

    // Cmd/Ctrl + Enter to submit
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Close autocomplete when clicking outside
  useEffect(() => {
    if (!showAutocomplete) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowAutocomplete(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAutocomplete]);

  // Context preview chip — shows what slice of the doc + which model will be
  // used when the user submits. Only renders when an @trigger is detected.
  const enabledTriggerKeys = useMemo(
    () => triggerOptions.map((t) => t.key),
    [triggerOptions]
  );

  const chipInfo = useMemo(() => {
    if (!triggerConfigs || !getDocumentSnapshot) return null;
    const trigger = parseTrigger(value, enabledTriggerKeys);
    if (!trigger) return null;
    const config = triggerConfigs[trigger.type];
    if (!config) return null;
    const doc = getDocumentSnapshot();
    const routed = applyContextStrategy(
      config.contextStrategy,
      doc,
      selectedText
    );
    const parsedModel = parseModelId(config.modelId);
    return {
      personaKey: trigger.type,
      strategy: STRATEGY_LABELS[config.contextStrategy],
      charCount: routed.charCount,
      truncated: routed.truncated,
      modelName: parsedModel?.modelName ?? config.modelId ?? "(no model)",
    };
  }, [value, enabledTriggerKeys, triggerConfigs, selectedText, getDocumentSnapshot]);

  // Routing hint — small line that tells the user what will happen on submit
  // (which persona / plain note / unanchored chat) given the current input.
  const routingHint = useMemo(() => {
    const explicit = parseTrigger(value, enabledTriggerKeys);
    if (explicit) return null; // chip below already shows the persona
    if (isPlainNote(value)) {
      return { kind: "note" as const };
    }
    if (defaultPersona && enabledTriggerKeys.includes(defaultPersona)) {
      return { kind: "default" as const, persona: defaultPersona };
    }
    return null;
  }, [value, enabledTriggerKeys, defaultPersona]);

  return (
    <div className="relative">
      {chipInfo && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span className="px-1.5 py-0.5 rounded bg-muted shrink-0">
            {chipInfo.strategy} · {chipInfo.charCount.toLocaleString()} chars
            {chipInfo.truncated && " · truncated"}
          </span>
          <span
            className="font-mono truncate min-w-0"
            title={chipInfo.modelName}
          >
            {chipInfo.modelName}
          </span>
        </div>
      )}
      {!chipInfo && routingHint && (
        <div className="text-[10px] text-muted-foreground mb-1.5">
          {routingHint.kind === "note" ? (
            <span>Plain note · no AI</span>
          ) : (
            <span>
              → <span className="font-medium">@{routingHint.persona}</span> (default)
            </span>
          )}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="min-h-[60px] max-h-[120px] resize-none text-sm"
          rows={2}
        />
        <Button
          size="icon"
          variant="ghost"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="flex-shrink-0 h-8 w-8"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Autocomplete popover — positioned above the textarea */}
      {showAutocomplete && filteredTriggers.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-0 mb-1 w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-md z-50 overflow-hidden"
        >
          <div className="px-2 py-1.5 border-b border-border">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Triggers
            </p>
          </div>
          <div className="py-1 max-h-[200px] overflow-y-auto">
            {filteredTriggers.map((trigger, i) => (
              <button
                key={trigger.key}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                  i === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertTrigger(trigger);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="text-muted-foreground font-mono text-xs">@</span>
                <span>{trigger.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
