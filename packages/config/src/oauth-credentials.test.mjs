import assert from "node:assert/strict"
import { test } from "node:test"
import {
  parseOAuthCredential,
  projectOAuthCredentials,
} from "./oauth-credentials.mjs"

const PROJECT = "synthetic-test"
const CLIENT = {
  web: {
    project_id: PROJECT,
    client_id: "synthetic.apps.googleusercontent.com",
    client_secret: " literal $SECRET\\nbytes ",
    redirect_uris: ["http://localhost:3001/api/auth/callback/google"],
  },
}

test("downloaded OAuth JSON preserves secret bytes and ignores unused metadata", () => {
  assert.deepEqual(parseOAuthCredential(CLIENT, PROJECT, "admin"), {
    clientId: CLIENT.web.client_id,
    clientSecret: CLIENT.web.client_secret,
  })
  for (const value of [
    JSON.stringify(CLIENT),
    { installed: CLIENT.web },
    { ...CLIENT, installed: CLIENT.web },
    { web: { ...CLIENT.web, project_id: "another-project" } },
    { web: { ...CLIENT.web, client_id: "invalid" } },
    { web: { ...CLIENT.web, client_secret: "" } },
    { web: { ...CLIENT.web, client_secret: "YOUR_SECRET" } },
  ])
    assert.throws(
      () => parseOAuthCredential(value, PROJECT, "admin"),
      (error) => !error.message.includes(CLIENT.web.client_secret),
    )
})

test("OAuth projection reads only the selected application and rejects split config", () => {
  const calls = []
  const provider = {
    getJsonSecret: (key) => {
      calls.push(key)
      return CLIENT
    },
    getSecret: (key) => `ordinary-${key}`,
  }
  const config = { admin: {}, support: { gmail: {} } }
  const resolved = projectOAuthCredentials(
    config,
    { name: "test", project: PROJECT },
    provider,
    ["admin"],
  )
  assert.deepEqual(calls, ["ADMIN_GOOGLE_OAUTH_CLIENT_JSON"])
  assert.equal(
    resolved.getSecret("ADMIN_GOOGLE_OAUTH_CLIENT_SECRET"),
    CLIENT.web.client_secret,
  )
  assert.equal(
    resolved.getSecret("NEXTAUTH_SECRET"),
    "ordinary-NEXTAUTH_SECRET",
  )
  assert.equal(config.admin.ADMIN_GOOGLE_OAUTH_CLIENT_ID, CLIENT.web.client_id)
  assert.deepEqual(config.support.gmail, {})
  calls.length = 0
  projectOAuthCredentials({}, { name: "test", project: PROJECT }, provider, [
    "web",
    "logging",
  ])
  projectOAuthCredentials(
    {},
    { name: "example", project: "demo-local" },
    provider,
    ["support"],
  )
  assert.deepEqual(calls, [])
  assert.throws(
    () =>
      projectOAuthCredentials(
        { admin: { ADMIN_GOOGLE_OAUTH_CLIENT_ID: "stale" } },
        { name: "test", project: PROJECT },
        provider,
        ["admin"],
      ),
    /remove split/,
  )
  const support = { support: { gmail: {} } }
  const gmail = projectOAuthCredentials(
    support,
    { name: "test", project: PROJECT },
    provider,
    ["support"],
  )
  assert.deepEqual(calls, ["SUPPORT_GMAIL_OAUTH_CLIENT_JSON"])
  assert.equal(
    gmail.getSecret("SUPPORT_GMAIL_CLIENT_SECRET"),
    CLIENT.web.client_secret,
  )
  assert.throws(
    () =>
      projectOAuthCredentials(
        { support: { gmail: { clientSecret: "stale" } } },
        { name: "test", project: PROJECT },
        provider,
        ["support"],
      ),
    /remove split/,
  )
})
