import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// When focus leaves the editor (for Ask AI, into the chat input), the browser
// stops drawing the selection although ProseMirror keeps it, and it is still
// what goes to Claude with the next message. Draw it ourselves while the
// editor is blurred so the user can see what Claude will get.

const pinnedSelectionKey = new PluginKey<boolean>("pinnedSelection");

export const PinnedSelection = Extension.create({
  name: "pinnedSelection",

  onFocus() {
    this.editor.view.dispatch(this.editor.state.tr.setMeta(pinnedSelectionKey, false).setMeta("addToHistory", false));
  },

  onBlur() {
    if (this.editor.isDestroyed) return;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(pinnedSelectionKey, true).setMeta("addToHistory", false));
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: pinnedSelectionKey,
        state: {
          // The editor starts without focus, so an edit applied before you click
          // into it (Claude's, for example) still shows as selected.
          init: () => true,
          apply: (tr, blurred) => {
            const meta = tr.getMeta(pinnedSelectionKey) as boolean | undefined;
            return meta ?? blurred;
          },
        },
        props: {
          decorations(state) {
            const blurred = pinnedSelectionKey.getState(state);
            const { from, to, empty } = state.selection;
            if (!blurred || empty) return null;
            return DecorationSet.create(state.doc, [Decoration.inline(from, to, { class: "pinned-selection" })]);
          },
        },
      }),
    ];
  },
});
