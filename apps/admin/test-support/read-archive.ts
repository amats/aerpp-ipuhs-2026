import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Use an independent ZIP implementation to verify headers, filenames and CRCs.
export function readArchive(buffer: Uint8Array): Record<string, string> {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-export-test-"))
  try {
    const file = join(directory, "export.zip")
    writeFileSync(file, buffer)
    execFileSync("unzip", ["-t", file])
    const names = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
      .trim()
      .split("\n")
    return Object.fromEntries(
      names.map((name) => [
        name,
        execFileSync("unzip", ["-p", file, name], {
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        }),
      ]),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
