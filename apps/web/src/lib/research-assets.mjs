import { existsSync, lstatSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createDocumentSet, DOCUMENT_FILES } from "@aerpp/config/document-set"

export const REQUIRED_ASSETS = DOCUMENT_FILES

export function researchAssetsDirectory(webDirectory, privateOnly = false) {
  const privateDirectory = resolve(webDirectory, "assets")
  const privateEntry = lstatSync(privateDirectory, { throwIfNoEntry: false })
  // An existing private set is authoritative, even when it is incomplete.
  const directory =
    privateOnly === true || privateEntry !== undefined
      ? privateDirectory
      : resolve(webDirectory, "assets-public")
  if (
    existsSync(directory) !== true ||
    lstatSync(directory).isDirectory() !== true ||
    lstatSync(directory).isSymbolicLink() === true
  )
    throw new Error("Missing regular research asset directory")
  return directory
}

export function bundledResearchAssetsDirectory(webDirectory) {
  // Next.js inlines this build marker so PDFs follow the compiled MDX set.
  const source = process.env.AERPP_WEB_ASSET_SOURCE
  if (source === "assets" || source === "assets-public")
    return resolve(webDirectory, source)
  return researchAssetsDirectory(webDirectory)
}

export function readResearchDocumentSet(
  webDirectory,
  directory = researchAssetsDirectory(webDirectory),
) {
  const { version } = JSON.parse(
    readFileSync(
      resolve(webDirectory, "../../config/common/documents/version.json"),
      "utf8",
    ),
  )
  return createDocumentSet(
    version,
    Object.fromEntries(
      DOCUMENT_FILES.map((name) => [
        name,
        readFileSync(resolve(directory, name)),
      ]),
    ),
  )
}
