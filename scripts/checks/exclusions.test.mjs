import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"

const privatePaths = [
  "apps/web/assets/consent.mdx",
  "apps/web/assets/consent.pdf",
  "apps/web/assets/notes.txt",
  ".env",
  "config/test/config.json",
  "config/future-environment/config.json",
  "config/test/secret.json",
  "config/production/config.json",
  "config/production/secret.json",
  "config/test/console-settings.json",
  "generated/test/auto.json",
  "generated/test/compose.json",
  "generated/production/compose.json",
  "generated/production/admin.json",
  "generated/test/support/runtime.json",
  "distribution/test/test-release.zip",
  "distribution/test/test-release.zip.sha256",
  "distribution/production/production-release.zip",
  "distribution/production/production-release.zip.sha256",
  "private/tools/firestore/cloud-firestore-emulator.jar",
  "apps/web/.env.example",
  "apps/admin/.env.example",
  "apps/support/.env.example",
  "packages/config/.env.example",
  "apps/admin/.env.local.example",
  "apps/web/.env.local",
  "apps/admin/.env.local",
  "apps/support/.env.local",
  "apps/support/.secret.local",
  "apps/web/assets-public/consent.docx",
  "apps/web/assets-public/withdrawal.doc",
  "apps/web/assets-public/consent.odt",
  "infra/secrets/gcp-credentials.json",
  "infra/gcp-local.json",
  "infra/logs/output.json",
  "infra/terraform/.terraform/providers/provider",
  "infra/terraform/terraform.tfstate",
  "infra/terraform/terraform.tfstate.backup",
  "infra/terraform/test.tfplan",
  "infra/terraform/test.tfvars",
  "infra/terraform/test.tfvars.json",
  "node_modules/package/index.js",
  "apps/admin/node_modules/package/index.js",
  "apps/web/node_modules/package/index.js",
  "apps/support/node_modules/package/index.js",
  "packages/config/node_modules/package/index.js",
  "apps/web/.next/cache/data",
  "apps/admin/.next/cache/data",
  "apps/support/dist/server.mjs",
  ".deploy/artifact.json",
  "packages/config/dist/web.mjs",
  "apps/web/next-env.d.ts",
  "apps/admin/next-env.d.ts",
  "apps/web/tsconfig.tsbuildinfo",
  "apps/web/generated/licenses/THIRD_PARTY_NOTICES.md",
  "apps/admin/generated/licenses/THIRD_PARTY_NOTICES.md",
  "apps/web/generated/pdf/manifest.json",
  "apps/admin/generated/report.json",
  "apps/support/generated/runtime.json",
  "packages/config/generated/runtime.json",
  "packages/contracts/generated/schema.json",
  "packages/firestore/generated/export.json",
  "apps/admin/src/private/credential.json",
  "packages/firestore/src/private/credential.json",
  "apps/web/src/secrets/credential.json",
  "apps/admin/src/gcp-local.json",
  "apps/admin/src/client_secret_download.json",
  "packages/config/src/client_secret_download.json",
  "apps/support/logs/output.json",
  "apps/web/.playwright/output.json",
  "apps/admin/test-results/result.json",
  "apps/support/test-results/result.json",
  "apps/support/playwright-report/index.html",
  "apps/web/coverage/report.json",
]
const publicPaths = [
  "apps/web/assets-public/consent.mdx",
  "apps/web/assets-public/consent.pdf",
  "config/example/config.json",
  "packages/config/templates/support-cloud-template.json",
  "config/common/llm/lms-medgemma.json",
  "config/common/survey/survey-initial.json",
  "config/example/secret.json",
  ".env.example",
  "packages/config/templates/cloud-template.json",
  "infra/terraform/.terraform.lock.hcl",
  "apps/support/src/server.ts",
  "apps/web/test-support/server-only.ts",
  "apps/admin/test-support/read-archive.ts",
  "apps/web/.yarn/patches/example.patch",
  "pnpm-lock.yaml",
]

test("Git ignores private inputs and nested outputs while retaining public examples", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aerpp-exclusions-"))
  try {
    for (const relative of [".gitignore"]) {
      const destination = path.join(directory, relative)
      mkdirSync(path.dirname(destination), { recursive: true })
      copyFileSync(new URL(`../../${relative}`, import.meta.url), destination)
    }
    assert.equal(spawnSync("git", ["init", "--quiet", directory]).status, 0)
    for (const relative of [...privatePaths, ...publicPaths]) {
      const destination = path.join(directory, relative)
      mkdirSync(path.dirname(destination), { recursive: true })
      writeFileSync(destination, "synthetic fixture\n")
      const result = spawnSync(
        "git",
        [
          "-c",
          "core.excludesFile=/dev/null",
          "check-ignore",
          "--quiet",
          "--no-index",
          relative,
        ],
        { cwd: directory },
      )
      assert.equal(
        result.status,
        privatePaths.includes(relative) ? 0 : 1,
        relative,
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
