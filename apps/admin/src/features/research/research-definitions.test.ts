import { createQuestionnaireArtifact } from "@aerpp/config/questionnaire"
import { afterEach, expect, it, vi } from "vitest"
import { fixtureSource } from "../../../test-support/research-fixtures"

const storageRequest = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: { environment: "test", gcpProjectId: "synthetic-test-project" },
}))
vi.mock("@/lib/google-auth", () => ({
  googleClientOptions: { authClient: { request: storageRequest } },
}))

import {
  QUESTIONNAIRE_ARCHIVE_MAX_CONCURRENCY,
  QUESTIONNAIRE_ARCHIVE_TIMEOUT_MS,
  QUESTIONNAIRE_READ_TIMEOUT_MS,
} from "./questionnaire-constraints"
import {
  loadResearchQuestionnaires,
  readArchivedQuestionnaire,
} from "./research-definitions"

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mockDeadline() {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
    const controller = new AbortController()
    setTimeout(
      () =>
        controller.abort(new DOMException("Deadline exceeded", "TimeoutError")),
      delay,
    )
    return controller.signal
  })
}

function multipleDefinitions(count: number) {
  const artifacts = Array.from({ length: count }, (_, index) => {
    const definition = structuredClone(artifact.definition)
    definition.items[0].question_ja = `Synthetic question ${index}`
    return createQuestionnaireArtifact(JSON.stringify(definition))
  })
  const source = fixtureSource()
  source.analysisQuestionnaires = artifacts.map(({ definitionId }, index) => ({
    id: `response-${index}`,
    data: { questionnaire: { kind: "initial", definitionId } },
  }))
  return { source, artifacts }
}

const artifact = createQuestionnaireArtifact(
  JSON.stringify({
    survey_version: "synthetic",
    description: "Synthetic study",
    types: [{ type: "text" }],
    items: [
      {
        type: "text",
        item_id: "Q1",
        question_ja: "Synthetic question",
        required: false,
      },
    ],
  }),
)
it("loads each recorded definition once and skips unsubmitted completion metadata", async () => {
  const source = fixtureSource()
  source.analysisQuestionnaires = [0, 1].map((id) => ({
    id: String(id),
    data: {
      questionnaire: { kind: "initial", definitionId: artifact.definitionId },
      answers: { Q1: null },
    },
  }))
  source.analysisQuestionnaires.push({
    id: "unsubmitted",
    data: { modelName: "synthetic" },
  })
  const read = vi.fn().mockResolvedValue(artifact.json)
  const archive = await loadResearchQuestionnaires(source, { read })
  expect(read).toHaveBeenCalledExactlyOnceWith(
    artifact.definitionId,
    expect.any(AbortSignal),
  )
  expect(Object.values(archive.files)).toEqual([artifact.json])
  expect(archive.definitions[artifact.definitionId]).toEqual(
    artifact.definition,
  )
  expect(source.analysisQuestionnaires).toHaveLength(3)
})
it("does not read storage for records without a questionnaire reference", async () => {
  const read = vi.fn()
  expect(await loadResearchQuestionnaires(fixtureSource(), { read })).toEqual({
    definitions: {},
    files: {},
  })
  expect(read).not.toHaveBeenCalled()
})
it("rejects submitted answers without a questionnaire reference", async () => {
  const source = fixtureSource()
  source.analysisQuestionnaires.push({
    id: "invalid-submission",
    data: {
      submittedAt: "2026-01-01T00:00:00.000Z",
      answers: { Q1: "answer" },
    },
  })
  const read = vi.fn()
  await expect(loadResearchQuestionnaires(source, { read })).rejects.toThrow(
    "Invalid stored questionnaire reference",
  )
  expect(read).not.toHaveBeenCalled()
})
it.each(["missing", "corrupt", "invalid-reference"])(
  "aborts incomplete archives: %s",
  async (failure) => {
    const source = fixtureSource()
    source.analysisQuestionnaires.push({
      id: "a",
      data: {
        questionnaire: {
          kind: "initial",
          definitionId:
            failure === "invalid-reference"
              ? "../other"
              : artifact.definitionId,
        },
      },
    })
    const read =
      failure === "missing"
        ? vi.fn().mockRejectedValue(new Error("unavailable"))
        : vi.fn().mockResolvedValue("{}")
    await expect(loadResearchQuestionnaires(source, { read })).rejects.toThrow()
  },
)

