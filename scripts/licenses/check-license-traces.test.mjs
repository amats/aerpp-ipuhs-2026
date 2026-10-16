import assert from "node:assert/strict"
import test from "node:test"
import { assertLicenseTrace } from "./check-license-traces.mjs"

const applicationNotices = {
  web: [
    "LICENSE",
    "NOTICE",
    "dependencies.json",
    "APACHE-2.0.txt",
    "BSD-2-CLAUSE.txt",
    "HAI-DEF-TERMS.txt",
    "HAI-DEF-PROHIBITED-USE.txt",
    "OFL-1.1.txt",
  ],
  admin: [
    "LICENSE",
    "NOTICE",
    "dependencies.json",
    "APACHE-2.0.txt",
    "OFL-1.1.txt",
  ],
}
const required = applicationNotices.web.map(
  (file) => `apps/web/generated/licenses/${file}`,
)

test("accepts the canonical notices and public model configuration", () => {
  assert.doesNotThrow(() =>
    assertLicenseTrace(
      [
        ...required,
        "config/common/llm/lms-medgemma.json",
        "config/common/survey/survey-initial.json",
      ],
      "web",
    ),
  )
})
for (const file of [
  "private/research/document.txt",
  "generated/test/credentials/logging.json",
  "generated/test/auto.json",
  "config/future-profile/secret.json",
  ".env",
  "apps/web/.env.local",
  "apps/web/src/example.test.ts",
  "apps/admin/test-support/helper.ts",
  ".git/config",
]) {
  test(`rejects unintended trace input ${file}`, () => {
    assert.throws(
      () => assertLicenseTrace([...required, file], "web"),
      /private or test files/,
    )
  })
}
test("fails if a standalone artifact would omit the font notice", () => {
  assert.throws(
    () => assertLicenseTrace(required.slice(0, -1), "web"),
    /missing apps\/web\/generated\/licenses\/OFL/,
  )
})

test("Admin distributions retain both the PDF font and existing Apache notices", () => {
  const files = [
    "LICENSE",
    "NOTICE",
    "dependencies.json",
    "APACHE-2.0.txt",
    "OFL-1.1.txt",
  ].map((name) => `apps/admin/generated/licenses/${name}`)
  assert.doesNotThrow(() => assertLicenseTrace(files, "admin"))
  assert.throws(
    () => assertLicenseTrace(files.slice(0, -1), "admin"),
    /missing.*OFL/,
  )
})

for (const application of ["web", "admin"]) {
  const files = applicationNotices[application].map(
    (name) => `apps/${application}/generated/licenses/${name}`,
  )
  test(`${application} traces retain every applicable notice`, () => {
    for (const missing of files)
      assert.throws(
        () =>
          assertLicenseTrace(
            files.filter((file) => file !== missing),
            application,
          ),
        /license trace is missing/,
        `Accepted omitted notice: ${missing}`,
      )
  })
  for (const file of [
    `apps/${application}/.env-production`,
    `apps/${application}/src/.envsecret`,
    `apps/${application}/.secret-runtime.json`,
    `apps/${application}/src/gcp-runtime.json`,
    `apps/${application}/src/client_secret_download.json`,
    `apps/${application}/src/runtime-service-account.json`,
    `apps/${application}/src/runtime-adminsdk.json`,
    `apps/${application}/src/runtime.pem`,
    `apps/${application}/src/runtime.key`,
    `apps/${application}/src/runtime.p12`,
    `apps/${application}/src/runtime.pfx`,
    "packages/config/src/.env.local",
    `apps/${application}/private/credentials.json`,
    "packages/config/secrets/credential.json",
    `apps/${application}/.git/config`,
    `apps/${application}/tests/helper.ts`,
    `apps/${application}/e2e/flow.spec.ts`,
    `apps/${application}/generated/settings.json`,
    "packages/config/generated/runtime.json",
    `apps/${application}/generated/licenses/NOTICE.tmp`,
    `apps/${application === "web" ? "admin" : "web"}/generated/licenses/LICENSE`,
  ]) {
    test(`${application} rejects non-runtime input ${file}`, () => {
      assert.throws(
        () => assertLicenseTrace([...files, file], application),
        /private or test files/,
      )
    })
  }
}
