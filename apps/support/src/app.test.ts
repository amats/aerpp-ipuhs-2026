import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { SUPPORT_ROUTES } from "@aerpp/config/support-routes"
import { participationStateId } from "@aerpp/firestore/participant-repository"
import type { Firestore } from "@google-cloud/firestore"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { MemoryFirestore, Timestamp } from "../test-support/firestore.js"
import { CALLER_SECRET, syntheticRuntime } from "../test-support/runtime.js"

const log = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock("./logger.js", () => ({ logger: log }))

vi.mock("@google-cloud/firestore", () => ({
  Timestamp,
  FieldValue: { serverTimestamp: () => Timestamp.now() },
}))

import type { Runtime } from "@aerpp/config/support"
import { ApiError } from "./api-errors.js"
import { createSupportApp } from "./app.js"
import { CONFIRMATION_REQUEST_LIMITS as confirmationLimits } from "./confirmation-rate-limit.js"
import { MailSink } from "./mail.js"

let db: MemoryFirestore
let runtime: Runtime
let mail: MailSink
let server: Server | undefined
let origin: string
const verifier = vi.fn()
beforeEach(async () => {
  vi.clearAllMocks()
  db = new MemoryFirestore()
  runtime = syntheticRuntime()
  mail = new MailSink()
  verifier.mockReset()
  const app = createSupportApp(
    runtime,
    db as unknown as Firestore,
    mail,
    verifier,
  )
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  runtime.baseUrl = origin
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  }
})
async function call(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const authorization = { authorization: `Bearer local.${CALLER_SECRET}` }

it("requires scoped credentials and valid input for the state-only lookup", async () => {
  const path = SUPPORT_ROUTES.getParticipationState
  expect((await call(path, { pseudonym: "new-participant" })).status).toBe(401)
  expect(
    (
      await call(
        path,
        { pseudonym: "new-participant", records: true },
        authorization,
      )
    ).status,
  ).toBe(400)
  const response = await call(
    path,
    { pseudonym: "new-participant" },
    authorization,
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    studyGeneration: null,
    lastWithdrawalId: null,
  })
})
it("rejects varied anonymous confirmation IDs before database access once rate is exhausted", async () => {
  vi.spyOn(performance, "now").mockReturnValue(0)
  const transaction = vi.spyOn(db, "runTransaction")
  const requests = confirmationLimits.burst
  for (let i = 0; i < requests; i++) {
    const response = await call(
      "/email/confirm",
      {
        consentId: String(i).padStart(20, "0"),
        token: "a".repeat(43),
      },
      { origin },
    )
    expect(response.status).toBe(401)
  }
  expect(transaction).toHaveBeenCalledTimes(requests)
  for (let i = 0; i < 3; i++) {
    const response = await call(
      "/email/confirm",
      {
        consentId: String(requests + i).padStart(20, "0"),
        token: "b".repeat(43),
      },
      { origin, "x-forwarded-for": `192.0.2.${i + 1}` },
    )
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("1")
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" })
  }
  expect(transaction).toHaveBeenCalledTimes(requests)
  expect(db.records.size).toBe(0)
})

it("retains confirmation slots until database operations settle, including disconnected clients", async () => {
  let finish!: () => void
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  const transaction = vi
    .spyOn(db, "runTransaction")
    .mockImplementation(async () => {
      await finished
      throw new Error("synthetic database failure")
    })
  const controllers = Array.from(
    { length: confirmationLimits.maxInFlight },
    () => new AbortController(),
  )
  const pending = controllers.map((controller, i) =>
    fetch(`${origin}/email/confirm`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", origin },
      body: JSON.stringify({
        consentId: String(i).padStart(20, "0"),
        token: "a".repeat(43),
      }),
    }).catch(() => null),
  )
  try {
    await vi.waitFor(() =>
      expect(transaction).toHaveBeenCalledTimes(confirmationLimits.maxInFlight),
    )
    controllers[0].abort()
    const body = { consentId: "AbCdEfGhIjKlMnOpQrSt", token: "b".repeat(43) }
    expect((await call("/email/confirm", body, { origin })).status).toBe(429)
    expect(transaction).toHaveBeenCalledTimes(confirmationLimits.maxInFlight)
    finish()
    await Promise.all(pending)
    await vi.waitFor(async () =>
      expect((await call("/email/confirm", body, { origin })).status).toBe(500),
    )
    expect(transaction.mock.calls.length).toBeGreaterThan(
      confirmationLimits.maxInFlight,
    )
  } finally {
    finish()
    await Promise.all(pending)
  }
})

