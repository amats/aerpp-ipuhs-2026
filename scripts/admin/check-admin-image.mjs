import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { environmentTarget } from "@aerpp/config/targets"
import {
  cloudEnvironment,
  outputDirectory,
  privateJson,
  readJson,
  run,
  toolEnvironment,
} from "../shared/delivery.mjs"
import {
  assertMatchingSource,
  readSourceState,
  sourceProvenance,
} from "../shared/source-provenance.mjs"
import { validateImage } from "./prepare-admin-deployment.mjs"

export async function checkHttp(origin) {
  for (const path of [
    "/dashboard",
    "/participant",
    "/survey",
    "/research",
    "/api/research/export?format=bundle",
    "/api/research/export?dataset=access&format=bundle",
    "/api/research/export?dataset=all&format=bundle",
    "/log",
    "/information",
    "/updates",
  ]) {
    const response = await fetch(`${origin}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    })
    assert.equal(response.status, 307, "Protected route must redirect")
    assert.equal(
      new URL(response.headers.get("location"), origin).pathname,
      "/api/auth/signin",
    )
  }
  const providers = await fetch(`${origin}/api/auth/providers`, {
    signal: AbortSignal.timeout(15000),
  })
  assert.equal(providers.status, 200)
  assert.equal((await providers.json()).google.id, "google")
  const session = await fetch(`${origin}/api/auth/session`, {
    signal: AbortSignal.timeout(15000),
  })
  assert.deepEqual(await session.json(), {})
  const csrf = await fetch(`${origin}/api/auth/csrf`, {
    signal: AbortSignal.timeout(15000),
  })
  assert.equal(typeof (await csrf.json()).csrfToken, "string")
  const signin = await fetch(`${origin}/api/auth/signin`, {
    signal: AbortSignal.timeout(15000),
  })
  assert.equal(signin.status, 200)
  assert.match(await signin.text(), /Google/)
}
export async function main(args = process.argv.slice(2)) {
  const [environment, ...extra] = args
  cloudEnvironment(environment)
  if (extra.length) throw new Error("Usage: admin:check-image test|production")
  const target = environmentTarget(environment)
  const output = outputDirectory(environment)
  const manifest = readJson(
    resolve(output, "admin-image.json"),
    "Admin image manifest",
  )
  assertMatchingSource(manifest, readSourceState())
  const inspection = JSON.parse(
    run("docker", ["image", "inspect", manifest.imageId]),
  )[0]
  validateImage(manifest, inspection, target)
  const stage = mkdtempSync(resolve(tmpdir(), "aerpp-admin-check-"))
  let container
  try {
    const file = resolve(stage, "runtime.env")
    const settings = {
      AERPP_ENVIRONMENT: environment,
      NEXTAUTH_URL: "http://localhost:8080",
      PARTICIPANT_API_SERVER_ID: "synthetic-server",
      SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
      SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
      NEXTAUTH_SECRET: "synthetic-runtime-session-secret",
      SESSION_SEAL_PASSWORD: "synthetic-runtime-email-seal-password",
      IDENTIFIER_HASH_SECRET: "synthetic-runtime-identifier-secret",
      ADMIN_GOOGLE_OAUTH_CLIENT_ID:
        "synthetic-runtime.apps.googleusercontent.com",
      ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-runtime-oauth-secret",
      ADMIN_ALLOWED_EMAILS: "admin@example.invalid",
      GCP_PROJECT_ID: "synthetic-image-check",
    }
    writeFileSync(
      file,
      Object.entries(settings)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
      { mode: 0o600 },
    )
    container = run("docker", [
      "run",
      "--detach",
      "--platform=linux/amd64",
      "--network=none",
      "--env-file",
      file,
      manifest.imageId,
    ])
    const probe = `
      const assert = require("node:assert/strict")
      async function probeImage() {
        let ready = false
        for (let i = 0; i < 60; i++) {
          try {
            const response = await fetch("http://127.0.0.1:8080/api/auth/providers", { signal: AbortSignal.timeout(2000) })
            if (response.ok) { ready = true; break }
          } catch {}
          await new Promise((accept) => setTimeout(accept, 500))
        }
        assert(ready, "Admin image did not become ready")
        assert.notEqual(process.getuid(), 0, "Admin image must not run as root")
        const { v1 } = require("@google-cloud/firestore")
        const firestoreClient = new v1.FirestoreClient({
          projectId: "demo-image-check", apiKey: "synthetic", apiEndpoint: "127.0.0.1", port: 9,
        })
        await firestoreClient.initialize()
        await firestoreClient.close()
        await (${checkHttp.toString()})("http://127.0.0.1:8080")
        const { spawnSync } = require("node:child_process")
        for (const command of ["python", "python3"]) {
          const result = spawnSync(command, ["--version"])
          assert.equal(result.error?.code, "ENOENT", "Admin runtime must not include Python")
        }
        assert.equal(require("node:fs").existsSync(".statistics-venv"), false)
      }
      probeImage().catch((error) => { console.error(error); process.exitCode = 1 })
    `
    run("docker", ["exec", container, "node", "-e", probe])
    for (const [key, value, message] of [
      [
        "AERPP_ENVIRONMENT",
        environment === "test" ? "production" : "test",
        "Admin build differs from the selected environment",
      ],
      [
        "ADMIN_AUTH_BYPASS_ENABLED",
        "true",
        "Admin image must not bypass authentication",
      ],
    ]) {
      const rejected = run("docker", [
        "run",
        "--detach",
        "--network=none",
        "--platform=linux/amd64",
        "--env-file",
        file,
        "--env",
        `${key}=${value}`,
        manifest.imageId,
      ])
      try {
        assert.equal(
          run("docker", ["wait", rejected]),
          "1",
          "Unsafe runtime must fail startup",
        )
        const state = JSON.parse(run("docker", ["inspect", rejected]))[0].State
        assert.equal(state.OOMKilled, false)
        assert.equal(state.Error, "")
        // Read the startup error from the container's log file through Docker.
        const { spawnSync } = await import("node:child_process")
        const logs = spawnSync("docker", ["logs", rejected], {
          encoding: "utf8",
          env: toolEnvironment(),
        })
        assert.equal(logs.status, 0)
        assert((logs.stdout + logs.stderr).includes(message))
      } finally {
        run("docker", ["rm", "--force", rejected])
      }
    }
    assertMatchingSource(readSourceState(), manifest)
    privateJson(resolve(output, "admin-image-check.json"), {
      ...sourceProvenance(manifest),
      version: 1,
      environment,
      imageId: manifest.imageId,
      ok: true,
      checkedAt: new Date().toISOString(),
      scope:
        "network-disabled synthetic runtime, native Firestore transport initialization without RPC, unsigned requests including research/export, Python-free runtime, environment and bypass rejection; real OAuth and cloud access excluded",
    })
    console.log(
      "Admin image checks passed; real Google sign-in and cloud data access remain separate",
    )
  } finally {
    try {
      if (container) run("docker", ["rm", "--force", container])
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main()
  } catch {
    console.error(
      "Admin image checks failed; inspect the image and private manifest",
    )
    process.exitCode = 1
  }
}
