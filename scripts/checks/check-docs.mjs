import { fileURLToPath, pathToFileURL } from "node:url"
import { findDocumentationFiles } from "./documentation-files.mjs"
import { findMarkdownLinkViolations } from "./markdown-links.mjs"

const WORKSPACE_ROOT = fileURLToPath(new URL("../../", import.meta.url))

export function findDocumentationViolations(root) {
  const anchors = new Map()
  return findDocumentationFiles(root).flatMap((file) =>
    findMarkdownLinkViolations(root, file, anchors),
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const violations = findDocumentationViolations(WORKSPACE_ROOT)
  if (violations.length > 0) {
    console.error(
      ["Documentation link check failed:", ...violations].join("\n"),
    )
    process.exitCode = 1
  } else {
    console.log(
      `Documentation links passed (${findDocumentationFiles(WORKSPACE_ROOT).length} Markdown files).`,
    )
  }
}