it("allows ten simultaneous valid confirmations and their response-loss retries", async () => {
  const inputs: Record<string, string>[] = []
  for (let i = 0; i < 10; i++) {
    const response = await call(
      "/api/participant/send-magic-link",
      {
        consentId: `Participant${String(i).padStart(9, "0")}`,
        serverId: "server-1",
        clientId: `client-${i}`,
        pseudonym: `person-${i}`,
        email: `person-${i}@example.invalid`,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: "cipher",
        expectedWithdrawalId: null,
        expectedRecoveryId: null,
        expectedStudyGeneration: null,
        expiresAtMs: Date.now() + 3600000,
      },
      authorization,
    )
    expect(response.status).toBe(200)
    const link = new URL(mail.messages[i].confirmationUrl)
    inputs.push(Object.fromEntries(new URLSearchParams(link.hash.slice(1))))
  }
  const first = await Promise.all(
    inputs.map((input) => call("/email/confirm", input, { origin })),
  )
  expect(first.map((response) => response.status)).toEqual(Array(10).fill(200))
  const retries = await Promise.all(
    inputs.map((input) => call("/email/confirm", input, { origin })),
  )
  expect(retries.map((response) => response.status)).toEqual(
    Array(10).fill(409),
  )
  for (const response of retries)
    expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_USED" })
})
it("serves a public robots.txt that disallows crawling every path", async () => {
  const response = await call("/robots.txt")
  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("text/plain")
  expect(await response.text()).toBe("User-agent: *\nDisallow: /\n")
})

