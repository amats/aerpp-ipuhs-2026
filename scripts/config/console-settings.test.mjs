import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { writeConsoleSettings } from "./console-settings.mjs"

test("support setup lists nested secret references and planned endpoint without serializing runtime secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-support-setup-"))
  try {
    writeConsoleSettings(
      directory,
      {
        support: {
          tokenKey: { secret: "SUPPORT_TOKEN_KEY" },
          gmail: {
            clientId: "synthetic.apps.googleusercontent.com",
            clientSecret: { secret: "SUPPORT_GMAIL_CLIENT_SECRET" },
            refreshToken: { secret: "SUPPORT_GMAIL_REFRESH_TOKEN" },
          },
          credentials: [{ verifierHash: "must-not-be-copied" }],
        },
      },
      {
        environment: "test",
        project: "synthetic-test",
        deployment: { service: "synthetic-admin" },
        terraform: {
          support: {
            serviceEndpoint: { baseUrl: "https://support.example.invalid" },
          },
        },
      },
    )
    const raw = readFileSync(join(directory, "console-settings.json"), "utf8")
    const settings = JSON.parse(raw)
    assert.deepEqual(settings.secretManager.requiredLocalSecretKeys, [
      "SUPPORT_TOKEN_KEY",
      "SUPPORT_GMAIL_REFRESH_TOKEN",
      "SUPPORT_GMAIL_OAUTH_CLIENT_JSON",
    ])
    assert.equal(
      settings.support.cloudRun.serviceUrl,
      "https://support.example.invalid",
    )
    assert.deepEqual(settings.support.gmail.authorizedRedirectUris, [
      "https://developers.google.com/oauthplayground",
    ])
    assert(!raw.includes("must-not-be-copied"))
    assert.deepEqual(
      settings.accessControl.serviceAccountRolesToReview[0].secretAccess
        .secretNames,
      [
        "synthetic-admin-session",
        "synthetic-admin-email-seal",
        "synthetic-admin-identifier-hash",
        "synthetic-admin-oauth",
      ],
    )
    assert(
      settings.accessControl.serviceAccountRolesToReview[0].projectRoles.includes(
        "roles/datastore.user",
      ),
    )
    assert(
      settings.accessControl.localAdminImpersonation.requiredProjectRoles.includes(
        "roles/datastore.user",
      ),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("Support setup removes Firebase Console instructions and records no automatic backups", () => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-support-owner-"))
  try {
    writeConsoleSettings(
      directory,
      {
        web: {},
        infrastructure: { firestore: { automaticBackups: false } },
      },
      { environment: "test", project: "synthetic-test" },
    )
    const settings = JSON.parse(
      readFileSync(join(directory, "console-settings.json"), "utf8"),
    )
    assert.equal(settings.oauth, undefined)
    assert.equal(settings.run, undefined)
    assert.equal(settings.iam, undefined)
    assert.deepEqual(
      settings.admin.googleSignIn.downloadedClientJsonDestination,
      { file: "secret.json", key: "ADMIN_GOOGLE_OAUTH_CLIENT_JSON" },
    )
    assert.deepEqual(settings.admin.googleSignIn.authorizedRedirectUris, [
      "http://localhost:3001/api/auth/callback/google",
    ])
    assert.equal(settings.status, undefined)
    assert.equal(settings.firebase, undefined)
    assert.equal(
      settings.accessControl.deploymentOperator.firebaseDeploymentPermissions,
      undefined,
    )
    assert.equal(existsSync(join(directory, "SETUP.md")), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
