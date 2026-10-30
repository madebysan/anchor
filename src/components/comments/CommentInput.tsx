import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";

interface CommentInputProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  sendLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

/** Plain comment box. Comments are notes for yourself; Claude lives in the chat below. */
export default function CommentInput({
  onSubmit,
  placeholder = "Write a comment…",
  ariaLabel = "Comment message",
  sendLabel = "Send comment",
  autoFocus = false,
  disabled = false,
}: CommentInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    // Tiptap may grab focus back right after the comment is created. Defer +
    // retry so the textarea wins the race.
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

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="flex gap-2 items-end">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits, Shift+Enter inserts a newline.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className="min-h-[60px] max-h-[120px] resize-none text-sm"
        rows={2}
      />
      <Button
        size="icon"
        variant="ghost"
        onClick={handleSubmit}
        disabled={!value.trim() || disabled}
        className="flex-shrink-0 h-8 w-8"
        aria-label={sendLabel}
        title={sendLabel}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
