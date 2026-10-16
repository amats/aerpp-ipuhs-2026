/** @vitest-environment jsdom */
import { IDBObjectStore } from "fake-indexeddb"
import { beforeEach, expect, it, vi } from "vitest"
import {
  getBrowserSession,
  readBrowserPayload,
  replaceBrowserPayload,
} from "@/lib/browser-session"
import { initialDefinitionId } from "../../../test-support/questionnaires"
import {
  invalidateAnalysisResultStorageOperations,
  prepareSurveySubmissionInBrowser,
  readAnalysisResultFromBrowser,
  saveAnalysisResultInBrowser,
} from "./analysis-result-storage"

const { seal, unseal, sealSurvey } = vi.hoisted(() => ({
  seal: vi.fn(),
  unseal: vi.fn(),
  sealSurvey: vi.fn(),
}))
vi.mock("./actions-analysis-result-seal", () => ({
  sealAnalysisResultAction: seal,
  unsealAnalysisResultAction: unseal,
  sealSurveyResultAction: sealSurvey,
}))
vi.mock("@/lib/tab-cancellation", () => ({
  awaitTabResponse: (p: Promise<unknown>) => p,
  isTabOperationCurrent: () => true,
}))
vi.mock("@/lib/tab-token", () => ({ getTabToken: () => "current-token" }))
const validResult = {
  analysisId: "analysis_123",
  analysisWorkspaceVersion: "1.0.0",
  modelName: "test-model",
  processingDurationSeconds: 12,
  documentCount: 2,
  documentGraphemeCount: 345,
  resultGraphemeCount: 678,
  text: "analysis text",
}
const put = async (value: string | null) => {
  const snapshot = await readBrowserPayload("analysisResult")
  expect(await replaceBrowserPayload("analysisResult", snapshot, value)).toBe(
    true,
  )
}
const stored = async () => (await readBrowserPayload("analysisResult")).value
beforeEach(async () => {
  vi.restoreAllMocks()
  seal.mockReset()
  unseal.mockReset()
  sealSurvey.mockReset()
  localStorage.clear()
  await getBrowserSession()
  seal.mockResolvedValue("sealed-result")
  unseal.mockResolvedValue({ ok: true, result: validResult })
  sealSurvey.mockResolvedValue({ ok: true, sealedResult: "sealed-survey" })
})

