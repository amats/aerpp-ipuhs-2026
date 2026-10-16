import { openOfficeArchive } from "./document-archive"
import { DOCUMENT_IMPORT_CONSTRAINTS as limits } from "./document-import-constraints"
import { checkExtractedText } from "./document-import-text"
import { parseOfficeXml } from "./document-import-xml"

export function extractPptxTextFromXml(xml: string) {
  const fragments: string[] = []
  let textDepth = 0
  let size = 0
  const append = (value: string) => {
    size += value.length
    if (size > limits.maxTextCodeUnits) throw new Error("Text too large")
    fragments.push(value)
  }
  try {
    parseOfficeXml(xml, {
      open: (tag) => {
        if (tag.local === "t") textDepth++
        else if (tag.local === "p" || tag.local === "br") append("\n")
      },
      close: (tag) => {
        if (tag.local === "t") textDepth--
      },
      text: (value) => {
        if (textDepth > 0) append(value)
      },
    })
  } catch {
    throw new Error("Invalid PPTX XML or import limit exceeded")
  }
  return fragments.join("").trim()
}

export { extractDocxContent } from "./document-docx-extraction"

export async function extractPptxContent(source: Blob | ArrayBuffer) {
  const archive = await openOfficeArchive(source)
  try {
    const relationships = new Map<
      string,
      { target: string; type: string; mode: string }
    >()
    parseOfficeXml(await archive.readXml("ppt/_rels/presentation.xml.rels"), {
      open: (tag) => {
        if (tag.local !== "Relationship") return
        const id = tag.attributes.Id?.value
        if (!id || relationships.has(id))
          throw new Error("Ambiguous PPTX relationship")
        relationships.set(id, {
          target: tag.attributes.Target?.value ?? "",
          type: tag.attributes.Type?.value ?? "",
          mode: tag.attributes.TargetMode?.value ?? "Internal",
        })
      },
    })
    const slides: string[] = []
    const uniqueParts = new Set<string>()
    let slideListDepth = 0
    parseOfficeXml(await archive.readXml("ppt/presentation.xml"), {
      open: (tag, depth) => {
        if (depth === 2 && tag.local === "sldIdLst") slideListDepth = depth
        else if (slideListDepth > 0 && depth === slideListDepth + 1) {
          if (slides.length >= limits.maxSlides)
            throw new Error("Too many slides")
          const id = Object.values(tag.attributes).find(
            (attribute) => attribute.local === "id" && attribute.uri !== "",
          )?.value
          const relationship = relationships.get(id ?? "")
          if (
            !relationship?.target ||
            relationship.mode !== "Internal" ||
            relationship.type.endsWith("/slide") !== true
          )
            throw new Error("Invalid PPTX slide relationship")
          const url = new URL(
            relationship.target,
            "https://pptx.invalid/ppt/presentation.xml",
          )
          if (
            url.origin !== "https://pptx.invalid" ||
            url.search !== "" ||
            url.hash !== ""
          )
            throw new Error("Invalid PPTX slide target")
          const name = decodeURIComponent(url.pathname.slice(1))
          if (uniqueParts.has(name)) throw new Error("Repeated PPTX slide part")
          uniqueParts.add(name)
          slides.push(name)
        }
      },
      close: (_tag, depth) => {
        if (depth === slideListDepth) slideListDepth = 0
      },
    })
    const texts: string[] = []
    let size = 0
    for (const slide of slides) {
      const text = extractPptxTextFromXml(await archive.readXml(slide))
      size += text.length + (texts.length > 0 ? 1 : 0)
      if (size > limits.maxTextCodeUnits) throw new Error("Text too large")
      texts.push(text)
    }
    return checkExtractedText(texts.join("\n"))
  } finally {
    await archive.close()
  }
}
