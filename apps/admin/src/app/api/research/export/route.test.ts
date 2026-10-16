import { sealData } from "iron-session"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { QUESTIONNAIRE_ARCHIVE_TIMEOUT_MS } from "@/features/research/questionnaire-constraints"
import { readArchive } from "../../../../../test-support/read-archive"
import {
  addAnalysis,
  addPerson,
  fixtureSource,
} from "../../../../../test-support/research-fixtures"

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: {
    sessionSealPassword: "synthetic-export-email-password-for-tests",
    identifierHashSecret: "synthetic-export-identifier-secret",
  },
}))
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  source: vi.fn(),
  questionnaires: vi.fn(),
  snapshot: vi.fn(),
  log: vi.fn(),
}))
vi.mock("@/lib/firestore", () => ({ firestore: {} }))
vi.mock("@aerpp/firestore/participant-snapshot", () => ({
  readParticipantResearchSnapshot: mocks.snapshot,
}))
vi.mock("@/lib/auth", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@/lib/logger", () => ({ logExportFailure: mocks.log }))
vi.mock("@/features/research/research-source", () => ({
  readResearchSource: mocks.source,
}))

vi.mock("@/features/research/research-definitions", () => ({
  loadResearchQuestionnaires: mocks.questionnaires,
}))

import { GET } from "./route"

const request = (query: string) =>
  new Request(`https://example.invalid/api/research/export?${query}`)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.questionnaires.mockResolvedValue({ definitions: {}, files: {} })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it("starts the shared archive deadline before reading Firestore and passes request cancellation", async () => {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), delay)
    return controller.signal
  })
  mocks.source.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    return fixtureSource()
  })
  const controller = new AbortController()
  const pending = GET(
    new Request("https://example.invalid/api/research/export?format=bundle", {
      signal: controller.signal,
    }),
  )
  await vi.advanceTimersByTimeAsync(20_000)
  expect((await pending).status).toBe(200)
  const signal = mocks.questionnaires.mock.calls[0][1].signal as AbortSignal
  await vi.advanceTimersByTimeAsync(QUESTIONNAIRE_ARCHIVE_TIMEOUT_MS - 20_001)
  expect(signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(signal.aborted).toBe(true)

  mocks.source.mockResolvedValue(fixtureSource())
  await GET(
    new Request("https://example.invalid/api/research/export?format=bundle", {
      signal: controller.signal,
    }),
  )
  const nextSignal = mocks.questionnaires.mock.calls[1][1].signal as AbortSignal
  controller.abort()
  expect(nextSignal.aborted).toBe(true)
})

it.each(["late-success", "late-failure"])(
  "returns 503 at the deadline while Firestore is still pending and ignores %s",
  async (outcome) => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), delay)
      return controller.signal
    })
    const { readResearchSource } = await vi.importActual<
      typeof import("@/features/research/research-source")
    >("@/features/research/research-source")
    mocks.source.mockImplementation(readResearchSource)
    const snapshot = Promise.withResolvers<ReturnType<typeof fixtureSource>>()
    mocks.snapshot.mockReturnValueOnce(snapshot.promise)
    const pending = GET(request("format=bundle"))
    await vi.advanceTimersByTimeAsync(QUESTIONNAIRE_ARCHIVE_TIMEOUT_MS - 1)
    expect(mocks.snapshot).toHaveBeenCalledOnce()
    expect(mocks.log).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    const response = await pending
    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toContain("no-store")
    expect(response.headers.has("Content-Disposition")).toBe(false)
    expect(mocks.questionnaires).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledOnce()
    if (outcome === "late-success") snapshot.resolve(fixtureSource())
    else snapshot.reject(new Error("late snapshot failure"))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.questionnaires).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledOnce()
  },
)

it("stops snapshot waiting when the research ZIP request is cancelled", async () => {
  const { readResearchSource } = await vi.importActual<
    typeof import("@/features/research/research-source")
  >("@/features/research/research-source")
  mocks.source.mockImplementation(readResearchSource)
  const snapshot = Promise.withResolvers<ReturnType<typeof fixtureSource>>()
  mocks.snapshot.mockReturnValueOnce(snapshot.promise)
  const controller = new AbortController()
  const pending = GET(
    new Request("https://example.invalid/api/research/export?format=bundle", {
      signal: controller.signal,
    }),
  )
  await vi.waitFor(() => expect(mocks.snapshot).toHaveBeenCalledOnce())
  controller.abort()
  expect((await pending).status).toBe(503)
  snapshot.resolve(fixtureSource())
  await Promise.resolve()
  expect(mocks.questionnaires).not.toHaveBeenCalled()
})

