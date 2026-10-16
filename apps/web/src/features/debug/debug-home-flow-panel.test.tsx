/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { writeStoredResult } from "../../../test-support/browser-state"

const useAppContextMock = vi.fn()

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => useAppContextMock(),
}))

vi.mock("@/ui/card-panel", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

describe("DebugHomeFlowPanel", () => {
  let container: HTMLDivElement

  beforeEach(async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    useAppContextMock.mockReset()
    useAppContextMock.mockReturnValue({
      stage: "authenticated",
      rootStep: "result",
      analysisJob: {
        jobId: "job-1",
        documents: {},
      },
      result: {
        analysisId: "analysis-1",
      },
      isRestoringResult: false,
      resultRestorationFailed: false,
      withdrawalCleanupStatus: "unconfirmed",
      sessionAdmission: "ready",
      surveyAnswer: {
        q1: "7",
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("shows home flow metadata without exposing stored analysis content", async () => {
    await writeStoredResult("private-result-value")

    const { default: DebugHomeFlowPanel } = await import(
      "./debug-home-flow-panel"
    )
    const root = createRoot(container)

    await act(async () => {
      root.render(<DebugHomeFlowPanel />)
    })

    expect(container.textContent).toContain('"appContext": {')
    expect(container.textContent).toContain('"rootStep": "result"')
    expect(container.textContent).toContain('"analysisJobId": "job-1"')
    expect(container.textContent).toContain('"analysisId": "analysis-1"')
    expect(container.textContent).toContain('"hasResult": true')
    expect(container.textContent).toContain('"sessionAdmission": "ready"')
    expect(container.textContent).toContain(
      '"withdrawalCleanupStatus": "unconfirmed"',
    )
    expect(container.textContent).toContain('"surveyAnswerKeys": [')
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toContain('"browserResult": "present"')
    })
    expect(container.textContent).not.toContain("private-result-value")
  })
  it("reports unavailable storage without hiding the debug panel", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("unavailable", "SecurityError")
    })
    const { default: Panel } = await import("./debug-home-flow-panel")
    const root = createRoot(container)
    await act(async () => root.render(<Panel />))
    expect(container.textContent).toContain('"browserResult": "unavailable"')
    expect(container.textContent).toContain('"appContext": {')
    await act(async () => root.unmount())
  })
})