it("only explicit public routes are available; unknown and maintenance routes never bypass policy", async () => {
  for (const path of [
    "/",
    "/privacy",
    "/terms",
    "/contact",
    "/email/confirm",
    "/health",
  ])
    expect((await call(path)).status).toBe(200)
  expect((await call("/api/new-route", {})).status).toBe(404)
  expect((await call("/api/participant/information")).status).toBe(401)
  expect((await call("/maintenance/withdrawal-cleanup", {})).status).toBe(401)
  for (const [operation, path] of Object.entries(SUPPORT_ROUTES)) {
    if (operation === "magicCompletePage") continue
    expect(
      (await call(path, operation === "getInformation" ? undefined : {}))
        .status,
    ).toBe(401)
  }
  expect(db.records.size).toBe(0)
})
it("rejects missing, invalid, revoked, expired and cross-server credentials", async () => {
  const path = "/api/participant/verify-authentication"
  const body = {
    serverId: "other",
    clientId: "client",
    pseudonym: "person",
    consentId: "consent",
  }
  for (const headers of [{}, { authorization: "Bearer local.invalid" }])
    expect(
      (await call(path, body, headers as Record<string, string>)).status,
    ).toBe(401)
  expect((await call(path, body, authorization)).status).toBe(403)
  runtime.credentials[0].revoked = true
  expect((await call(path, body, authorization)).status).toBe(401)
  runtime.credentials[0].revoked = false
  runtime.credentials[0].expiresAtMs = 1
  expect((await call(path, body, authorization)).status).toBe(401)
})
it("operation permissions separate information writes from participant reads", async () => {
  runtime.credentials[0].operations = ["getInformation"]
  expect(
    (await call("/api/participant/information", undefined, authorization))
      .status,
  ).toBe(200)
  expect(
    (await call("/api/operator/information", {}, authorization)).status,
  ).toBe(403)
})
it("GET scanners cannot consume a link; explicit same-origin POST completes once", async () => {
  const body = {
    consentId: "AbCdEfGhIjKlMnOpQrSt",
    serverId: "server-1",
    clientId: "client-1",
    pseudonym: "person",
    email: "person@example.invalid",
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    encryptedEmail: "cipher",
    expectedWithdrawalId: null,
    expectedRecoveryId: null,
    expectedStudyGeneration: null,
    expiresAtMs: Date.now() + 3600000,
  }
  expect(
    (await call("/api/participant/send-magic-link", body, authorization))
      .status,
  ).toBe(200)
  const link = new URL(mail.messages[0].confirmationUrl)
  const input = Object.fromEntries(new URLSearchParams(link.hash.slice(1)))
  const get = await call(link.pathname)
  expect(get.status).toBe(200)
  expect(get.headers.get("referrer-policy")).toBe("no-referrer")
  expect(db.data(`emailConfirmations/${body.consentId}`)?.status).toBe("sent")
  expect((await call(link.pathname, input)).status).toBe(403)
  expect(
    (
      await call(link.pathname, input, {
        origin: "https://wrong.example.invalid",
      })
    ).status,
  ).toBe(403)
  expect((await call(link.pathname, input, { origin })).status).toBe(200)
  expect((await call(link.pathname, input, { origin })).status).toBe(409)
  expect(
    (
      await call(
        "/api/participant/verify-authentication",
        {
          consentId: body.consentId,
          serverId: body.serverId,
          clientId: body.clientId,
          pseudonym: body.pseudonym,
        },
        authorization,
      )
    ).status,
  ).toBe(200)
})
it("closed admission creates no new authentication and accepts no confirmation", async () => {
  runtime.admissionOpen = false
  expect(
    (
      await call(
        "/api/participant/send-magic-link",
        { serverId: "server-1" },
        authorization,
      )
    ).status,
  ).toBe(503)
  expect((await call("/email/confirm", {}, { origin })).status).toBe(503)
  expect(
    [...db.records.keys()].some((path) =>
      path.startsWith("emailConfirmations/"),
    ),
  ).toBe(false)
})
it("Scheduler must have a verified token with the exact identity, audience and unexpired claims", async () => {
  const path = "/maintenance/withdrawal-cleanup"
  const claims = {
    iss: "https://accounts.google.com",
    aud: origin + path,
    email: runtime.schedulerIdentity,
    email_verified: true,
    sub: "123",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
  }
  verifier.mockRejectedValueOnce(new Error("bad signature"))
  expect((await call(path, {}, { authorization: "Bearer oidc" })).status).toBe(
    401,
  )
  for (const changed of [
    { email: "other@example.invalid" },
    { aud: origin },
    { exp: 0 },
    { iss: "attacker" },
    { email_verified: false },
  ]) {
    verifier.mockResolvedValueOnce({ ...claims, ...changed })
    expect(
      (await call(path, {}, { authorization: "Bearer oidc" })).status,
    ).toBe(401)
  }
  verifier.mockResolvedValue(claims)
  expect((await call(path, {}, { authorization: "Bearer oidc" })).status).toBe(
    200,
  )
  runtime.maintenanceEnabled = false
  expect((await call(path, {}, { authorization: "Bearer oidc" })).status).toBe(
    503,
  )
})
it("invalid JSON never echoes payloads or raw parser errors", async () => {
  const response = await fetch(`${origin}/api/participant/send-magic-link`, {
    method: "POST",
    headers: { ...authorization, "Content-Type": "application/json" },
    body: '{"private-email"',
  })
  expect(response.status).toBe(400)
  expect(await response.text()).not.toContain("private-email")
})

it("signals failed deletion to Scheduler and safely completes its retry", async () => {
  const path = "/maintenance/withdrawal-cleanup"
  const state = `participationStates/${participationStateId("participant")}`
  db.seed(state, {
    pseudonym: "participant",
    status: "withdrawn",
    lastWithdrawalId: "withdrawal-1",
    cleanupStatus: "pending",
    deletedCount: 0,
  })
  db.seed("analysisQuestionnaires/answer", { pseudonym: "participant" })
  verifier.mockResolvedValue({
    iss: "https://accounts.google.com",
    aud: origin + path,
    email: runtime.schedulerIdentity,
    email_verified: true,
    sub: "123",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
  })
  db.failCommit = (writes) => writes.some((write) => write.kind === "delete")
  const failed = await call(path, {}, { authorization: "Bearer oidc" })
  expect(failed.status).toBe(503)
  expect(await failed.json()).toMatchObject({
    ok: false,
    code: "WITHDRAWAL_CLEANUP_FAILED",
    error: expect.any(String),
    failed: 1,
    completed: 0,
  })
  expect(db.data(state)?.cleanupStatus).toBe("pending")
  db.failCommit = undefined
  const retried = await call(path, {}, { authorization: "Bearer oidc" })
  expect(retried.status).toBe(200)
  expect(await retried.json()).toMatchObject({
    ok: true,
    failed: 0,
    completed: 1,
  })
  expect(db.data(state)).toMatchObject({
    cleanupStatus: "complete",
    deletedCount: 1,
  })
})

