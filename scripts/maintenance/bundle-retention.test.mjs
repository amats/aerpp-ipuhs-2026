import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  acquireBundleLock,
  archiveBundles,
  inspectBundles,
  main,
} from "./bundle-retention.mjs"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "aerpp-retention-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const output = join(root, "generated/test")
  const names = [1, 2, 3, 4].map((n) => `test-178991748898${n}-0123456789ab`)
  for (const name of names) {
    const path = join(output, "bundles", name)
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, "release.json"),
      JSON.stringify({ releaseId: name, environment: "test" }),
    )
    writeFileSync(join(path, "release-id.txt"), `${name}\n`)
    writeFileSync(join(path, "SHA256SUMS"), "synthetic manifest\n")
    writeFileSync(join(path, "images.tar"), Buffer.alloc(1024, 42))
  }
  const point = (name) =>
    writeFileSync(
      join(output, "web-bundle.json"),
      JSON.stringify({
        releaseId: name,
        destination: join(output, "bundles", name),
      }),
    )
  point(names[3])
  return {
    root,
    output,
    names,
    point,
    archive: join(output, "bundle-archives"),
  }
}

test("the command archives generated bundles beside their environment and honors private pins", (t) => {
  const { root, output, names, archive } = fixture(t)
  t.mock.method(console, "log", () => {})
  const retention = join(root, "private/retention")
  mkdirSync(retention, { recursive: true })
  const policy = JSON.stringify({ releaseIds: [names[0]] })
  writeFileSync(join(retention, "test.json"), policy)

  main(["test", "--archive"], root)

  assert.equal(existsSync(join(archive, `${names[1]}.tar.gz`)), true)
  assert.equal(existsSync(join(output, "bundles", names[1])), false)
  assert.equal(existsSync(join(output, "bundles", names[0])), true)
  assert.equal(existsSync(join(root, "private/archives")), false)
  assert.equal(readFileSync(join(retention, "test.json"), "utf8"), policy)
})

test("a dry run works without private inputs and creates no archives", (t) => {
  const { root, archive } = fixture(t)
  t.mock.method(console, "log", () => {})
  main(["test"], root)
  assert.equal(existsSync(join(root, "private")), false)
  assert.equal(existsSync(archive), false)
})

test("the command rejects symlinked retention inputs before archiving", (t) => {
  const { root, archive } = fixture(t)
  mkdirSync(join(root, "private"))
  for (const target of [root, join(root, "missing")]) {
    const retention = join(root, "private/retention")
    symlinkSync(target, retention)
    assert.throws(() => main(["test", "--archive"], root), /real directory/)
    assert.equal(existsSync(archive), false)
    rmSync(retention)
  }
})

test("dry-run retains the latest two, current export and explicit recovery pins", (t) => {
  const { output, names, point } = fixture(t)
  assert.equal(
    inspectBundles(output).filter(
      (entry) => entry.reason === "archive candidate",
    ).length,
    2,
  )
  point(names[0])
  assert.equal(
    inspectBundles(output, 2, [names[1]]).filter(
      (entry) => entry.reason === "archive candidate",
    ).length,
    0,
  )
  assert.equal(existsSync(join(output, "bundles", names[0])), true)
})

test("invalid pointers, pins, symlinks and incomplete exports fail closed", (t) => {
  const { output, names, point, root } = fixture(t)
  assert.throws(() => inspectBundles(output, 1))
  point("missing")
  assert.throws(() => inspectBundles(output))
  point(names[3])
  assert.throws(() => inspectBundles(output, 2, ["missing"]))
  symlinkSync(root, join(output, "bundles", names[0], "outside"))
  assert.throws(() => inspectBundles(output), /Symlinks/)
  rmSync(join(output, "bundles", names[0], "outside"))
  rmSync(join(output, "bundles", names[0], "images.tar"))
  assert.throws(() => inspectBundles(output))
})

test("archive preserves complete bytes and can restore a generation", (t) => {
  const { output, archive, names, root } = fixture(t)
  const original = readFileSync(join(output, "bundles", names[0], "images.tar"))
  const result = archiveBundles(output, archive)
  assert.equal(result.length, 2)
  assert.equal(existsSync(join(output, "bundles", names[0])), false)
  assert.equal(existsSync(join(output, "bundles", names[3])), true)
  const restored = join(root, "restored")
  mkdirSync(restored)
  assert.equal(
    spawnSync("tar", [
      "-xzf",
      join(archive, `${names[0]}.tar.gz`),
      "-C",
      restored,
    ]).status,
    0,
  )
  assert.deepEqual(
    readFileSync(join(restored, names[0], "images.tar")),
    original,
  )
  assert.equal(
    readFileSync(join(restored, names[0], "release-id.txt"), "utf8"),
    `${names[0]}\n`,
  )
})

test("an existing archive or another bundle operation cannot remove a source", (t) => {
  const { output, archive, names } = fixture(t)
  const unlock = acquireBundleLock(output)
  assert.throws(() => archiveBundles(output, archive))
  unlock()
  mkdirSync(archive)
  writeFileSync(join(archive, `${names[1]}.tar.gz`), "retained archive")
  assert.throws(() => archiveBundles(output, archive), /already exists/)
  assert.equal(existsSync(join(output, "bundles", names[1])), true)
  assert.equal(
    readFileSync(join(archive, `${names[1]}.tar.gz`), "utf8"),
    "retained archive",
  )
})

test("tar failure leaves the expanded source and releases the lock", (t) => {
  const { output, archive, names } = fixture(t)
  const oldPath = process.env.PATH
  process.env.PATH = "/nonexistent"
  try {
    assert.throws(() => archiveBundles(output, archive), /source retained/)
    assert.equal(existsSync(join(output, "bundles", names[0])), true)
    assert.equal(existsSync(join(output, ".bundle-operation.lock")), false)
  } finally {
    process.env.PATH = oldPath
  }
})
