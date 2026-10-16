import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDocumentSet, DOCUMENT_FILES } from "@aerpp/config/document-set"
import { run } from "../shared/delivery.mjs"

export function readImageDocumentSet(imageId, execute = run) {
  if (/^sha256:[a-f0-9]{64}$/.test(imageId) !== true)
    throw new Error("Immutable Web image required")
  const directory = mkdtempSync(join(tmpdir(), "aerpp-documents-"))
  let container
  try {
    container = execute("docker", ["create", "--pull", "never", imageId])
    if (/^[a-f0-9]{12,64}$/.test(container) !== true)
      throw new Error("Invalid extraction container")
    execute("docker", [
      "cp",
      `${container}:/app/config/common/documents/version.json`,
      join(directory, "version.json"),
    ])
    const { version } = JSON.parse(
      readFileSync(join(directory, "version.json"), "utf8"),
    )
    const files = Object.fromEntries(
      DOCUMENT_FILES.map((name) => {
        const file = join(directory, name)
        execute("docker", [
          "cp",
          `${container}:/app/apps/web/assets/${name}`,
          file,
        ])
        return [name, readFileSync(file)]
      }),
    )
    return { ...createDocumentSet(version, files), files }
  } finally {
    try {
      if (container) execute("docker", ["rm", container])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
