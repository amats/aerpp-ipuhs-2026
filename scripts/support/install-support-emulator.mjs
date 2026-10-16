import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const FIRESTORE_EMULATOR_VERSION = "1.22.0"
export const FIRESTORE_EMULATOR_SHA256 =
  "9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c"
export function assertEmulatorJar(file) {
  if (
    createHash("sha256").update(readFileSync(file)).digest("hex") !==
    FIRESTORE_EMULATOR_SHA256
  )
    throw new Error("Standalone Firestore emulator checksum mismatch")
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const directory = fileURLToPath(
      new URL("../../private/tools/firestore/", import.meta.url),
    )
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const name = `cloud-firestore-emulator-v${FIRESTORE_EMULATOR_VERSION}.jar`
    const file = resolve(directory, name)
    if (!existsSync(file)) {
      const response = await fetch(
        `https://storage.googleapis.com/firebase-preview-drop/emulator/${name}`,
        { signal: AbortSignal.timeout(180_000) },
      )
      if (response.ok !== true)
        throw new Error("Standalone Firestore emulator download failed")
      const bytes = Buffer.from(await response.arrayBuffer())
      const temporaryDirectory = mkdtempSync(resolve(directory, ".install-"))
      try {
        const temporary = resolve(temporaryDirectory, name)
        writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" })
        assertEmulatorJar(temporary)
        renameSync(temporary, file)
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true })
      }
    }
    assertEmulatorJar(file)
    console.log("Pinned standalone Firestore emulator checksum verified")
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Emulator installation failed",
    )
    process.exitCode = 1
  }
}
