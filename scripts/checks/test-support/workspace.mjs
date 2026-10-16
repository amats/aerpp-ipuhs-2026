import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export function createWorkspace(t, prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file, value) => {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value),
    )
  }
  return { root, write }
}
