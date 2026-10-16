import assert from "node:assert/strict"
import test from "node:test"
import { findDocumentationViolations } from "./check-docs.mjs"
import { findDocumentationFiles } from "./documentation-files.mjs"
import { createWorkspace } from "./test-support/workspace.mjs"

function workspace(t) {
  return createWorkspace(t, "aerpp-docs-")
}

test("checks workspace/app/package guides and skill references without Git", (t) => {
  const { root, write } = workspace(t)
  for (const file of [
    "README.md",
    "config/example/SETUP.md",
    "docs/setup.md",
    "scripts/README.md",
    "apps/web/docs/guide.md",
    "apps/support/README.md",
    "packages/config/README.md",
    "infra/README.md",
    "infra/terraform/README.md",
    "patches/README.md",
    "skills/repo-test/references/details.md",
  ])
    write(file, "# Guide\n")
  write("config/test/SETUP.md", "[Private](absent.md)")
  write("private/secret.md", "[Missing](absent.md)")
  write("apps/web/src/assets/private.md", "[Missing](absent.md)")
  write("apps/web/node_modules/library/README.md", "[Missing](absent.md)")
  write("apps/web/generated/README.md", "[Missing](absent.md)")
  write("scripts/node_modules/library/README.md", "[Missing](absent.md)")
  write(
    "infra/terraform/.terraform/modules/example/README.md",
    "[Missing](absent.md)",
  )
  write("infra/generated/README.md", "[Missing](absent.md)")
  write("infra/private/README.md", "[Missing](absent.md)")
  assert.equal(findDocumentationFiles(root).length, 11)
  assert.deepEqual(findDocumentationViolations(root), [])
})

test("detects broken links in infrastructure and patch guides", (t) => {
  const { root, write } = workspace(t)
  const files = ["infra/terraform/README.md", "patches/README.md"]
  for (const file of files) write(file, "[Missing](absent.md)\n")
  assert.deepEqual(
    findDocumentationViolations(root),
    files.map((file) => `${file}: missing link target (absent.md)`),
  )
})

test("detects a removed or moved document from another app", (t) => {
  const { root, write } = workspace(t)
  write("apps/admin/README.md", "[Old guide](../web/docs/old.md)\n")
  assert.deepEqual(findDocumentationViolations(root), [
    "apps/admin/README.md: missing link target (../web/docs/old.md)",
  ])
})
