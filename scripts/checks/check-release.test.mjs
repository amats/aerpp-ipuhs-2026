import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { hostedAdminEnvironment } from "@aerpp/config/admin-deployment"
import { syntheticRuntime } from "../../apps/support/test-support/runtime.ts"
import { runtimeFingerprint } from "../shared/runtime-fingerprint.mjs"
import { buildInputFingerprint } from "../web/build-web-image.mjs"
import { assertReleaseEvidence } from "./check-release.mjs"

const SOURCE = {
  sourceRevision: "a".repeat(40),
  sourceTree: "b".repeat(40),
  sourceDirty: false,
}

function fixture() {
  const project = "synthetic-production"
  const runtime = {
    ...syntheticRuntime(),
    environment: "production",
    projectId: project,
    baseUrl: "https://support.example.invalid",
    mailMode: "gmail",
    gmail: {
      sender: "sender@example.invalid",
      participantEmailPattern: "^recipient@example\\.invalid$",
      clientId: "id",
      clientSecret: "synthetic",
      refreshToken: "synthetic",
    },
  }
  runtime.credentials[0].environment = "production"
  const values = {
    support: { SUPPORT_RUNTIME_JSON: JSON.stringify(runtime) },
    admin: {
      AERPP_ENVIRONMENT: "production",
      GCP_PROJECT_ID: project,
      NEXTAUTH_URL: "https://admin.example.invalid",
      PARTICIPANT_API_SERVER_ID: "synthetic-server",
      SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
      SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
      NEXTAUTH_SECRET: "synthetic-session-secret",
      SESSION_SEAL_PASSWORD: "synthetic-email-seal-password-1234567890",
      IDENTIFIER_HASH_SECRET: "synthetic-identifier-secret",
      ADMIN_GOOGLE_OAUTH_CLIENT_ID: "synthetic.apps.googleusercontent.com",
      ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-oauth-secret",
      ADMIN_ALLOWED_EMAILS: "admin@example.invalid",
    },
    web: {
      NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: "/@example.invalid$/",
      SESSION_SEAL_PASSWORD: "synthetic-email-seal-password-1234567890",
      SUPPORT_API_CREDENTIAL: "synthetic.caller-secret",
      LLM_PRESET_FILE: "synthetic.json",
    },
  }
  const webInputs = {
    assets: [{ name: "welcome.mdx", sha256: "a".repeat(64) }],
    llmPresets: [{ name: "synthetic.json", sha256: "b".repeat(64) }],
  }
  const buildInputSha256 = buildInputFingerprint(
    values.web,
    webInputs.assets,
    webInputs.llmPresets,
  )
  const hosted = hostedAdminEnvironment(
    values.admin,
    values.admin.NEXTAUTH_URL,
    "production",
  )
  const image = `registry.invalid/support@sha256:${"a".repeat(64)}`
  const evidence = {
    support: {
      project,
      image,
      runtimeSha256: createHash("sha256")
        .update(values.support.SUPPORT_RUNTIME_JSON)
        .digest("hex"),
      runtimeVersion: "3",
    },
    cloud: {
      project,
      image,
      runtimeVersion: "3",
      revision: "open-revision",
      checks: Array(12).fill({ status: 200 }),
    },
    admission: {
      cloud: { project, image, revision: "closed-revision" },
      data: {
        project,
        ttlActive: true,
        runtimeSha256: "closed-hash",
        checks: [200, 403, 503].map((status) => ({ status })),
      },
      scheduler: {
        project,
        revision: "closed-revision",
        runtimeSha256: "closed-hash",
        checks: ["withdrawal-cleanup", "mail-health"].map((operation) => ({
          operation,
          schedulerStatus: 200,
          serviceStatus: 200,
          skipped: false,
        })),
      },
    },
    admin: {
      environment: "production",
      project,
      revision: "admin-revision",
      digestImage: "admin-image",
      url: values.admin.NEXTAUTH_URL,
      runtime: hosted.runtime,
      runtimeSha256: runtimeFingerprint({
        ...hosted.runtime,
        ...hosted.secrets,
      }),
    },
    adminCheck: {
      project,
      revision: "admin-revision",
      image: "admin-image",
      ok: true,
    },
    web: {
      environment: "production",
      imageId: `sha256:${"c".repeat(64)}`,
      buildInputSha256,
    },
    webCheck: {
      imageId: `sha256:${"c".repeat(64)}`,
      publicPages: true,
      buildInputSha256,
    },
    bundle: {
      imageId: `sha256:${"c".repeat(64)}`,
      containsPrivateConfiguration: true,
      buildInputSha256,
      runtimeSha256: runtimeFingerprint(values.web),
    },
  }
  for (const key of [
    "support",
    "cloud",
    "admin",
    "adminCheck",
    "web",
    "webCheck",
    "bundle",
  ])
    Object.assign(evidence[key], SOURCE)
  Object.assign(evidence.support, { imageId: `sha256:${"d".repeat(64)}` })
  Object.assign(evidence.cloud, { imageId: `sha256:${"d".repeat(64)}` })
  Object.assign(evidence.admin, { imageId: `sha256:${"e".repeat(64)}` })
  Object.assign(evidence.adminCheck, { imageId: `sha256:${"e".repeat(64)}` })
  return { project, values, evidence, webInputs }
}
test("release readiness accepts matching production evidence and rejects test or stale artifacts", () => {
  const f = fixture()
  assert.doesNotThrow(() =>
    assertReleaseEvidence(f.project, f.values, f.evidence, f.webInputs, SOURCE),
  )
  for (const [key, patch] of [
    ["support", { project: "synthetic-test" }],
    ["support", { runtimeSha256: "stale" }],
    ["cloud", { runtimeVersion: "1" }],
    ["admin", { environment: "test" }],
    ["adminCheck", { revision: "old-revision" }],
    ["web", { environment: "test" }],
    ["bundle", { imageId: "old-image" }],
    ["admin", { runtimeSha256: undefined }],
    ["bundle", { runtimeSha256: undefined }],
    ["webCheck", { buildInputSha256: "stale" }],
    ["bundle", { buildInputSha256: "stale" }],
  ]) {
    const evidence = structuredClone(f.evidence)
    Object.assign(evidence[key], patch)
    assert.throws(() =>
      assertReleaseEvidence(f.project, f.values, evidence, f.webInputs, SOURCE),
    )
  }
})

