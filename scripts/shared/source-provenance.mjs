import assert from "node:assert/strict"
import { ROOT } from "@aerpp/config/workspace"
import { run } from "./delivery.mjs"

export function sourceProvenance(record) {
  assert.match(
    record?.sourceRevision ?? "",
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/,
    "Missing source revision",
  )
  assert.match(
    record?.sourceTree ?? "",
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/,
    "Missing source tree",
  )
  assert.equal(
    record.sourceDirty,
    false,
    "Delivery requires committed source without local changes",
  )
  return {
    sourceRevision: record.sourceRevision,
    sourceTree: record.sourceTree,
    sourceDirty: false,
  }
}

export function readSourceState(root = ROOT) {
  return sourceProvenance({
    sourceRevision: run("git", ["rev-parse", "HEAD"], { cwd: root }),
    sourceTree: run("git", ["rev-parse", "HEAD^{tree}"], { cwd: root }),
    sourceDirty:
      run("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: root,
      }) !== "",
  })
}

export function assertMatchingSource(record, expected) {
  assert.deepEqual(
    sourceProvenance(record),
    sourceProvenance(expected),
    "Source changed; rebuild and verify the current revision",
  )
}

export function assertImageSource(record, inspection) {
  const source = sourceProvenance(record)
  assert.match(record.imageId ?? "", /^sha256:[a-f0-9]{64}$/)
  assert.equal(
    inspection.Id,
    record.imageId,
    "Inspected image differs from build evidence",
  )
  assert.equal(
    inspection.Config?.Labels?.["org.opencontainers.image.revision"],
    source.sourceRevision,
    "Image source revision differs from build evidence",
  )
  assert.equal(
    inspection.Config?.Labels?.["io.aerpp.source-tree"],
    source.sourceTree,
    "Image source tree differs from build evidence",
  )
}
