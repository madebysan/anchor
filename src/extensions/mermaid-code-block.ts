import CodeBlock from "@tiptap/extension-code-block";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// Code blocks fenced as ```mermaid show the rendered diagram. Double-click
// the diagram (or move the cursor into it) to edit its source; leave the block
// and it renders again. The file keeps the plain fenced code.

type MermaidApi = typeof import("mermaid").default;

let mermaidLoad: Promise<MermaidApi> | null = null;
let renderCount = 0;

/** Mermaid is large, so it loads the first time a note contains a diagram. */
function loadMermaid(): Promise<MermaidApi> {
  mermaidLoad ??= import("mermaid").then((module) => module.default);
  return mermaidLoad;
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

async function renderDiagram(source: string): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: isDark() ? "dark" : "neutral",
    fontFamily: "inherit",
  });
  renderCount += 1;
  const { svg } = await mermaid.render(`anchor-mermaid-${renderCount}`, source);
  return svg;
}

const isMermaid = (node: ProseMirrorNode) => String(node.attrs.language ?? "").toLowerCase() === "mermaid";

export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node: initialNode, editor, getPos }) => {
      let node = initialNode;
      let editing = false;
      let renderedSource: string | null = null;
      let renderedDark: boolean | null = null;

      const dom = document.createElement("div");
      dom.className = "code-block-view";

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      pre.appendChild(code);

      const preview = document.createElement("div");
      preview.className = "mermaid-preview";
      preview.contentEditable = "false";
      preview.title = "Double-click to edit the diagram";
      // Screen readers get a name for the picture and how to reach its source.
      preview.setAttribute("role", "img");

      dom.append(preview, pre);

      const nodeRange = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        return pos == null ? null : { from: pos, to: pos + node.nodeSize };
      };

      const setLanguageClass = () => {
        const language = node.attrs.language as string | null;
        code.className = language ? `language-${language}` : "";
      };

      const label = (source: string, state: string) => {
        const firstLine = source.trim().split("\n")[0]?.trim() || "empty";
        preview.setAttribute(
          "aria-label",
          `${state ? `${state} m` : "M"}ermaid diagram, ${firstLine}. Move the cursor into it to edit its source.`,
        );
      };

      const render = () => {
        const source = node.textContent;
        const dark = isDark();
        if (source === renderedSource && dark === renderedDark) return;
        renderedSource = source;
        renderedDark = dark;
        if (!source.trim()) {
          preview.innerHTML = "";
          preview.dataset.state = "empty";
          preview.textContent = "Empty diagram. Double-click to write it.";
          label(source, "Empty");
          return;
        }
        renderDiagram(source)
          .then((svg) => {
            // A newer edit may have started rendering meanwhile.
            if (renderedSource !== source) return;
            preview.dataset.state = "ok";
            preview.innerHTML = svg;
            preview.querySelector("svg")?.setAttribute("aria-hidden", "true");
            label(source, "");
          })
          .catch(() => {
            if (renderedSource !== source) return;
            preview.dataset.state = "error";
            preview.textContent = "This diagram has an error. Double-click to fix it.";
            label(source, "Broken");
          });
      };

      const show = () => {
        const diagram = isMermaid(node);
        dom.classList.toggle("is-mermaid", diagram);
        dom.classList.toggle("is-editing", diagram && editing);
        preview.hidden = !diagram || editing;
        pre.hidden = diagram && !editing;
        if (diagram && !editing) render();
      };

      const startEditing = () => {
        const range = nodeRange();
        if (!range) return;
        editing = true;
        show();
        editor.chain().setTextSelection(range.from + 1).focus(null, { scrollIntoView: false }).run();
      };

      // Editing ends when the cursor leaves the block. A cursor placed inside
      // it (arrow keys, typing ```mermaid) starts editing; a wider selection,
      // like the one left after Claude replaces text, only outlines it.
      const onSelection = ({ editor: current }: { editor: Editor }) => {
        if (!isMermaid(node)) return;
        const range = nodeRange();
        if (!range) return;
        const { from, to, empty } = current.state.selection;
        const inside = from > range.from && to < range.to;
        const overlaps = from < range.to && to > range.from;
        if (editing && !inside) {
          editing = false;
          show();
        } else if (!editing && inside && empty && current.view.hasFocus()) {
          editing = true;
          show();
        }
        dom.classList.toggle("is-selected", !editing && overlaps && !empty);
      };
      editor.on("selectionUpdate", onSelection);

      // Follow light and dark mode.
      const themeObserver = new MutationObserver(() => {
        if (isMermaid(node) && !editing) render();
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

      preview.addEventListener("dblclick", (event) => {
        event.preventDefault();
        startEditing();
      });

      setLanguageClass();
      show();

      return {
        dom,
        contentDOM: code,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          node = updated;
          setLanguageClass();
          show();
          return true;
        },
        // Only text edits inside the code are ProseMirror's. The diagram and the
        // show/hide attributes are ours; reading them back would rebuild the
        // view and drop out of editing.
        ignoreMutation: (mutation) => {
          if (mutation.type === "selection") return false;
          if (preview.contains(mutation.target as globalThis.Node)) return true;
          return mutation.type === "attributes" && !code.contains(mutation.target as globalThis.Node);
        },
        stopEvent: (event) => preview.contains(event.target as globalThis.Node),
        destroy: () => {
          editor.off("selectionUpdate", onSelection);
          themeObserver.disconnect();
        },
      };
    };
  },
});
