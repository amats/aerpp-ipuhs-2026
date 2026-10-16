import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { stageLicenseNotices } from "./stage-license-notices.mjs"

test("stages only app dependencies, preserves license bytes, detects drift and retains prior output on source failure", () => {
  const root = mkdtempSync(join(tmpdir(), "aerpp-stage-notices-"))
  try {
    mkdirSync(join(root, "docs/licenses"), { recursive: true })
    const text = "Copyright original\r\nFull notice\r\n"
    for (const file of [
      "LICENSE",
      "NOTICE",
      "docs/licenses/APACHE-2.0.txt",
      "docs/licenses/OFL-1.1.txt",
    ])
      writeFileSync(join(root, file), text)
    writeFileSync(
      join(root, "docs/licenses/npm-notices.json"),
      JSON.stringify([
        { name: "admin-dependency", applications: ["admin"] },
        { name: "web-dependency", applications: ["web"] },
      ]),
    )
    stageLicenseNotices(root, "admin")
    const target = join(root, "apps/admin/generated/licenses")
    assert.equal(readFileSync(join(target, "LICENSE"), "utf8"), text)
    assert.deepEqual(
      JSON.parse(readFileSync(join(target, "dependencies.json"))),
      [{ name: "admin-dependency", applications: ["admin"] }],
    )
    stageLicenseNotices(root, "admin", { check: true })
    writeFileSync(join(target, "NOTICE"), "Stale copy")
    assert.throws(
      () => stageLicenseNotices(root, "admin", { check: true }),
      /stale/,
    )
    stageLicenseNotices(root, "admin")
    rmSync(join(root, "LICENSE"))
    assert.throws(() => stageLicenseNotices(root, "admin"), /ENOENT/)
    assert.equal(readFileSync(join(target, "LICENSE"), "utf8"), text)
    assert.throws(() => stageLicenseNotices(root, "../../outside"), /Unknown/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("normalizes package repository URLs without accepting executable or credentialed links", async () => {
  const { repositoryUrl } = await import("./stage-license-notices.mjs")
  assert.equal(
    repositoryUrl("git+https://github.com/example/project.git"),
    "https://github.com/example/project",
  )
  assert.equal(
    repositoryUrl("example/project"),
    "https://github.com/example/project",
  )
  assert.equal(repositoryUrl("javascript:alert(1)"), undefined)
  assert.equal(
    repositoryUrl("https://user:password@example.invalid"),
    undefined,
  )
})