it("commits encrypted results and removes null or blank results", async () => {
  expect(await saveAnalysisResultInBrowser(validResult)).toEqual({ ok: true })
  expect(await stored()).toBe("sealed-result")
  for (const value of [null, { ...validResult, text: " " }]) {
    expect(await saveAnalysisResultInBrowser(value)).toEqual({ ok: true })
    expect(await stored()).toBeNull()
  }
  expect(localStorage.length).toBe(0)
})
it.each(["open", "get", "put"] as const)(
  "reports storage %s failure without changing the saved result",
  async (boundary) => {
    await put("original")
    const fail = () => {
      throw new DOMException("blocked", "SecurityError")
    }
    const spy =
      boundary === "open"
        ? vi.spyOn(indexedDB, "open").mockImplementationOnce(fail)
        : vi
            .spyOn(IDBObjectStore.prototype, boundary)
            .mockImplementationOnce(fail)
    expect(await saveAnalysisResultInBrowser(validResult)).toEqual({
      ok: false,
      reason: "write_failed",
    })
    spy.mockRestore()
    expect(await stored()).toBe("original")
  },
)
it("keeps the old result when encryption fails", async () => {
  await put("original")
  seal.mockResolvedValueOnce(null)
  expect(await saveAnalysisResultInBrowser(validResult)).toEqual({
    ok: false,
    reason: "write_failed",
  })
  expect(await stored()).toBe("original")
})
it.each([
  {
    pendingSurveyAnswer: { q1: "original" },
    pendingQuestionnaireId: initialDefinitionId,
  },
  { pendingSurveyAnswer: {} },
  { surveySubmitted: true },
  { analysisId: "another-analysis" },
])(
  "preserves existing result progress %j before completion re-save",
  async (progress) => {
    const saved = { ...validResult, ...progress }
    await put("original")
    unseal.mockResolvedValue({ ok: true, result: saved })
    expect(await saveAnalysisResultInBrowser(validResult)).toEqual({
      ok: false,
      reason: "storage_changed",
    })
    expect(seal).not.toHaveBeenCalled()
    expect(await stored()).toBe("original")
    expect(await readAnalysisResultFromBrowser()).toEqual({
      ok: true,
      result: saved,
    })
  },
)
it("preserves a submission confirmed only by the server", async () => {
  await put("original")
  unseal.mockResolvedValueOnce({
    ok: true,
    result: validResult,
    surveySubmitted: true,
  })
  expect(await saveAnalysisResultInBrowser(validResult)).toEqual({
    ok: false,
    reason: "storage_changed",
  })
  expect(seal).not.toHaveBeenCalled()
  expect(await stored()).toBe("original")
})
it.each([validResult, null])(
  "allows completion retry after inspecting a plain or invalid saved result",
  async (result) => {
    await put("original")
    unseal.mockResolvedValueOnce({ ok: true, result })
    expect(await saveAnalysisResultInBrowser(validResult)).toEqual({ ok: true })
    expect(await stored()).toBe("sealed-result")
  },
)
it.each([false, undefined, null, "false", "true", 1, {}, []])(
  "does not overwrite when the saved result read is not confirmed (%j)",
  async (ok) => {
    await put("original")
    unseal.mockResolvedValueOnce({ ok, result: validResult })
    expect(await saveAnalysisResultInBrowser(validResult)).toEqual({
      ok: false,
      reason: "write_failed",
    })
    expect(seal).not.toHaveBeenCalled()
    expect(await stored()).toBe("original")
  },
)
it.each(["transport", "invalid-payload"])(
  "preserves saved data after inspection %s",
  async (failure) => {
    await put("original")
    if (failure === "transport")
      unseal.mockRejectedValueOnce(new Error("unavailable"))
    else
      unseal.mockResolvedValueOnce({
        ok: true,
        result: { text: "missing metadata" },
      })
    expect(await saveAnalysisResultInBrowser(validResult)).toEqual({
      ok: false,
      reason: "write_failed",
    })
    expect(seal).not.toHaveBeenCalled()
    expect(await stored()).toBe("original")
  },
)
it("does not overwrite answers frozen while inspecting a plain result", async () => {
  await put("original")
  const pending = Promise.withResolvers<{
    ok: true
    result: typeof validResult
  }>()
  unseal.mockReturnValueOnce(pending.promise)
  const saving = saveAnalysisResultInBrowser(validResult)
  await vi.waitFor(() => expect(unseal).toHaveBeenCalled())
  await put("frozen-answers")
  pending.resolve({ ok: true, result: validResult })
  expect(await saving).toEqual({ ok: false, reason: "storage_changed" })
  expect(await stored()).toBe("frozen-answers")
})
it.each(["invalidate", "abort"])(
  "stops before sealing after %s during saved-result inspection",
  async (operation) => {
    await put("original")
    const pending = Promise.withResolvers<{
      ok: true
      result: typeof validResult
    }>()
    unseal.mockReturnValueOnce(pending.promise)
    const controller = new AbortController()
    const saving = saveAnalysisResultInBrowser(validResult, controller.signal)
    await vi.waitFor(() => expect(unseal).toHaveBeenCalled())
    if (operation === "invalidate") invalidateAnalysisResultStorageOperations()
    else controller.abort()
    pending.resolve({ ok: true, result: validResult })
    expect(await saving).toEqual({ ok: false, reason: "cancelled" })
    expect(seal).not.toHaveBeenCalled()
    expect(await stored()).toBe("original")
  },
)
it.each(["replacement", "clear-and-restore"])(
  "rejects %s during encryption, including an ABA change",
  async (change) => {
    await put("original")
    const pending = Promise.withResolvers<string>()
    seal.mockReturnValueOnce(pending.promise)
    const saving = saveAnalysisResultInBrowser(validResult)
    await vi.waitFor(() => expect(seal).toHaveBeenCalled())
    await put(change === "replacement" ? "newer" : null)
    if (change === "clear-and-restore") await put("original")
    pending.resolve("old")
    expect(await saving).toEqual({ ok: false, reason: "storage_changed" })
    expect(await stored()).toBe(change === "replacement" ? "newer" : "original")
  },
)
it.each(["clear", "invalidate", "abort"])(
  "does not save after %s",
  async (operation) => {
    const pending = Promise.withResolvers<string>()
    seal.mockReturnValueOnce(pending.promise)
    const controller = new AbortController()
    const saving = saveAnalysisResultInBrowser(validResult, controller.signal)
    await vi.waitFor(() => expect(seal).toHaveBeenCalled())
    if (operation === "clear") await saveAnalysisResultInBrowser(null)
    if (operation === "invalidate") invalidateAnalysisResultStorageOperations()
    if (operation === "abort") controller.abort()
    pending.resolve("old")
    expect(await saving).toEqual({ ok: false, reason: "cancelled" })
    expect(await stored()).toBeNull()
  },
)
it("reads absent, valid and confirmed-submitted results", async () => {
  expect(await readAnalysisResultFromBrowser()).toEqual({
    ok: true,
    result: null,
  })
  await put("saved")
  expect(await readAnalysisResultFromBrowser()).toEqual({
    ok: true,
    result: validResult,
  })
  unseal.mockResolvedValueOnce({
    ok: true,
    result: validResult,
    surveySubmitted: true,
  })
  expect(await readAnalysisResultFromBrowser()).toEqual({
    ok: true,
    result: { ...validResult, surveySubmitted: true },
  })
})
it.each([null, { text: "missing metadata" }])(
  "removes a confirmed invalid result %j",
  async (result) => {
    await put("corrupt")
    unseal.mockResolvedValueOnce({ ok: true, result })
    expect(await readAnalysisResultFromBrowser()).toEqual({
      ok: true,
      result: null,
    })
    expect(await stored()).toBeNull()
  },
)
it.each(["unavailable", "transport"])(
  "preserves saved data after decryption %s",
  async (failure) => {
    await put("saved")
    if (failure === "unavailable") unseal.mockResolvedValueOnce({ ok: false })
    else unseal.mockRejectedValueOnce(new Error("unavailable"))
    expect(await readAnalysisResultFromBrowser()).toEqual({ ok: false })
    expect(await stored()).toBe("saved")
  },
)
it("does not remove a newer result after a late invalid read", async () => {
  await put("old")
  const pending = Promise.withResolvers<{ ok: true; result: null }>()
  unseal.mockReturnValueOnce(pending.promise)
  const reading = readAnalysisResultFromBrowser()
  await vi.waitFor(() => expect(unseal).toHaveBeenCalled())
  await put("newer")
  pending.resolve({ ok: true, result: null })
  expect(await reading).toEqual({ ok: false })
  expect(await stored()).toBe("newer")
})
it.each(["read", "cleanup"])(
  "keeps storage errors observable during %s",
  async (boundary) => {
    await put("corrupt")
    unseal.mockResolvedValueOnce({ ok: true, result: null })
    const spy = vi
      .spyOn(IDBObjectStore.prototype, boundary === "read" ? "get" : "put")
      .mockImplementationOnce(() => {
        throw new Error("blocked")
      })
    expect(await readAnalysisResultFromBrowser()).toEqual({ ok: false })
    spy.mockRestore()
    expect(await stored()).toBe("corrupt")
  },
)
it.each(["newer result", "invalidate"])(
  "rejects freezing after %s",
  async (change) => {
    await put("original")
    const pending = Promise.withResolvers<{ ok: true; sealedResult: string }>()
    sealSurvey.mockReturnValueOnce(pending.promise)
    const preparing = prepareSurveySubmissionInBrowser(
      validResult,
      { q1: "answer" },
      initialDefinitionId,
    )
    await vi.waitFor(() => expect(sealSurvey).toHaveBeenCalled())
    if (change === "invalidate") invalidateAnalysisResultStorageOperations()
    else await put("newer")
    pending.resolve({ ok: true, sealedResult: "late" })
    expect(await preparing).toEqual({ ok: false, reason: "storage_changed" })
    expect(await stored()).not.toBe("late")
  },
)
it.each(["questionnaire_check_failed", "questionnaire_changed", "transport"])(
  "leaves answers editable after %s",
  async (reason) => {
    await put("original")
    if (reason === "transport")
      sealSurvey.mockRejectedValueOnce(new Error("lost"))
    else sealSurvey.mockResolvedValueOnce({ ok: false, reason })
    expect(
      await prepareSurveySubmissionInBrowser(
        validResult,
        { q1: "answer" },
        initialDefinitionId,
      ),
    ).toEqual({
      ok: false,
      reason: reason === "transport" ? "questionnaire_check_failed" : reason,
    })
    expect(await stored()).toBe("original")
  },
)
it.each([undefined, `jcs-v1:sha256:${"b".repeat(64)}`])(
  "does not rebind a frozen definition %s",
  async (pendingQuestionnaireId) => {
    await put("original")
    unseal.mockResolvedValueOnce({
      ok: true,
      result: {
        ...validResult,
        pendingSurveyAnswer: { q1: "old" },
        pendingQuestionnaireId,
      },
    })
    expect(
      await prepareSurveySubmissionInBrowser(
        validResult,
        { q1: "new" },
        initialDefinitionId,
      ),
    ).toEqual({ ok: false, reason: "questionnaire_changed" })
    expect(sealSurvey).not.toHaveBeenCalled()
    expect(await stored()).toBe("original")
  },
)
it("admits one concurrent freeze and retries exactly its saved answers after reload", async () => {
  await put(JSON.stringify(validResult))
  unseal.mockImplementation(async (value) => ({
    ok: true,
    result: JSON.parse(value),
  }))
  const barrier = Promise.withResolvers<void>()
  sealSurvey.mockImplementation(async (result) => {
    await barrier.promise
    return { ok: true, sealedResult: JSON.stringify(result) }
  })
  const first = prepareSurveySubmissionInBrowser(
    validResult,
    { q1: "A" },
    initialDefinitionId,
  )
  const second = prepareSurveySubmissionInBrowser(
    validResult,
    { q1: "B" },
    initialDefinitionId,
  )
  await vi.waitFor(() => expect(sealSurvey).toHaveBeenCalledTimes(2))
  barrier.resolve()
  const results = await Promise.all([first, second])
  expect(results.filter((result) => result.ok === true)).toHaveLength(1)
  const winner = results.find((result) => result.ok === true)
  const retry = await prepareSurveySubmissionInBrowser(
    validResult,
    { q1: "edited" },
    initialDefinitionId,
  )
  expect(retry).toEqual(winner)
  expect(JSON.parse((await stored()) as string).pendingSurveyAnswer).toEqual(
    winner?.ok === true ? winner.result.pendingSurveyAnswer : null,
  )
})
