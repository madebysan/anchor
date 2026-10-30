import { Mark, mergeAttributes } from "@tiptap/react";

export const EditHighlight = Mark.create({
  name: "editHighlight",
  inclusive: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-edit-highlight"),
        renderHTML: (attributes) => ({
          "data-edit-highlight": attributes.id,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark[data-edit-highlight]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      mergeAttributes(HTMLAttributes, {
        class: "edit-highlight",
      }),
      0,
    ];
  },
});
