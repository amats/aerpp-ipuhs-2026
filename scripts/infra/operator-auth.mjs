import { randomBytes, randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { createServer } from "node:http"
import { resolve } from "node:path"
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads"
import {
  cloudAccountEnvironment,
  privateJson,
  run,
  toolEnvironment,
} from "../shared/delivery.mjs"

const CLIENT = "aerpp-terraform-operator"

// Both Terraform's backend and provider understand the OAuth refresh protocol.
// This loopback adapter renews short-lived gcloud tokens without exporting the
// operator's refresh token or creating a Google OAuth client/service-account key.
export async function startOperatorTokenServer(nonce, getToken) {
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Content-Type", "application/json")
    const reject = (status) => {
      response.writeHead(status)
      response.end(JSON.stringify({ error: "invalid_request" }))
    }
    if (request.method !== "POST" || request.url !== "/token") {
      reject(404)
      return
    }
    try {
      let body = ""
      for await (const chunk of request) {
        body += chunk.toString("utf8")
        if (body.length > 4096) {
          reject(413)
          return
        }
      }
      const form = new URLSearchParams(body)
      const basic = `Basic ${Buffer.from(`${CLIENT}:${nonce}`).toString("base64")}`
      const clientMatches =
        request.headers.authorization === basic ||
        (form.get("client_id") === CLIENT &&
          form.get("client_secret") === nonce)
      if (
        !clientMatches ||
        form.get("grant_type") !== "refresh_token" ||
        form.get("refresh_token") !== nonce
      ) {
        reject(403)
        return
      }
      const token = await getToken()
      if (typeof token !== "string" || !token.length || /\s/.test(token))
        throw new Error("Unavailable operator token")
      response.end(
        JSON.stringify({
          access_token: token,
          token_type: "Bearer",
          expires_in: 60,
        }),
      )
    } catch {
      // Never return gcloud errors or credential material to the client/log.
      response.writeHead(503)
      response.end(JSON.stringify({ error: "temporarily_unavailable" }))
    }
  })
  await new Promise((resolveReady, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveReady)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}/token`,
    close: () => new Promise((done) => server.close(done)),
  }
}

export async function withTerraformOperatorAuth(
  project,
  config,
  directory,
  operation,
) {
  const bound = cloudAccountEnvironment(project, [config], toolEnvironment())
  const nonce = randomBytes(32).toString("base64url")
  const file = resolve(directory, `operator-auth-${randomUUID()}.json`)
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { kind: "terraform-operator-auth", project, env: bound, nonce },
    env: bound,
    // A CLI launched through node --input-type must not pass that flag to a file worker.
    execArgv: [],
  })
  try {
    const url = await new Promise((ready, reject) => {
      worker.once("message", (message) => {
        if (message.url) ready(message.url)
        else reject(new Error("Cannot start Terraform operator authentication"))
      })
      worker.once("error", () =>
        reject(new Error("Terraform operator authentication failed")),
      )
      worker.once("exit", () =>
        reject(new Error("Terraform operator authentication stopped")),
      )
    })
    privateJson(file, {
      _comment:
        "Generated ephemeral loopback authentication adapter; do not edit. Contains no Google refresh token or private key.",
      type: "external_account_authorized_user",
      audience: "aerpp-terraform-operator",
      client_id: CLIENT,
      client_secret: nonce,
      refresh_token: nonce,
      token_url: url,
    })
    const env = { ...bound, GOOGLE_APPLICATION_CREDENTIALS: file }
    // Explicit ADC prevents ambient credentials from selecting another operator.
    delete env.GOOGLE_OAUTH_ACCESS_TOKEN
    delete env.GOOGLE_BACKEND_ACCESS_TOKEN
    return await operation(env)
  } finally {
    await worker.terminate()
    rmSync(file, { force: true })
  }
}

if (!isMainThread && workerData?.kind === "terraform-operator-auth") {
  try {
    const server = await startOperatorTokenServer(workerData.nonce, () =>
      run(
        "gcloud",
        [
          "auth",
          "print-access-token",
          `--project=${workerData.project}`,
          "--quiet",
        ],
        {
          env: workerData.env,
        },
      ),
    )
    parentPort.postMessage({ url: server.url })
  } catch {
    parentPort.postMessage({ failed: true })
  }
}
