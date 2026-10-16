import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

function exportPaths(value) {
  return typeof value === "string"
    ? [value]
    : Object.values(value).flatMap(exportPaths)
}

for (const name of ["config", "contracts", "firestore"]) {
  test(`${name} packaging includes exported sources and excludes private, generated and test sentinels`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "aerpp-package-content-"))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const source = JSON.parse(
      readFileSync(
        new URL(`../../packages/${name}/package.json`, import.meta.url),
        "utf8",
      ),
    )
    const manifest = Object.fromEntries(
      ["name", "version", "private", "files", "exports"].map((key) => [
        key,
        source[key],
      ]),
    )
    const write = (file, contents = "synthetic\n") => {
      mkdirSync(dirname(join(directory, file)), { recursive: true })
      writeFileSync(join(directory, file), contents)
    }
    write("package.json", JSON.stringify(manifest))
    const exported = exportPaths(source.exports).map((file) => file.slice(2))
    for (const file of exported) write(file)
    const excluded = [
      "src/local.test.ts",
      "src/local.test.mjs",
      "src/local.test.json",
      "src/.env.local.json",
      "src/.secret-local.json",
      "src/gcp-local.json",
      "src/credential-service-account.json",
      "src/local-adminsdk.json",
      "src/client_secret_download.json",
      ...[
        "private",
        "generated",
        "secrets",
        "test-support",
        "tests",
        "e2e",
      ].flatMap((directory) =>
        ["ts", "mjs", "json"].map(
          (extension) => `src/${directory}/local.${extension}`,
        ),
      ),
      "templates/private/config.json",
      "templates/client_secret_download.json",
    ]
    for (const file of excluded) write(file)
    const packed = JSON.parse(
      execFileSync(
        "pnpm",
        ["--dir", directory, "pack", "--dry-run", "--json"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    )
    const included = new Set(packed.files.map((file) => file.path))
    for (const file of exported)
      assert.ok(included.has(file), `Missing export: ${file}`)
    for (const file of excluded)
      assert.ok(!included.has(file), `Unexpected package input: ${file}`)
  })
}
