import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { adminSecrets } from "../test-support/credentials.mjs"
import { readAutoSettings, writeAutoSettings } from "./auto-settings.mjs"
import { prepareApplicationRuntime } from "./workspace.mjs"

const target = { name: "test", project: "synthetic-test" }
test("automatic settings preserve manual and secret bytes and reject another project", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-auto-"))
  const dir = join(fixture, "config", "test")
  mkdirSync(dir, { recursive: true })
  try {
    const secret =
      " " +
      JSON.stringify({
        ...adminSecrets(target.project),
        NEXTAUTH_SECRET: "literal $VALUE\nvalue",
      }) +
      " \n"
    const config = JSON.stringify({
      version: 1,
      support: {
        access: {
          notBefore: "1970-01-01T00:00:00Z",
          expiresAt: "2099-01-01T00:00:00Z",
          backendStopsAt: "2099-12-31T00:00:00Z",
          revoked: false,
        },
      },
      shared: { participantApiServerId: "synthetic-server" },
      admin: {
        nextAuthSecret: { secret: "NEXTAUTH_SECRET" },
      },
    })
    writeFileSync(join(dir, "secret.json"), secret)
    writeFileSync(join(dir, "config.json"), config)
    writeAutoSettings(dir, target, { adminUrl: "https://admin.example.com" })
    const values = prepareApplicationRuntime("test", dir, {
      projects: { test: target.project },
      apps: "admin",
    }).values.admin
    assert.equal(
      values.ADMIN_GOOGLE_OAUTH_CLIENT_ID,
      "synthetic-admin.apps.googleusercontent.com",
    )
    assert.equal(values.NEXTAUTH_SECRET, "literal $VALUE\nvalue")
    assert.equal(values.NEXTAUTH_URL, "https://admin.example.com")
    assert.equal(values.SUPPORT_RECEPTION_EXPIRES_AT, "2099-01-01T00:00:00Z")
    assert.equal(readFileSync(join(dir, "secret.json"), "utf8"), secret)
    assert.equal(readFileSync(join(dir, "config.json"), "utf8"), config)
    assert.match(readAutoSettings(dir, target)._comment, /DO NOT EDIT/)
    assert.equal(existsSync(join(dir, "auto.json")), false)
    writeFileSync(join(dir, "auto.json"), "{}")
    assert.throws(() => readAutoSettings(dir, target), /automatic metadata/)
    assert.throws(
      () => writeAutoSettings(dir, target, {}),
      /automatic metadata/,
    )
    rmSync(join(dir, "auto.json"))
    assert.throws(() =>
      readAutoSettings(dir, { ...target, project: "other-project" }),
    )
    writeFileSync(
      join(fixture, "generated/test/auto.json"),
      JSON.stringify({
        version: 1,
        environment: "test",
        project: target.project,
        ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "wrong",
      }),
    )
    assert.throws(() => readAutoSettings(dir, target), /Unexpected/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
