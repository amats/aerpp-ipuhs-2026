import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  createEnvironmentSecretProvider,
  createFileSecretProvider,
  resolveSecretReferences,
} from "./secrets.mjs"

test("file and injected-environment providers preserve exact secret values and redact failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-secrets-"))
  const value = "  quotes'\"` $TOKEN \\n\nactual newline  "
  try {
    const file = join(directory, "secrets.json")
    writeFileSync(file, JSON.stringify({ TEST_SECRET: value }))
    for (const provider of [
      createFileSecretProvider(file),
      createEnvironmentSecretProvider({ TEST_SECRET: value }),
    ]) {
      assert.deepEqual(
        resolveSecretReferences(
          { API_KEY: { secret: "TEST_SECRET" } },
          provider,
        ),
        { API_KEY: value },
      )
      assert.throws(
        () => provider.getSecret("MISSING_SECRET"),
        /MISSING_SECRET/,
      )
    }
    writeFileSync(file, `invalid ${value}`)
    assert.throws(() => createFileSecretProvider(file), {
      message: "Cannot read the private secret store",
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("file secrets preserve JSON objects without admitting them to string settings", () => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-json-secrets-"))
  try {
    const file = join(directory, "secret.json")
    const credential = {
      private_key: "synthetic\nkey\n",
      client_email: "logging@example.invalid",
    }
    writeFileSync(
      file,
      JSON.stringify({
        CREDENTIAL: credential,
        TEXT: "synthetic-secret",
        ARRAY: [],
        NULL: null,
      }),
    )
    const provider = createFileSecretProvider(file)
    assert.deepEqual(provider.getJsonSecret("CREDENTIAL"), credential)
    assert.throws(() => provider.getSecret("CREDENTIAL"), /Missing required/)
    for (const key of ["TEXT", "ARRAY", "NULL", "MISSING"])
      assert.throws(() => provider.getJsonSecret(key), {
        message: `Secret ${key} must be a JSON object`,
      })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
