import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  assertImageSource,
  assertMatchingSource,
  readSourceState,
  sourceProvenance,
} from "./source-provenance.mjs"

const SOURCE = {
  sourceRevision: "a".repeat(40),
  sourceTree: "b".repeat(40),
  sourceDirty: false,
}
test("source provenance rejects missing, dirty and changed source and image labels", () => {
  for (const sourceDirty of [true, undefined, null, "false", 0, {}, []])
    assert.throws(() => sourceProvenance({ ...SOURCE, sourceDirty }))
  for (const field of ["sourceRevision", "sourceTree"])
    for (const value of [undefined, "", "invalid", "c".repeat(40)])
      assert.throws(() =>
        assertMatchingSource({ ...SOURCE, [field]: value }, SOURCE),
      )
  const record = { ...SOURCE, imageId: `sha256:${"c".repeat(64)}` }
  const inspection = {
    Id: record.imageId,
    Config: {
      Labels: {
        "org.opencontainers.image.revision": SOURCE.sourceRevision,
        "io.aerpp.source-tree": SOURCE.sourceTree,
      },
    },
  }
  assertImageSource(record, inspection)
  assert.throws(() =>
    assertImageSource({ ...SOURCE }, { ...inspection, Id: undefined }),
  )
  for (const label of Object.keys(inspection.Config.Labels)) {
    const changed = structuredClone(inspection)
    delete changed.Config.Labels[label]
    assert.throws(() => assertImageSource(record, changed))
  }
  assert.throws(() =>
    assertImageSource(record, { ...inspection, Id: "different" }),
  )
})

test("source capture requires Git and catches tracked and untracked build inputs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aerpp-source-state-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.throws(() => readSourceState(root))
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" })
  git("init")
  writeFileSync(join(root, "source.txt"), "first")
  git("add", ".")
  git(
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Synthetic source",
  )
  const source = readSourceState(root)
  assert.equal(source.sourceDirty, false)
  writeFileSync(join(root, "untracked.txt"), "new input")
  assert.throws(() => readSourceState(root), /committed source/)
  rmSync(join(root, "untracked.txt"))
  writeFileSync(join(root, "source.txt"), "changed")
  assert.throws(() => readSourceState(root), /committed source/)
  git("add", ".")
  git(
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Changed source",
  )
  assert.throws(() => assertMatchingSource(readSourceState(root), source))
})