it.each(["before", "after"])(
  "maintenance skips all data and mail work %s the backend operating window",
  async (position) => {
    const now = Date.now()
    runtime.credentials[0].notBeforeMs =
      position === "before" ? now + 86_400_000 : now - 172_800_000
    runtime.credentials[0].expiresAtMs =
      position === "before" ? now + 172_800_000 : now - 43_200_001
    const collection = vi.spyOn(db, "collection")
    const health = vi.spyOn(mail, "health")
    for (const path of [
      "/maintenance/withdrawal-cleanup",
      "/maintenance/mail-health",
    ]) {
      expect((await call(path, {})).status).toBe(401)
      verifier.mockResolvedValue({
        iss: "https://accounts.google.com",
        aud: origin + path,
        email: runtime.schedulerIdentity,
        email_verified: true,
        sub: "123",
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
      })
      const response = await call(path, {}, { authorization: "Bearer oidc" })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ok: true,
        skipped: true,
        code: "MAINTENANCE_OUTSIDE_WINDOW",
      })
    }
    expect(collection).not.toHaveBeenCalled()
    expect(health).not.toHaveBeenCalled()
  },
)

it.each(["local", "test", "production"] as const)(
  "does not expose participant-history erasure in %s",
  async (environment) => {
    runtime.environment = environment
    runtime.credentials[0].environment = environment
    expect(
      (await call("/api/debug/reset-participation", {}, authorization)).status,
    ).toBe(404)
  },
)

const deadlineRequest = () => ({
  consentId: "AbCdEfGhIjKlMnOpQrSt",
  serverId: "server-1",
  clientId: "client-1",
  pseudonym: "person",
  email: "person@example.invalid",
  documentSet: { version: "1.0", sha256: "a".repeat(64) },
  encryptedEmail: "cipher",
  expectedWithdrawalId: null,
  expectedRecoveryId: null,
  expectedStudyGeneration: null,
  expiresAtMs: Date.now() + 3600000,
})
it.each(["expired", "revoked", "unbound"])(
  "rejects pending confirmation after its caller becomes %s",
  async (policy) => {
    const body = deadlineRequest()
    expect(
      (await call("/api/participant/send-magic-link", body, authorization))
        .status,
    ).toBe(200)
    const ref = `emailConfirmations/${body.consentId}`
    if (policy === "expired")
      runtime.credentials[0].expiresAtMs = Date.now() - 1
    else if (policy === "revoked") runtime.credentials[0].revoked = true
    else {
      const pending = { ...db.data(ref) }
      delete pending.credentialId
      db.seed(ref, pending)
    }
    const before = db.data(ref)
    const link = new URL(mail.messages[0].confirmationUrl)
    const input = Object.fromEntries(new URLSearchParams(link.hash.slice(1)))
    const response = await call(link.pathname, input, { origin })
    expect(response.status).toBe(policy === "expired" ? 410 : 401)
    expect(db.data(`participationEvents/${body.consentId}`)).toBeUndefined()
    expect(db.data(ref)).toEqual(before)
  },
)
it("retains the fixed pending-link deadline while backend stop controls confirmation", async () => {
  const now = Date.now()
  runtime.credentials[0].expiresAtMs = now + 30_000
  const body = deadlineRequest()
  expect(
    (await call("/api/participant/send-magic-link", body, authorization))
      .status,
  ).toBe(200)
  const ref = `emailConfirmations/${body.consentId}`
  expect(db.data(ref)?.expireAt).toEqual(Timestamp.fromMillis(body.expiresAtMs))
  const link = new URL(mail.messages[0].confirmationUrl)
  const input = Object.fromEntries(new URLSearchParams(link.hash.slice(1)))
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 30_000)
  try {
    const response = await call(link.pathname, input, { origin })
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: "RECEPTION_CLOSED" })
    expect(db.data(`participationEvents/${body.consentId}`)).toBeUndefined()
  } finally {
    clock.mockRestore()
  }
})
it("keeps confirmed authentication durable without a pending-link TTL", async () => {
  const now = Date.now()
  const cutoff = now + 72 * 3600000
  runtime.credentials[0].expiresAtMs = cutoff
  const body = deadlineRequest()
  expect(
    (await call("/api/participant/send-magic-link", body, authorization))
      .status,
  ).toBe(200)
  const link = new URL(mail.messages[0].confirmationUrl)
  const input = Object.fromEntries(new URLSearchParams(link.hash.slice(1)))
  expect((await call(link.pathname, input, { origin })).status).toBe(200)
  expect(db.data(`emailConfirmations/${body.consentId}`)).not.toHaveProperty(
    "expireAt",
  )
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 48 * 3600000)
  try {
    expect(
      (
        await call(
          "/api/participant/verify-authentication",
          {
            serverId: body.serverId,
            clientId: body.clientId,
            pseudonym: body.pseudonym,
            consentId: body.consentId,
          },
          authorization,
        )
      ).status,
    ).toBe(200)
    expect((await call(link.pathname, input, { origin })).status).toBe(409)
    expect(db.data(`emailConfirmations/${body.consentId}`)).not.toHaveProperty(
      "expireAt",
    )
  } finally {
    clock.mockRestore()
  }
})

