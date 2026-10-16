import { existsSync, lstatSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { REQUIRED_ASSETS } from "../src/lib/research-assets.mjs"

export { REQUIRED_ASSETS }

export function assertResearchAssets(directory) {
  for (const name of REQUIRED_ASSETS) {
    const file = resolve(directory, name)
    if (
      existsSync(file) !== true ||
      lstatSync(file).isFile() !== true ||
      lstatSync(file).isSymbolicLink() === true
    )
      throw new Error(`Missing regular asset file: ${name}`)
    if (readFileSync(file).length === 0)
      throw new Error(`Empty asset file: ${name}`)
  }
}
