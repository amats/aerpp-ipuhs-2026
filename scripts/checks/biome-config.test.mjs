import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BIOME = path.join(ROOT, "node_modules/@biomejs/biome/bin/biome")
const UNFORMATTED = "export const example = { value: 'synthetic' };\n"

test("inherited formatting changes owned sources while preserving protected inputs", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "aerpp-biome-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file, content) => {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  for (const file of [
    "biome.json",
    "apps/web/biome.json",
    "apps/admin/biome.json",
    "apps/support/biome.json",
  ])
    write(file, readFileSync(path.join(ROOT, file), "utf8"))

  const maintained = [
    "scripts/helper.mjs",
    "apps/web/src/features/example/helper.ts",
    "apps/admin/src/ui/example.tsx",
    "apps/support/src/helper.ts",
    "packages/config/src/helper.mjs",
    "packages/contracts/src/request-schemas.ts",
    "packages/firestore/src/helper.ts",
  ]
  const protectedFiles = [
    "config/test/settings.json",
    "config/common/input.json",
    "generated/settings.json",
    "apps/web/src/lib/external/copied.ts",
    "apps/web/assets/research.json",
    "apps/web/assets-public/research.json",
    "apps/web/.next/generated.js",
    "apps/support/dist/helper.js",
    "apps/support/generated/settings.json",
    "packages/config/private/settings.json",
    "packages/contracts/src/participant-api.ts",
  ]
  for (const file of maintained) write(file, UNFORMATTED)
  for (const file of protectedFiles)
    write(file, file.endsWith(".json") ? '{ "synthetic":true }\n' : UNFORMATTED)
  const originals = protectedFiles.map((file) =>
    readFileSync(path.join(root, file), "utf8"),
  )

  // Exercise the same working directories used by filtered app/package scripts.
  for (const owner of [
    "apps/web",
    "apps/admin",
    "apps/support",
    "packages/config",
    "packages/contracts",
    "packages/firestore",
    ".",
  ]) {
    const result = spawnSync(
      process.execPath,
      [BIOME, "format", "--write", "--vcs-enabled=false"],
      {
        cwd: path.join(root, owner),
        encoding: "utf8",
        timeout: 30_000,
      },
    )
    assert.equal(
      result.status,
      0,
      `${owner}: ${result.stderr}\n${result.stdout}`,
    )
    for (const file of maintained.filter(
      (file) => owner === "." || file.startsWith(`${owner}/`),
    ))
      assert.equal(
        readFileSync(path.join(root, file), "utf8"),
        'export const example = { value: "synthetic" }\n',
        `${owner}: ${file}`,
      )
  }
  for (const [index, file] of protectedFiles.entries())
    assert.equal(
      readFileSync(path.join(root, file), "utf8"),
      originals[index],
      file,
    )
})
