/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import SectionThanks from "@/features/home-flow/section-thanks"
import { createPseudonym } from "@/features/identity/participant-identifiers"
import { sealSessionData } from "@/lib/session-seal"
import {
  readStoredResult,
  writeStoredResult,
} from "../../../test-support/browser-state"
import { AppContextProvider, useAppContext } from "./app-context-provider"
import { RootStep } from "./root-step-types"
import { Stage } from "./stage-types"

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }))
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: getSessionMock,
  getSessionForTab: getSessionMock,
}))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({ updateStatusMessage: vi.fn() }),
}))

const ANALYSIS_ID_A = `aerpp:aid-${"a".repeat(32)}`
const ANALYSIS_ID_B = `aerpp:aid-${"b".repeat(32)}`
const session = {
  stage: Stage.followUp,
  rootStep: RootStep.thanks,
  lastCompletedAnalysisId: ANALYSIS_ID_A,
  submittedAnalysisId: ANALYSIS_ID_A,
  clientId: `aerpp:cid-${"c".repeat(32)}`,
  email: "user@example.com",
  pseudonym: createPseudonym("user@example.com"),
  authVerifiedAt: "2026-09-01T00:00:00.000Z",
  save: vi.fn(),
}
let container: HTMLDivElement
let root: Root
let context: ReturnType<typeof useAppContext>
function Probe() {
  context = useAppContext()
  return <SectionThanks />
}
async function sealResult(analysisId: string) {
  const sealed = await sealSessionData({
    ownerClientId: session.clientId,
    ownerPseudonym: session.pseudonym,
    result: {
      analysisId,
      text: "Retained result",
      analysisWorkspaceVersion: "1.0.0",
      modelName: "local-model",
      processingDurationSeconds: 1,
      documentCount: 1,
      documentGraphemeCount: 10,
      resultGraphemeCount: 10,
      pendingSurveyAnswer: { feedback: "Retained original answer" },
    },
  })
  if (!sealed) throw new Error("Synthetic envelope missing")
  return sealed
}
async function renderThanks(waitForRestore = true) {
  await act(async () => {
    root.render(
      <AppContextProvider
        initialStepState={{ stage: Stage.followUp, step: RootStep.thanks }}
      >
        <Probe />
      </AppContextProvider>,
    )
  })
  await vi.waitFor(async () => {
    await act(async () => {})
    if (waitForRestore) expect(context.isRestoringResult).toBe(false)
    else expect(getSessionMock).toHaveBeenCalled()
  })
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  session.lastCompletedAnalysisId = ANALYSIS_ID_A
  session.save.mockReset()
  getSessionMock.mockReset().mockResolvedValue(session)
  window.localStorage.clear()
  await writeStoredResult(await sealResult(ANALYSIS_ID_A))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

it("retains a sealed submitted result on thanks-page reload after response loss", async () => {
  await renderThanks()
  expect(await readStoredResult()).not.toBeNull()
  expect(context.result?.surveySubmitted).toBe(true)
  expect(context.surveyAnswer).toEqual({})
  expect(context.resultRestorationFailed).toBe(false)
  expect(context.rootStep).toBe(RootStep.thanks)
  expect(session.save).not.toHaveBeenCalled()
})

it("preserves another analysis in storage when the thanks session confirms only A", async () => {
  const sealedB = await sealResult(ANALYSIS_ID_B)
  await writeStoredResult(sealedB)
  await renderThanks()
  expect(await readStoredResult()).toBe(sealedB)
  expect(context.rootStep).toBe(RootStep.thanks)
  expect(session.save).not.toHaveBeenCalled()
})

it("does not delete a newer result saved during the confirmation read", async () => {
  let finish!: (value: typeof session) => void
  getSessionMock.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await renderThanks(false)
  const sealedB = await sealResult(ANALYSIS_ID_B)
  await writeStoredResult(sealedB)
  await act(async () => {
    finish(session)
  })
  expect(await readStoredResult()).toBe(sealedB)
  expect(context.rootStep).toBe(RootStep.thanks)
})

it("reports read failures without asking for survey resubmission", async () => {
  getSessionMock.mockRejectedValueOnce(new Error("session unavailable"))
  const stored = await readStoredResult()
  await renderThanks()
  expect(await readStoredResult()).toBe(stored)
  expect(context.rootStep).toBe(RootStep.thanks)
  expect(context.resultRestorationFailed).toBe(true)
  expect(container.textContent).toContain("再送信は不要")
  expect(session.save).not.toHaveBeenCalled()
})

vi.mock("@/features/session/use-session-admission", () => ({
  useSessionAdmission: () => ({
    status: "ready",
    initialStep: null,
  }),
}))

vi.mock("next/navigation", () => ({ usePathname: () => "/" }))

vi.mock("@/lib/session-seal", () => ({
  sealSessionData: async (value: unknown) => JSON.stringify(value),
  unsealSessionData: async (value: string) => JSON.parse(value),
}))

vi.mock("@/features/llm/actions-record-presentation", () => ({
  recordResultPresentationAction: vi.fn(async () => ({ ok: true })),
}))
