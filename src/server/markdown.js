// Server-side transformation of the Yjs document into ProseMirror JSON and Markdown.
// Milkdown's collab plugin stores the ProseMirror doc in the Y.XmlFragment "prosemirror"
// (via y-prosemirror). We read it back with y-prosemirror and serialize the commonmark
// node set that @milkdown/preset-commonmark produces.
import { yDocToProsemirrorJSON } from "y-prosemirror";

export const FRAGMENT_NAME = "prosemirror";

export function docToJSON(ydoc) {
  return yDocToProsemirrorJSON(ydoc, FRAGMENT_NAME);
}

export function docToMarkdown(ydoc) {
  return jsonToMarkdown(docToJSON(ydoc));
}

export function jsonToMarkdown(doc) {
  return blocks(doc.content ?? [], "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function blocks(nodes, indent) {
  return nodes.map((n) => block(n, indent)).join("\n\n");
}

function block(node, indent) {
  switch (node.type) {
    case "paragraph":
      return indent + inline(node.content).replace(/\n/g, "\n" + indent);
    case "heading":
      return indent + "#".repeat(node.attrs?.level ?? 1) + " " + inline(node.content);
    case "blockquote":
      return blocks(node.content ?? [], indent + "> ");
    case "code_block": {
      const lang = node.attrs?.language ?? "";
      const code = (node.content ?? []).map((t) => t.text ?? "").join("");
      return [indent + "```" + lang, ...code.split("\n").map((l) => indent + l), indent + "```"].join("\n");
    }
    case "hr":
      return indent + "---";
    case "bullet_list":
      return (node.content ?? [])
        .map((li) => listItem(li, indent, "- "))
        .join("\n");
    case "ordered_list": {
      const start = node.attrs?.order ?? 1;
      return (node.content ?? [])
        .map((li, i) => listItem(li, indent, `${start + i}. `))
        .join("\n");
    }
    case "image":
      return indent + imageMd(node);
    case "html":
      return indent + (node.attrs?.value ?? "");
    default:
      // Unknown block: render children as best effort.
      return node.content ? blocks(node.content, indent) : indent + (node.text ?? "");
  }
}

function listItem(li, indent, marker) {
  const inner = blocks(li.content ?? [], indent + " ".repeat(marker.length));
  // First line gets the marker instead of the padding.
  return indent + marker + inner.slice(indent.length + marker.length);
}

function imageMd(node) {
  const { src = "", alt = "", title } = node.attrs ?? {};
  return `![${alt}](${src}${title ? ` "${title}"` : ""})`;
}

function inline(nodes = []) {
  return nodes.map(inlineNode).join("");
}

function inlineNode(node) {
  if (node.type === "hardbreak" || node.type === "hard_break") return "  \n";
  if (node.type === "image") return imageMd(node);
  let text = node.text ?? "";
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "strong": text = `**${text}**`; break;
      case "emphasis": text = `*${text}*`; break;
      case "inlineCode": text = "`" + text + "`"; break;
      case "link": {
        const { href = "", title } = mark.attrs ?? {};
        text = `[${text}](${href}${title ? ` "${title}"` : ""})`;
        break;
      }
      case "strike_through": text = `~~${text}~~`; break;
    }
  }
  return text;
}
