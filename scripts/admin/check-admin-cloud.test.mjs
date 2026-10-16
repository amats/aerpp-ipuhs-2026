import assert from "node:assert/strict"
import { test } from "node:test"
import { checkRevision } from "./check-admin-cloud.mjs"

const deployed = {
  environment: "test",
  digestImage: "registry.example.com/admin@sha256:abc",
  serviceAccount: "synthetic@example.com",
  runtime: {
    ADMIN_ALLOWED_EMAILS: "admin@example.com",
    SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
    SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
  },
  versions: { NEXTAUTH_SECRET: "admin-session:3" },
}
const revision = {
  metadata: {
    labels: { "aerpp-component": "admin", "aerpp-environment": "test" },
  },
  status: { imageDigest: deployed.digestImage },
  spec: {
    serviceAccountName: deployed.serviceAccount,
    containers: [
      {
        env: [
          { name: "ADMIN_ALLOWED_EMAILS", value: "admin@example.com" },
          {
            name: "NEXTAUTH_SECRET",
            valueFrom: { secretKeyRef: { name: "admin-session", key: "3" } },
          },
          {
            name: "SUPPORT_RECEPTION_EXPIRES_AT",
            value: "2099-01-01T00:00:00Z",
          },
          { name: "SUPPORT_BACKEND_STOPS_AT", value: "2099-12-31T00:00:00Z" },
        ],
      },
    ],
  },
}
test("cloud acceptance rejects runtime identity, allowlist, credential and secret version drift", () => {
  checkRevision(revision, deployed)
  for (const mutate of [
    (r) => {
      delete r.metadata
    },
    (r) => {
      r.metadata.labels["aerpp-component"] = "support"
    },
    (r) => {
      r.metadata.labels["aerpp-environment"] = "production"
    },
    (r) => {
      r.spec.serviceAccountName = "other@example.com"
    },
    (r) => {
      r.spec.containers[0].env[0].value = "removed@example.com"
    },
    (r) => {
      r.spec.containers[0].env[1].valueFrom.secretKeyRef.key = "latest"
    },
    (r) => {
      r.spec.containers[0].env[2].value = "2098-01-01T00:00:00Z"
    },
    (r) => {
      r.spec.containers[0].env.push({
        name: "GOOGLE_APPLICATION_CREDENTIALS",
        value: "/private/key.json",
      })
    },
    (r) => {
      r.status.imageDigest = "other-image"
    },
  ]) {
    const changed = structuredClone(revision)
    mutate(changed)
    assert.throws(() => checkRevision(changed, deployed))
  }
})