function schedulerClaims(path: string) {
  return {
    iss: "https://accounts.google.com",
    aud: origin + path,
    email: runtime.schedulerIdentity,
    email_verified: true,
    sub: "123",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
  }
}

it.each(["known", "unexpected"])(
  "logs a %s mail-health failure once at its operation boundary",
  async (kind) => {
    const path = "/maintenance/mail-health"
    verifier.mockResolvedValue(schedulerClaims(path))
    const error =
      kind === "known"
        ? new ApiError(
            503,
            "MAIL_REAUTHORIZATION_REQUIRED",
            "private-token@example.invalid",
          )
        : new Error("private-token@example.invalid")
    vi.spyOn(mail, "health").mockRejectedValue(error)
    expect(
      (await call(path, {}, { authorization: "Bearer private-oidc" })).status,
    ).toBe(kind === "known" ? 503 : 500)
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      {
        operation: "mailHealth",
        code:
          kind === "known" ? "MAIL_REAUTHORIZATION_REQUIRED" : "INTERNAL_ERROR",
      },
      "Support operation failed",
    )
    expect(log.info).not.toHaveBeenCalled()
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("private")
  },
)

it("retains cleanup context for failures before aggregate results exist", async () => {
  const path = "/maintenance/withdrawal-cleanup"
  verifier.mockResolvedValue(schedulerClaims(path))
  vi.spyOn(db, "collection").mockImplementationOnce(() => {
    throw new Error("private-database-detail")
  })
  expect((await call(path, {}, { authorization: "Bearer oidc" })).status).toBe(
    500,
  )
  expect(log.error).toHaveBeenCalledExactlyOnceWith(
    { operation: "withdrawalCleanup", code: "INTERNAL_ERROR" },
    "Support operation failed",
  )
})

it("retains participant route context without logging request fields", async () => {
  vi.spyOn(db, "runTransaction").mockRejectedValue(
    new Error("private-email@example.invalid"),
  )
  expect(
    (
      await call(
        SUPPORT_ROUTES.getParticipationState,
        { pseudonym: "private-participant" },
        authorization,
      )
    ).status,
  ).toBe(500)
  expect(log.error).toHaveBeenCalledExactlyOnceWith(
    { operation: "getParticipationState", code: "INTERNAL_ERROR" },
    "Support operation failed",
  )
  expect(JSON.stringify(log.error.mock.calls)).not.toContain("private")
})
