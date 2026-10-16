/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest"
import {
  captureBrowserAnalysis,
  clearBrowserAnalysis,
  commitBrowserAdmission,
  getBrowserSession,
} from "@/lib/browser-session"
import {
  activateTabOperations,
  cancelTabOperations,
  getTabOperationSignal,
  waitForTabOperation,
} from "@/lib/tab-cancellation"
import {
  readStoredResult,
  writeStoredResult,
} from "../../../test-support/browser-state"
import { unsealAnalysisResultAction } from "./actions-analysis-result-seal"
import {
  readAnalysisResultFromBrowser,
  saveAnalysisResultInBrowser,
} from "./analysis-result-storage"

vi.mock("@/features/llm/actions-analysis-result-seal", () => ({
  sealSurveyResultAction: vi.fn(),
  sealAnalysisResultAction: vi.fn(),
  unsealAnalysisResultAction: vi.fn(),
}))

it("ends result restoration on takeover without waiting for decryption", async () => {
  localStorage.clear()
  await writeStoredResult("saved-result")
  activateTabOperations(`${await getBrowserSession()}:${"a".repeat(64)}`)
  const response =
    Promise.withResolvers<
      Awaited<ReturnType<typeof unsealAnalysisResultAction>>
    >()
  vi.mocked(unsealAnalysisResultAction).mockReturnValueOnce(response.promise)
  const restoring = readAnalysisResultFromBrowser()
  await vi.waitFor(() => expect(unsealAnalysisResultAction).toHaveBeenCalled())
  cancelTabOperations()
  expect(await restoring).toEqual({ ok: false })
  response.resolve({ ok: true, result: null })
  await Promise.resolve()
  expect(await readStoredResult()).toBe("saved-result")
})

it("rejects an old response and cleanup after the persisted generation changes", async () => {
  localStorage.clear()
  const original = await getBrowserSession()
  activateTabOperations(`${original}:${"a".repeat(64)}`)
  const cleanup = await captureBrowserAnalysis()
  const pending = Promise.withResolvers<{ ok: true }>()
  const signal = getTabOperationSignal()
  const waiting = waitForTabOperation(pending.promise)
  await commitBrowserAdmission(
    original,
    "22222222-2222-2222-2222-222222222222",
    true,
  )
  await writeStoredResult("replacement-result")
  pending.resolve({ ok: true })
  expect(await waiting).toEqual({ ok: false, reason: "superseded_operation" })
  expect(signal?.aborted).toBe(true)
  expect(await saveAnalysisResultInBrowser(null)).toEqual({
    ok: false,
    reason: "cancelled",
  })
  expect(await clearBrowserAnalysis(cleanup)).toBe(false)
  expect(await readStoredResult()).toBe("replacement-result")
})
