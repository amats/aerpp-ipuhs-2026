import assert from "node:assert/strict"
import { test } from "node:test"
import { privateConfigFindings } from "./check-private-config.mjs"

test("detects project identifiers in URLs and paths without reporting their values", () => {
  const ids = ["synthetic-private-project"]
  for (const [file, content] of [
    ["docs/setup.md", "https://synthetic-private-project.firebaseapp.com"],
    ["infra/synthetic-private-project.json", "{}"],
    ["private/environments/test/admin.env", ""],
    ["config/production/gcp.json", ""],
    ["apps/web/.env.local", ""],
    ["apps/web/.env.example", ""],
    ["apps/web/assets/consent.mdx", "synthetic document"],
    ["packages/config/.env.example", ""],
    ["apps/admin/src/client_secret_download.json", "{}"],
    ["packages/config/src/gcp-local.json", "{}"],
    ["packages/config/src/credential-service-account.json", "{}"],
    ["apps/support/src/.secret-local.json", "{}"],
    ["distribution/test/test-release.zip", "synthetic archive"],
    [
      "distribution/production/production-release.zip.sha256",
      "synthetic checksum",
    ],
    ["key.json", JSON.stringify({ type: "service_account" })],
  ]) {
    const findings = privateConfigFindings(file, content, ids)
    assert.ok(findings.length)
    assert.ok(!findings.join().includes(ids[0]))
  }
  assert.deepEqual(privateConfigFindings(".env.example", "dummy", ids), [])
  assert.deepEqual(
    privateConfigFindings(
      "apps/web/assets-public/consent.mdx",
      "synthetic",
      [],
    ),
    [],
  )
})

test("detects embedded Firebase API keys even without a private alias map", () => {
  assert.deepEqual(
    privateConfigFindings("src/config.ts", `AIza${"A".repeat(35)}`, []),
    ["embedded Google API key"],
  )
})

test("rejects force-added generated artifacts consistently across apps and packages", () => {
  for (const owner of [
    "apps/web",
    "apps/admin",
    "apps/support",
    "packages/config",
    "packages/contracts",
    "packages/firestore",
  ]) {
    for (const suffix of [
      "generated/report.json",
      "dist/runtime.mjs",
      ".next/server/app.js",
      "coverage/report.json",
      "test-results/report.json",
      "tsconfig.tsbuildinfo",
    ]) {
      assert.ok(
        privateConfigFindings(`${owner}/${suffix}`, "synthetic", []).includes(
          "generated or local artifact path",
        ),
      )
    }
    assert.deepEqual(
      privateConfigFindings(`${owner}/src/contract.ts`, "synthetic", []),
      [],
    )
  }
})

for (const file of [
  "config/example/config.json",
  "config/common/llm/lms-medgemma.json",
  "config/common/survey/survey-initial.json",
])
  test(`public configuration exception preserves identifier and credential checks: ${file}`, () => {
    assert.deepEqual(
      privateConfigFindings(file, "local-example-public-value", []),
      [],
    )
    assert.ok(
      privateConfigFindings(
        "config/new-profile/config.json",
        "{}",
        [],
      ).includes("private configuration path"),
    )
    assert.ok(
      privateConfigFindings(file, "private-project", [
        "private-project",
      ]).includes("private project identifier"),
    )
    assert.ok(
      privateConfigFindings(
        file,
        JSON.stringify({ type: "service_account" }),
        [],
      ).includes("credential material"),
    )
    assert.ok(
      privateConfigFindings(file, `AIza${"A".repeat(35)}`, []).includes(
        "embedded Google API key",
      ),
    )
  })
