import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  participantEmailRegexp,
  readSupportEnvironment,
} from "@aerpp/config/support"
import {
  environmentDirectory,
  prepareApplicationRuntime,
} from "@aerpp/config/workspace"
import { outputDirectory, privateJson, readJson } from "../shared/delivery.mjs"

export async function sendOnce({ claim, send, save }) {
  claim()
  try {
    const response = await send()
    const body = await response.json().catch(() => ({}))
    const accepted = response.status === 200 && body.ok === true
    save({ status: response.status, accepted, deliveryUnconfirmed: !accepted })
    return accepted
  } catch {
    save({ accepted: false, deliveryUnconfirmed: true })
    return false
  }
}

async function main() {
  const [environment, mode] = process.argv.slice(2)
  assert.equal(environment, "test")
  assert.equal(process.argv.slice(2).length, 2)
  assert(["send-once", "check"].includes(mode))
  const directory = environmentDirectory("test")
  const { target, values } = prepareApplicationRuntime("test", directory, {
    apps: "support",
  })
  const runtime = readSupportEnvironment(values.support)
  assert(
    runtime.admissionOpen &&
      runtime.environment === "test" &&
      runtime.mailMode === "gmail",
  )
  assert(
    participantEmailRegexp(runtime.gmail.participantEmailPattern).test(
      runtime.gmail.sender,
    ),
  )
  const output = outputDirectory("test")
  const deployment = readJson(
    resolve(output, "support-deployment.json"),
    "Deployment",
  )
  const cloud = readJson(
    resolve(output, "support-cloud-check.json"),
    "Cloud check",
  )
  assert.equal(deployment.project, target.project)
  assert.equal(cloud.project, target.project)
  assert.equal(cloud.image, deployment.image)
  assert.equal(cloud.runtimeVersion, deployment.runtimeVersion)
  assert.equal(
    createHash("sha256")
      .update(values.support.SUPPORT_RUNTIME_JSON)
      .digest("hex"),
    deployment.runtimeSha256,
  )
  const credential = readJson(
    resolve(directory, "secret.json"),
    "Secret store",
  ).SUPPORT_WEB_API_CREDENTIAL
  const [id, secret] = credential.split(".")
  const caller = runtime.credentials.find((entry) => entry.id === id)
  assert(
    caller &&
      !caller.revoked &&
      caller.notBeforeMs <= Date.now() &&
      caller.expiresAtMs > Date.now(),
  )
  assert(
    caller.operations.includes("sendMagicLink") &&
      caller.operations.includes("verifyAuthentication"),
  )
  assert.equal(
    createHash("sha256").update(secret).digest("hex"),
    caller.verifierHash,
  )
  const requestFile = resolve(output, "support-mail-request.json")
  const resultFile = resolve(output, "support-mail-check.json")
  const api = (path, body) =>
    fetch(new URL(path, runtime.baseUrl), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(65000),
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  if (mode === "send-once") {
    const consentId = randomBytes(10).toString("hex")
    const request = {
      consentId,
      serverId: caller.serverId,
      clientId: `mail-check-${consentId}`,
      pseudonym: `synthetic-mail-check-${consentId}`,
      expiresAtMs: Date.now() + 3600000,
      expectedWithdrawalId: null,
      expectedRecoveryId: null,
      expectedStudyGeneration: null,
      encryptedEmail: "synthetic-mail-acceptance-no-personal-data",
    }
    const startedAt = new Date().toISOString()
    const accepted = await sendOnce({
      claim: () =>
        writeFileSync(
          requestFile,
          JSON.stringify(
            {
              _comment:
                "Generated one-send claim; never remove to retry automatically",
              project: target.project,
              runtimeSha256: deployment.runtimeSha256,
              startedAt,
              request,
            },
            null,
            2,
          ),
          { mode: 0o600, flag: "wx" },
        ),
      send: () =>
        api("/api/participant/send-magic-link", {
          ...request,
          email: runtime.gmail.sender,
        }),
      save: (result) =>
        privateJson(resultFile, {
          project: target.project,
          startedAt,
          checkedAt: new Date().toISOString(),
          ...result,
          mailboxDeliveryVerified: false,
          confirmationVerified: false,
        }),
    })
    assert(accepted)
    console.log(
      "One confirmation email accepted by the live API. Check the designated mailbox; no automatic resend will occur.",
    )
  } else {
    const record = readJson(requestFile, "Mail request")
    assert.equal(record.project, target.project)
    const { consentId, serverId, clientId, pseudonym } = record.request
    assert.equal(serverId, caller.serverId)
    const response = await api("/api/participant/verify-authentication", {
      consentId,
      serverId,
      clientId,
      pseudonym,
    })
    const body = await response.json().catch(() => ({}))
    if (response.status === 409 && body.code === "AUTHENTICATION_PENDING") {
      console.log(
        "Email confirmation is pending. Open the received link and press the confirmation button.",
      )
      return
    }
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    const evidence = readJson(resultFile, "Mail result")
    privateJson(resultFile, {
      ...evidence,
      checkedAt: new Date().toISOString(),
      confirmationVerified: true,
    })
    console.log(
      "Live API confirms completed email authentication for this test request.",
    )
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main()
  } catch {
    console.error(
      "Mail acceptance stopped. Inspect private evidence; do not delete the one-send claim or resend automatically. No sensitive details emitted.",
    )
    process.exitCode = 1
  }
}
