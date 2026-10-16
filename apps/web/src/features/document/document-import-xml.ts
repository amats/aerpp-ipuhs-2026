import { SaxesParser, type SaxesTagNS } from "saxes"
import { DOCUMENT_IMPORT_CONSTRAINTS as limits } from "./document-import-constraints"

// A streaming parser bounds structure before a consumer constructs a DOM.
// Handlers keep only the data their format needs; no external entities or DTDs.
export function parseOfficeXml(
  xml: string,
  handlers: {
    open?: (tag: SaxesTagNS, depth: number) => void
    close?: (tag: SaxesTagNS, depth: number) => void
    text?: (text: string) => void
  } = {},
) {
  if (new TextEncoder().encode(xml).byteLength > limits.maxXmlBytes)
    throw new Error("XML too large")
  const parser = new SaxesParser({ xmlns: true })
  let depth = 0
  let nodes = 0
  const count = () => {
    if (++nodes > limits.maxXmlNodes) throw new Error("XML too complex")
  }
  parser.on("doctype", () => {
    throw new Error("Unsupported XML declaration")
  })
  parser.on("opentag", (tag) => {
    count()
    if (++depth > limits.maxXmlDepth) throw new Error("XML too deep")
    handlers.open?.(tag, depth)
  })
  parser.on("closetag", (tag) => {
    handlers.close?.(tag, depth)
    depth--
  })
  const text = (value: string) => {
    count()
    handlers.text?.(value)
  }
  parser.on("text", text)
  parser.on("cdata", text)
  parser.on("comment", count)
  parser.write(xml).close()
}
