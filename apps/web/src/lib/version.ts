import "server-only"

import { readFileSync } from "node:fs"
import path from "node:path"

const packageJsonPath = path.join(process.cwd(), "package.json")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
  version: string
}
export const APP_VERSION = packageJson.version
