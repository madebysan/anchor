import type { Node, Mark } from "@tiptap/pm/model";

// Convert a ProseMirror document node to Markdown

// Priority order: code first (innermost), then bold/italic/strike (outermost)
const MARK_PRIORITY: Record<string, number> = {
  code: 0,
  bold: 1,
  italic: 2,
  strike: 3,
};

function serializeInlineMarks(text: string, marks: readonly Mark[]): string {
  // Sort marks so code is applied first (innermost), wrapping marks applied last (outermost)
  const sorted = [...marks].sort(
    (a, b) => (MARK_PRIORITY[a.type.name] ?? 99) - (MARK_PRIORITY[b.type.name] ?? 99)
  );
  let result = text;
  for (const mark of sorted) {
    switch (mark.type.name) {
      case "bold":
        result = `**${result}**`;
        break;
      case "italic":
        result = `*${result}*`;
        break;
      case "code":
        result = `\`${result}\``;
        break;
      case "strike":
        result = `~~${result}~~`;
        break;
      // Skip comment marks — internal annotations, not exported
      case "comment":
        break;
    }
  }
  return result;
}

function serializeInlineContent(node: Node): string {
  let result = "";
  node.forEach((child) => {
    if (child.isText && child.text) {
      result += serializeInlineMarks(child.text, child.marks);
    } else if (child.type.name === "hardBreak") {
      result += "  \n";
    }
  });
  return result;
}

function serializeNode(node: Node, indent = ""): string {
  switch (node.type.name) {
    case "paragraph":
      return serializeInlineContent(node);

    case "heading": {
      const level = node.attrs.level as number;
      const prefix = "#".repeat(level);
      return `${prefix} ${serializeInlineContent(node)}`;
    }

    case "bulletList": {
      const items: string[] = [];
      node.forEach((child) => {
        items.push(serializeListItem(child, indent, "- "));
      });
      return items.join("\n");
    }

    case "orderedList": {
      const items: string[] = [];
      let i = (node.attrs.start as number) || 1;
      node.forEach((child) => {
        items.push(serializeListItem(child, indent, `${i}. `));
        i++;
      });
      return items.join("\n");
    }

    case "blockquote": {
      const lines: string[] = [];
      node.forEach((child) => {
        const text = serializeNode(child, indent);
        // Prefix each line with >
        text.split("\n").forEach((line) => {
          lines.push(`> ${line}`);
        });
      });
      return lines.join("\n");
    }

    case "codeBlock": {
      const lang = (node.attrs.language as string) || "";
      return `\`\`\`${lang}\n${node.textContent}\n\`\`\``;
    }

    case "horizontalRule":
      return "---";

    default:
      // Fallback: just get text content
      return node.textContent;
  }
}

function serializeListItem(node: Node, indent: string, bullet: string): string {
  const parts: string[] = [];
  let first = true;
  node.forEach((child) => {
    const text = serializeNode(child, indent + "  ");
    if (first) {
      parts.push(`${indent}${bullet}${text}`);
      first = false;
    } else {
      // Nested blocks inside list items get extra indent
      parts.push(`${indent}  ${text}`);
    }
  });
  return parts.join("\n");
}

export function docToMarkdown(doc: Node): string {
  const blocks: string[] = [];
  doc.forEach((node) => {
    blocks.push(serializeNode(node));
  });
  return blocks.join("\n\n") + "\n";
}
