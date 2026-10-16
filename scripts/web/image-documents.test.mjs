import assert from "node:assert/strict"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import test from "node:test"
import { DOCUMENT_FILES } from "@aerpp/config/document-set"
import { readImageDocumentSet } from "./image-documents.mjs"

test("extracts exact document bytes from the immutable image and removes its extraction container", () => {
  const calls = []
  const execute = (command, args) => {
    calls.push([command, ...args])
    if (args[0] === "create") return "a".repeat(64)
    if (args[0] === "cp")
      writeFileSync(
        args[2],
        args[1].endsWith("version.json")
          ? '{"version":"1.0"}'
          : `synthetic ${args[1]}`,
      )
  }
  const artifact = readImageDocumentSet(`sha256:${"b".repeat(64)}`, execute)
  assert.equal(artifact.reference.version, "1.0")
  assert.equal(artifact.manifest.files.length, DOCUMENT_FILES.length)
  assert.deepEqual(calls.at(-1), ["docker", "rm", "a".repeat(64)])
  assert.throws(() => readImageDocumentSet("mutable:tag", execute), /Immutable/)
})
test("cleans extraction resources after a missing image original", () => {
  const calls = []
  assert.throws(
    () =>
      readImageDocumentSet(`sha256:${"b".repeat(64)}`, (command, args) => {
        calls.push([command, ...args])
        if (args[0] === "create") return "a".repeat(64)
        if (args[0] === "cp") throw new Error("missing original")
      }),
    /missing original/,
  )
  assert.deepEqual(calls.at(-1), ["docker", "rm", "a".repeat(64)])
})
test("removes extracted documents even when container removal fails", (t) => {
  for (const extractionFails of [false, true]) {
    let directory
    t.after(() => {
      if (directory) rmSync(directory, { recursive: true, force: true })
    })
    assert.throws(
      () =>
        readImageDocumentSet(`sha256:${"b".repeat(64)}`, (command, args) => {
          assert.equal(command, "docker")
          if (args[0] === "create") return "a".repeat(64)
          if (args[0] === "cp") {
            directory = dirname(args[2])
            writeFileSync(
              args[2],
              args[1].endsWith("version.json")
                ? '{"version":"1.0"}'
                : "synthetic original",
            )
            if (extractionFails === true)
              throw new Error("synthetic extraction failure")
          }
          if (args[0] === "rm")
            throw new Error("synthetic container removal failure")
        }),
      /synthetic container removal failure/,
    )
    assert.equal(existsSync(directory), false)
  }
})
