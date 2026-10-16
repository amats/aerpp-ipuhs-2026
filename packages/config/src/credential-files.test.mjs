import assert from "node:assert/strict"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  materializeServiceCredential,
  parseServiceCredential,
} from "./credential-files.mjs"

test("logging key projection is private, stable and bound to the selected project", () => {
  const root = mkdtempSync(join(tmpdir(), "aerpp-credential-"))
  try {
    const directory = join(root, "config", "test")
    mkdirSync(directory, { recursive: true })
    const value = {
      type: "service_account",
      project_id: "synthetic-test",
      client_email: "logging@synthetic-test.iam.gserviceaccount.com",
      private_key: "synthetic-private-key",
    }
    assert.deepEqual(
      parseServiceCredential(value, "synthetic-test", "logging"),
      value,
    )
    for (const invalid of [
      JSON.stringify(value),
      null,
      [],
      "synthetic-private-key",
      { ...value, private_key: "" },
    ])
      assert.throws(
        () => parseServiceCredential(invalid, "synthetic-test", "logging"),
        (error) => !error.message.includes("synthetic-private-key"),
      )
    const file = materializeServiceCredential(
      directory,
      { project: "synthetic-test" },
      "logging",
      value,
    )
    assert.equal(file, join(root, "generated/test/credentials/logging.json"))
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(
      JSON.parse(readFileSync(file)).private_key,
      "synthetic-private-key",
    )
    chmodSync(file, 0o644)
    const before = statSync(file).mtimeMs
    materializeServiceCredential(
      directory,
      { project: "synthetic-test" },
      "logging",
      value,
    )
    assert.equal(statSync(file).mtimeMs, before)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    for (const invalid of [value, "synthetic-private-key", "null"])
      assert.throws(
        () =>
          parseServiceCredential(invalid, "synthetic-production", "logging"),
        (error) => !error.message.includes("synthetic-private-key"),
      )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
