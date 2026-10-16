type MarkdownNode = {
  type: string
  alt?: string | null
  value?: string
  children?: MarkdownNode[]
}

// Remove image URLs before either React rendering or Word HTML conversion.
export function remarkImagesToText() {
  function replaceImages(node: MarkdownNode) {
    if (!node.children) return
    node.children = node.children.map((child) => {
      if (child.type === "image" || child.type === "imageReference") {
        return { type: "text", value: child.alt ?? "" }
      }
      replaceImages(child)
      return child
    })
  }
  return replaceImages
}