it.each(["research", "access", "all"])(
  "protects %s downloads before any data read",
  async (dataset) => {
    mocks.auth.mockRejectedValueOnce(new Error("NEXT_REDIRECT"))
    await expect(
      GET(request(`dataset=${dataset}&format=bundle`)),
    ).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.source).not.toHaveBeenCalled()
  },
)
it("exports separate datasets without contact or answer leakage, ignoring operational filters", async () => {
  const source = { ...fixtureSource(), emailConfirmations: [] }
  addPerson(source, "a")
  addAnalysis(source, "a", "a", { TX1: "answer-only" })
  source.participationEvents[0].data.encryptedEmail = await sealData(
    "contact@example.invalid",
    {
      password: "synthetic-export-email-password-for-tests",
    },
  )
  mocks.source.mockResolvedValue(source)
  const downloads: Record<string, Record<string, string>> = {}
  for (const dataset of ["research", "access"]) {
    const result = await GET(
      request(
        `dataset=${dataset}&format=bundle&serverId=ignored&dataPurpose=test&start=2099-01-01`,
      ),
    )
    expect(result.status).toBe(200)
    expect(result.headers.get("Cache-Control")).toContain("no-store")
    downloads[dataset] = readArchive(new Uint8Array(await result.arrayBuffer()))
    expect(
      Object.keys(downloads[dataset]).every((name) => !name.includes("/")),
    ).toBe(true)
  }
  expect(mocks.source).toHaveBeenNthCalledWith(1, false, {
    signal: expect.any(AbortSignal),
    retain: expect.any(Function),
  })
  expect(mocks.source).toHaveBeenNthCalledWith(2, true, {
    signal: expect.any(AbortSignal),
    retain: expect.any(Function),
  })
  const research = JSON.parse(downloads.research["source.json"])
  const access = JSON.parse(downloads.access["source.json"])
  expect(research.analysisQuestionnaires).toHaveLength(1)
  expect(access.manifest.exportId).not.toBe(research.manifest.exportId)
  expect(access.manifest.schemaVersion).toBe(8)
  expect(access.participationEvents[0].data.email).toBe(
    "contact@example.invalid",
  )
  expect(access.participationEvents[0].data.did).toMatch(
    /^aerpp:did-[A-Za-z0-9]{32}$/,
  )
  expect(downloads.access["participation-events.csv"]).toContain(
    access.participationEvents[0].data.did,
  )
  expect(downloads.research["source.json"]).not.toContain("aerpp:did-")
  expect(downloads.access["source.json"]).not.toContain(
    "synthetic-export-identifier-secret",
  )
  expect(downloads.access["participation-events.csv"]).toContain(
    "contact@example.invalid",
  )
  expect(JSON.stringify(downloads.research)).not.toContain(
    "contact@example.invalid",
  )
  expect(JSON.stringify(downloads.access)).not.toContain("encryptedEmail")
  expect(downloads.access["source.json"]).not.toContain("answer-only")
})
it("research-only downloads do not request contact/authentication fields", async () => {
  mocks.source.mockResolvedValue({ ...fixtureSource(), emailConfirmations: [] })
  expect((await GET(request("format=json"))).status).toBe(200)
  expect(mocks.source).toHaveBeenCalledExactlyOnceWith(false, {
    signal: expect.any(AbortSignal),
    retain: expect.any(Function),
  })
})
it.each([
  "dataset=unknown",
  "dataset=research&format=participationEvents",
  "dataset=access&format=analysisQuestionnaires",
  "dataset=all&format=json",
  "dataset=all&format=bundle",
])("rejects invalid format combinations: %s", async (query) => {
  expect((await GET(request(query))).status).toBe(400)
  expect(mocks.source).not.toHaveBeenCalled()
})