test("release rejects current Admin allowlist, hosted runtime and secret drift", () => {
  for (const key of [
    "ADMIN_ALLOWED_EMAILS",
    "PARTICIPANT_API_SERVER_ID",
    "SUPPORT_RECEPTION_EXPIRES_AT",
    "SUPPORT_BACKEND_STOPS_AT",
    "NEXTAUTH_SECRET",
    "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
    "SESSION_SEAL_PASSWORD",
    "IDENTIFIER_HASH_SECRET",
  ]) {
    const f = fixture()
    f.values.admin[key] =
      key === "SUPPORT_RECEPTION_EXPIRES_AT" ||
      key === "SUPPORT_BACKEND_STOPS_AT"
        ? "2099-02-01T00:00:00Z"
        : `${f.values.admin[key]}-changed`
    assert.throws(
      () =>
        assertReleaseEvidence(
          f.project,
          f.values,
          f.evidence,
          f.webInputs,
          SOURCE,
        ),
      /Admin settings changed/,
    )
  }
})

test("release checks the hosted Admin projection without depending on local operator settings", () => {
  const f = fixture()
  f.values.admin.NEXTAUTH_URL = "http://localhost:3001"
  f.values.admin.ADMIN_GCLOUD_ACCOUNT = "operator@example.invalid"
  f.values.admin.ADMIN_LOCAL_SERVICE_ACCOUNT = "local@example.invalid"
  assert.doesNotThrow(() =>
    assertReleaseEvidence(f.project, f.values, f.evidence, f.webInputs, SOURCE),
  )
})

test("release rejects Web runtime-only drift and bundled LLM preset content drift", () => {
  for (const key of [
    "SESSION_SEAL_PASSWORD",
    "SUPPORT_API_CREDENTIAL",
    "LLM_PRESET_FILE",
  ]) {
    const f = fixture()
    f.values.web[key] = `${f.values.web[key]}-changed`
    assert.throws(
      () =>
        assertReleaseEvidence(
          f.project,
          f.values,
          f.evidence,
          f.webInputs,
          SOURCE,
        ),
      /Web settings changed/,
    )
  }
  const f = fixture()
  f.webInputs.llmPresets[0].sha256 = "c".repeat(64)
  assert.throws(
    () =>
      assertReleaseEvidence(
        f.project,
        f.values,
        f.evidence,
        f.webInputs,
        SOURCE,
      ),
    /LLM presets changed/,
  )
})

test("release rejects every delivery stage with missing, dirty or different source", () => {
  for (const key of [
    "support",
    "cloud",
    "admin",
    "adminCheck",
    "web",
    "webCheck",
    "bundle",
  ]) {
    for (const patch of [
      { sourceRevision: undefined },
      { sourceTree: undefined },
      { sourceDirty: true },
      { sourceDirty: "false" },
      { sourceRevision: "c".repeat(40) },
      { sourceTree: "c".repeat(40) },
      { imageId: undefined },
      { imageId: "mutable-tag" },
    ]) {
      const f = fixture()
      Object.assign(f.evidence[key], patch)
      assert.throws(() =>
        assertReleaseEvidence(
          f.project,
          f.values,
          f.evidence,
          f.webInputs,
          SOURCE,
        ),
      )
    }
  }
})
