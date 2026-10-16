/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest"
import {
  getBrowserSession,
  readBrowserPayload,
  replaceBrowserPayload,
} from "@/lib/browser-session"
import {
  clearRecoveredSurveyDraft,
  freezeRecoveredSurveyDraft,
} from "./survey-recovery-storage"

const { unseal, seal } = vi.hoisted(() => ({ unseal: vi.fn(), seal: vi.fn() }))
vi.mock("./actions-survey-recovery-seal", () => ({
  unsealRecoveredSurveyDraftAction: unseal,
  sealRecoveredSurveyDraftAction: seal,
}))
vi.mock("@/lib/tab-token", () => ({ getTabToken: () => "current-token" }))
vi.mock("@/lib/tab-cancellation", () => ({
  awaitTabResponse: (value: Promise<unknown>) => value,
  isTabOperationCurrent: () => true,
}))
const draft = {
  analysisId: "original-analysis",
  definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
  answers: { q1: "first frozen answer" },
}
const put = async (value: string) =>
  replaceBrowserPayload(
    "recoveredSurvey",
    await readBrowserPayload("recoveredSurvey"),
    value,
  )
beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  localStorage.clear()
  await getBrowserSession()
  unseal.mockImplementation(async (value) => ({
    ok: true,
    draft: JSON.parse(value),
  }))
  seal.mockImplementation(async (draft) => ({
    ok: true,
    sealed: JSON.stringify(draft),
  }))
})
it("retries the first frozen answers and clears only the matching envelope", async () => {
  await put(JSON.stringify(draft))
  const prepared = await freezeRecoveredSurveyDraft({
    ...draft,
    answers: { q1: "edited" },
  })
  expect(prepared.draft).toEqual(draft)
  expect(seal).not.toHaveBeenCalled()
  expect(await clearRecoveredSurveyDraft("different")).toBe(false)
  expect((await readBrowserPayload("recoveredSurvey")).value).not.toBeNull()
  expect(await clearRecoveredSurveyDraft(prepared.sealed)).toBe(true)
  expect((await readBrowserPayload("recoveredSurvey")).value).toBeNull()
  expect(await clearRecoveredSurveyDraft(prepared.sealed)).toBe(true)
})

it("late cleanup preserves a different recovered draft and an unrelated analysis result", async () => {
  const prepared = await freezeRecoveredSurveyDraft(draft)
  await put("replacement")
  await replaceBrowserPayload(
    "analysisResult",
    await readBrowserPayload("analysisResult"),
    "other-result",
  )
  expect(await clearRecoveredSurveyDraft(prepared.sealed)).toBe(false)
  expect((await readBrowserPayload("recoveredSurvey")).value).toBe(
    "replacement",
  )
  expect((await readBrowserPayload("analysisResult")).value).toBe(
    "other-result",
  )
})
it("rejects a replacement during a frozen-draft read", async () => {
  await put(JSON.stringify(draft))
  const pending = Promise.withResolvers<unknown>()
  unseal.mockReturnValueOnce(pending.promise)
  const preparing = freezeRecoveredSurveyDraft(draft)
  const checked = expect(preparing).rejects.toThrow("draft_conflict")
  await vi.waitFor(() => expect(unseal).toHaveBeenCalled())
  await put("replacement")
  pending.resolve({ ok: true, draft })
  await checked
  expect((await readBrowserPayload("recoveredSurvey")).value).toBe(
    "replacement",
  )
})
it("commits only one simultaneous first freeze and retains it for retry", async () => {
  const barrier = Promise.withResolvers<void>()
  seal.mockImplementation(async (draft) => {
    await barrier.promise
    return { ok: true, sealed: JSON.stringify(draft) }
  })
  const pending = Promise.allSettled([
    freezeRecoveredSurveyDraft(draft),
    freezeRecoveredSurveyDraft({ ...draft, answers: { q1: "other tab" } }),
  ])
  await vi.waitFor(() => expect(seal).toHaveBeenCalledTimes(2))
  barrier.resolve()
  const results = await pending
  expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(
    1,
  )
  const saved = (await readBrowserPayload("recoveredSurvey")).value
  expect((await freezeRecoveredSurveyDraft(draft)).sealed).toBe(saved)
})