it.each(["bundle", "json", "participationEvents", "emailConfirmations"])(
  "retains readable and unreadable emails in %s downloads without exposing ciphertext",
  async (format) => {
    const source = fixtureSource()
    const password = "synthetic-export-email-password-for-tests"
    const readable = await sealData("contact@example.invalid", { password })
    const tampered = readable.split("*")
    tampered[7] = `${tampered[7][0] === "A" ? "B" : "A"}${tampered[7].slice(1)}`
    const storedValues = [
      "synthetic-mail-acceptance-no-personal-data",
      await sealData("wrong-key@example.invalid", {
        password: `${password}-wrong`,
      }),
      tampered.join("*"),
      await sealData("not-an-email", { password }),
      readable,
    ]
    for (const [index, value] of storedValues.entries()) {
      addPerson(source, `row-${index}`)
      source.participationEvents[index].data.encryptedEmail = value
    }
    source.participationEvents.push({
      id: "withdrawal",
      data: {
        pseudonym: "row-0",
        consentId: source.participationEvents[0].id,
        eventType: "withdrawal",
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        withdrawalAcceptedAt: "2026-03-22T00:00:00Z",
        encryptedEmail: storedValues[0],
      },
    })
    source.emailConfirmations = structuredClone(source.participationEvents)
    mocks.source.mockResolvedValue(source)
    const result = await GET(request(`dataset=access&format=${format}`))
    expect(result.status).toBe(200)
    expect(result.headers.get("Cache-Control")).toContain("no-store")
    expect(result.headers.has("Content-Disposition")).toBe(true)
    const files =
      format === "bundle"
        ? readArchive(new Uint8Array(await result.arrayBuffer()))
        : {
            [format === "json" ? "source.json" : `${format}.csv`]:
              await result.text(),
          }
    const content = Object.values(files).join("\n")
    expect(content).toContain("復号できません")
    expect(content).toContain("contact@example.invalid")
    expect(content).not.toContain("wrong-key@example.invalid")
    expect(content).not.toContain("not-an-email")
    expect(content).not.toContain("encryptedEmail")
    for (const value of storedValues) expect(content).not.toContain(value)
    if (files["source.json"]) {
      const access = JSON.parse(files["source.json"])
      expect(access.manifest.schemaVersion).toBe(8)
      expect(access.manifest.excludedRecords).toBe(0)
      for (const collection of ["participationEvents", "emailConfirmations"]) {
        expect(access[collection]).toHaveLength(6)
        expect(access.manifest.counts[collection]).toEqual({
          read: 6,
          exported: 6,
        })
        for (const [index, row] of access[collection].entries()) {
          expect(row.data.email).toBe(
            index === 4 ? "contact@example.invalid" : "復号できません",
          )
          if (collection === "participationEvents") {
            if (index === 4)
              expect(row.data.did).toMatch(/^aerpp:did-[A-Za-z0-9]{32}$/)
            else expect(row.data.did).toBeNull()
          }
        }
      }
    }
    for (const collection of ["participationEvents", "emailConfirmations"]) {
      if (!files[`${collection}.csv`]) continue
      expect(
        files[`${collection}.csv`].match(/"復号できません"/g),
      ).toHaveLength(5)
      expect(files[`${collection}.csv`].trim().split("\r\n")).toHaveLength(7)
    }
    expect(mocks.log).not.toHaveBeenCalled()
  },
)
it("returns a noncached failure rather than partial or empty success", async () => {
  mocks.source.mockRejectedValue(new Error("sensitive SDK context"))
  const result = await GET(request("dataset=access&format=bundle"))
  expect(result.status).toBe(503)
  expect(result.headers.get("Cache-Control")).toContain("no-store")
  expect(await result.text()).not.toContain("sensitive")
  expect(mocks.log).toHaveBeenCalledOnce()
})

it.each([
  "dataset=research&format=json",
  "dataset=research&format=analysisQuestionnaires",
  "dataset=research&format=attempts",
  "dataset=access&format=bundle",
])("never accesses the questionnaire archive for %s", async (query) => {
  mocks.source.mockResolvedValue({ ...fixtureSource(), emailConfirmations: [] })
  mocks.questionnaires.mockRejectedValue(new Error("storage unavailable"))
  expect((await GET(request(query))).status).toBe(200)
  expect(mocks.questionnaires).not.toHaveBeenCalled()
})
it("fails the entire research ZIP if questionnaire retrieval fails", async () => {
  mocks.source.mockResolvedValue({ ...fixtureSource(), emailConfirmations: [] })
  mocks.questionnaires.mockRejectedValue(new Error("missing definition"))
  expect((await GET(request("dataset=research&format=bundle"))).status).toBe(
    503,
  )
})

it.each([
  "dataset=research&format=json",
  "dataset=research&format=attempts",
  "dataset=access&format=bundle",
  "dataset=access&format=json",
])("applies the shared snapshot deadline to %s", async (query) => {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), delay)
    return controller.signal
  })
  const { readResearchSource } = await vi.importActual<
    typeof import("@/features/research/research-source")
  >("@/features/research/research-source")
  mocks.source.mockImplementation(readResearchSource)
  const snapshot = Promise.withResolvers<ReturnType<typeof fixtureSource>>()
  mocks.snapshot.mockReturnValueOnce(snapshot.promise)
  const pending = GET(request(query))
  await vi.advanceTimersByTimeAsync(QUESTIONNAIRE_ARCHIVE_TIMEOUT_MS)
  expect((await pending).status).toBe(503)
  expect(mocks.questionnaires).not.toHaveBeenCalled()
  snapshot.resolve(fixtureSource())
  await Promise.resolve()
})

it("rejects overlapping exports and keeps the slot after cancellation until the SDK read settles", async () => {
  const { readResearchSource } = await vi.importActual<
    typeof import("@/features/research/research-source")
  >("@/features/research/research-source")
  mocks.source.mockImplementation(readResearchSource)
  const snapshot = Promise.withResolvers<ReturnType<typeof fixtureSource>>()
  mocks.snapshot.mockReturnValueOnce(snapshot.promise)
  const controller = new AbortController()
  const pending = GET(
    new Request("https://example.invalid/api/research/export?format=json", {
      signal: controller.signal,
    }),
  )
  await vi.waitFor(() => expect(mocks.snapshot).toHaveBeenCalledOnce())
  const busy = await GET(request("dataset=access&format=json"))
  expect(busy.status).toBe(429)
  expect(busy.headers.get("Retry-After")).toBe("15")
  controller.abort()
  expect((await pending).status).toBe(503)
  expect((await GET(request("format=json"))).status).toBe(429)
  snapshot.resolve(fixtureSource())
  await Promise.resolve()
  mocks.source.mockResolvedValue(fixtureSource())
  expect((await GET(request("format=json"))).status).toBe(200)
})