it("preserves both definitions when the same item and human version have changed", async () => {
  const changed = structuredClone(artifact.definition)
  changed.items[0].question_ja = "Replacement question"
  const replacement = createQuestionnaireArtifact(JSON.stringify(changed))
  const source = fixtureSource()
  source.analysisQuestionnaires = [artifact, replacement].map(
    (definition, index) => ({
      id: `response-${index}`,
      data: {
        questionnaire: {
          kind: "initial",
          definitionId: definition.definitionId,
        },
        answers: { Q1: `answer-${index}` },
      },
    }),
  )
  const read = vi.fn(async (id: string) =>
    id === artifact.definitionId ? artifact.json : replacement.json,
  )
  const archive = await loadResearchQuestionnaires(source, { read })
  expect(Object.keys(archive.files)).toHaveLength(2)
  expect(archive.definitions[artifact.definitionId].items[0].question_ja).toBe(
    "Synthetic question",
  )
  expect(
    archive.definitions[replacement.definitionId].items[0].question_ja,
  ).toBe("Replacement question")
  expect(read).toHaveBeenCalledTimes(2)
})

it("completes nine slow reads in bounded parallel batches within the relaxed archive budget", async () => {
  mockDeadline()
  const { source, artifacts } = multipleDefinitions(9)
  let active = 0
  let maxActive = 0
  const read = vi.fn(async (id: string) => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 25_000))
    active--
    return artifacts.find(({ definitionId }) => definitionId === id)
      ?.json as string
  })
  const pending = loadResearchQuestionnaires(source, { read })
  await vi.advanceTimersByTimeAsync(75_000)
  const archive = await pending
  expect(maxActive).toBe(QUESTIONNAIRE_ARCHIVE_MAX_CONCURRENCY)
  expect(read).toHaveBeenCalledTimes(9)
  expect(Object.keys(archive.definitions)).toEqual(
    artifacts.map(({ definitionId }) => definitionId).sort(),
  )
  expect(Object.values(archive.files)).toHaveLength(9)
})

it("rejects at the total deadline even when a dependency ignores abort, without scheduling queued reads", async () => {
  mockDeadline()
  const { source } = multipleDefinitions(5)
  const signals: AbortSignal[] = []
  const read = vi.fn((_id: string, signal: AbortSignal) => {
    signals.push(signal)
    return new Promise<string>(() => {})
  })
  const rejected = expect(
    loadResearchQuestionnaires(source, { read }),
  ).rejects.toThrow("Deadline exceeded")
  await vi.advanceTimersByTimeAsync(QUESTIONNAIRE_ARCHIVE_TIMEOUT_MS)
  await rejected
  expect(signals.every((signal) => signal.aborted === true)).toBe(true)
  expect(read).toHaveBeenCalledTimes(QUESTIONNAIRE_ARCHIVE_MAX_CONCURRENCY)
})

it.each(["cancelled", "failed"])(
  "aborts peers and leaves queued definitions unread when an archive is %s",
  async (failure) => {
    const { source } = multipleDefinitions(5)
    const controller = new AbortController()
    const first = Promise.withResolvers<string>()
    const signals: AbortSignal[] = []
    const read = vi.fn((_id: string, signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1
        ? first.promise
        : new Promise<string>(() => {})
    })
    const rejected = expect(
      loadResearchQuestionnaires(source, { read, signal: controller.signal }),
    ).rejects.toThrow(failure)
    if (failure === "cancelled") controller.abort(new Error(failure))
    else first.reject(new Error(failure))
    await rejected
    expect(signals.every((signal) => signal.aborted === true)).toBe(true)
    expect(read).toHaveBeenCalledTimes(QUESTIONNAIRE_ARCHIVE_MAX_CONCURRENCY)
  },
)

it("passes the shared cancellation signal and per-request timeout to the storage client", async () => {
  storageRequest.mockResolvedValueOnce({ data: artifact.json })
  const controller = new AbortController()
  expect(
    await readArchivedQuestionnaire(artifact.definitionId, controller.signal),
  ).toBe(artifact.json)
  expect(storageRequest).toHaveBeenLastCalledWith(
    expect.objectContaining({
      signal: controller.signal,
      timeout: QUESTIONNAIRE_READ_TIMEOUT_MS,
      responseType: "text",
    }),
  )
})

it("stops queued reads immediately when a concurrent definition is corrupt", async () => {
  const { source, artifacts } = multipleDefinitions(9)
  const read = vi
    .fn(
      async (id: string) =>
        artifacts.find(({ definitionId }) => definitionId === id)
          ?.json as string,
    )
    .mockResolvedValueOnce("{}")
  await expect(loadResearchQuestionnaires(source, { read })).rejects.toThrow()
  expect(read).toHaveBeenCalledTimes(QUESTIONNAIRE_ARCHIVE_MAX_CONCURRENCY)
})
