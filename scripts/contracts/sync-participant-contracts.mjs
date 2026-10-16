import { readFileSync, writeFileSync } from "node:fs"

const requestFile = new URL(
  "../../packages/contracts/src/request-schemas.ts",
  import.meta.url,
)
const contractFile = new URL(
  "../../packages/contracts/src/participant-api.ts",
  import.meta.url,
)
const begin = "// BEGIN GENERATED REQUEST SCHEMAS (pnpm run contracts:sync)"
const end = "// END GENERATED REQUEST SCHEMAS"
const source = readFileSync(requestFile, "utf8")
const contract = readFileSync(contractFile, "utf8")
const importLine = 'import { z } from "zod"\n'
if (!source.startsWith(importLine)) {
  throw new Error("Update the contract generator for the new request imports")
}
const schemas = source.slice(importLine.length).trim()
// A standalone contract can depend on Zod only. Fail if new runtime imports
// would otherwise be copied into the client artifact.
if (/^\s*(?:import\b|export\s+.*\bfrom\b)/m.test(schemas)) {
  throw new Error("Request schemas must remain standalone with only Zod")
}
const start = contract.indexOf(begin)
const finish = contract.indexOf(end, start)
if (start < 0 || finish < 0)
  throw new Error("Contract generation markers missing")
const updated = `${contract.slice(0, start)}${begin}\n${schemas}\n${end}${contract.slice(finish + end.length)}`
if (process.argv.includes("--check")) {
  if (updated !== contract) {
    process.stderr.write(
      "participant-api.ts is out of sync. Run pnpm run contracts:sync.\n",
    )
    process.exitCode = 1
  }
} else if (updated !== contract) {
  writeFileSync(contractFile, updated)
}
