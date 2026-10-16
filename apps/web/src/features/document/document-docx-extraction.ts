import JSZip from "jszip"
import { openOfficeArchive } from "./document-archive"
import { checkExtractedText } from "./document-import-text"
import { parseOfficeXml } from "./document-import-xml"

export async function extractDocxContent(source: Blob | ArrayBuffer) {
  const archive = await openOfficeArchive(source)
  try {
    const validated = new JSZip()
    // Mammoth uses these fallbacks when an optional relationship is absent.
    const parts = new Set([
      "word/document.xml",
      "word/comments.xml",
      "word/endnotes.xml",
      "word/footnotes.xml",
      "word/numbering.xml",
      "word/styles.xml",
    ])
    const include = async (name: string) => {
      if (archive.has(name) !== true) return null
      const xml = await archive.readXml(name)
      parseOfficeXml(xml)
      validated.file(name, xml, { createFolders: false })
      return xml
    }
    const includeRelationships = async (name: string, base: string) => {
      const xml = await include(name)
      if (xml === null) return
      parseOfficeXml(xml, {
        open: (tag) => {
          if (tag.local !== "Relationship") return
          const type = tag.attributes.Type?.value ?? ""
          const target = tag.attributes.Target?.value
          if (
            !target ||
            /^http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/(officeDocument|comments|endnotes|footnotes|numbering|styles)$/.test(
              type,
            ) !== true
          )
            return
          // Match Mammoth's joinPath/stripPrefix, including renamed root parts.
          const path = target.startsWith("/")
            ? target.slice(1)
            : base
              ? `${base}/${target}`
              : target
          if (archive.has(path) === true) parts.add(path)
        },
      })
    }
    await include("[Content_Types].xml")
    await includeRelationships("_rels/.rels", "")
    for (const name of parts) {
      if ((await include(name)) === null) continue
      const slash = name.lastIndexOf("/")
      const base = slash < 0 ? "" : name.slice(0, slash)
      const relationships = `${base ? `${base}/` : ""}_rels/${name.slice(slash + 1)}.rels`
      await includeRelationships(relationships, base)
    }
    // Pass only bounded, validated XML to the downstream parser. Media,
    // unrelated XML and arbitrary embedded objects are never read or expanded.
    // Mammoth's raw-text path does not read image payloads.
    const mammoth = await import("mammoth")
    const result = await mammoth.extractRawText({
      arrayBuffer: await validated.generateAsync({
        type: "arraybuffer",
        compression: "STORE",
      }),
    })
    return checkExtractedText(result.value)
  } finally {
    await archive.close()
  }
}
