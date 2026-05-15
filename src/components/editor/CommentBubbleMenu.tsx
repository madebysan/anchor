
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CommentBubbleMenuProps {
  editor: Editor;
  onAddComment: () => void;
  onAskAI: () => void;
}

export default function CommentBubbleMenu({
  editor,
  onAddComment,
  onAskAI,
}: CommentBubbleMenuProps) {
  return (
    <BubbleMenu
      editor={editor}
      // Only show when there's a real text selection (not just a cursor)
      shouldShow={({ editor }) => {
        const { from, to } = editor.state.selection;
        return from !== to;
      }}
    >
      <div className="flex items-center gap-1 rounded-lg border border-border bg-popover px-1 py-1 shadow-lg">
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-1.5 text-xs h-7 px-2"
          onClick={onAddComment}
          aria-label="Add comment"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Add Comment
        </Button>
        <div className="h-5 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-1.5 text-xs h-7 px-2"
          onClick={onAskAI}
          aria-label="Ask AI"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Ask AI
        </Button>
      </div>
    </BubbleMenu>
  );
}
