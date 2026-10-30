import { Mark, mergeAttributes } from "@tiptap/react";

// Custom Tiptap mark for comment highlights.
// Each comment thread applies this mark to the selected text range.
// The mark stores only the commentId — all thread data lives in React state.
export const CommentMark = Mark.create({
  name: "comment",

  // Allow overlapping comments on the same text
  excludes: "",

  // Multiple instances of this mark can coexist (for overlapping comments)
  inclusive: false,

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes) => ({
          "data-comment-id": attributes.commentId,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark[data-comment-id]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      mergeAttributes(HTMLAttributes, {
        class: "comment-highlight",
      }),
      0,
    ];
  },
});
