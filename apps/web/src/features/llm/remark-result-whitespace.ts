type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
}

// Render ordinary line breaks and escaped whitespace without rewriting saved output,
// Markdown structure, link destinations, or inline/fenced code.
export function remarkResultWhitespace() {
  function replaceWhitespace(node: MarkdownNode) {
    if (!node.children) return
    node.children = node.children.flatMap((child): MarkdownNode[] => {
      if (child.type === "text" && child.value) {
        return child.value
          .split(/\\r\\n|\\n|\r\n|[\r\n]/)
          .flatMap((value, index) => {
            const text = { type: "text", value: value.replace(/\\t/g, "\t") }
            return index === 0 ? [text] : [{ type: "break" }, text]
          })
      }
      replaceWhitespace(child)
      return [child]
    })
  }
  return replaceWhitespace
}
