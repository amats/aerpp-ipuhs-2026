/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  explanation: vi.fn(),
  plan: vi.fn(),
}))
vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: mocks.context,
}))
vi.mock("@/features/pdf/document-client", () => ({
  requestExplanationPdf: mocks.explanation,
  requestPlanPdf: mocks.plan,
}))
vi.mock("./document-history", () => ({
  default: () => <div data-history="true">今回の同意・撤回</div>,
}))
vi.mock("@/features/pdf/download-pdf", () => ({
  downloadPdf: (loadPdf: () => Promise<unknown>) => loadPdf(),
}))

import DownloadPage from "./download-page"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockReturnValue({
    stage: Stage.unauthenticated,
    sessionAdmission: "ready",
  })
})

async function renderPage() {
  const container = document.createElement("div")
  const root = createRoot(container)
  await act(async () =>
    root.render(<DownloadPage contactEmail="research@example.invalid" />),
  )
  return { container, root }
}

it.each([Stage.authenticated, Stage.followUp, Stage.withdrawn])(
  "prioritizes the selected history and permits current plan downloads in %s",
  async (stage) => {
    mocks.context.mockReturnValue({ stage, sessionAdmission: "ready" })
    const { container } = await renderPage()
    expect(container.querySelector("[data-history]")).not.toBeNull()
    expect(container.textContent?.indexOf("今回の同意・撤回")).toBeLessThan(
      container.textContent?.indexOf("現在公開中の書類") ?? 0,
    )
    const plan = container.querySelector<HTMLButtonElement>(
      'button[aria-label="研究計画書：PDFをダウンロード"]',
    ) as HTMLButtonElement
    expect(plan.disabled).toBe(false)
    await act(async () => plan.click())
    expect(mocks.plan).toHaveBeenCalledTimes(1)
  },
)

it.each([Stage.unauthenticated, Stage.confirmationSent])(
  "shows public documents first and never asserts an accepted consent in %s",
  async (stage) => {
    mocks.context.mockReturnValue({ stage, sessionAdmission: "ready" })
    const { container } = await renderPage()
    expect(container.querySelector("[data-history]")).toBeNull()
    expect(container.textContent).toContain("書類の版：v1.0")
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="研究計画書：PDFをダウンロード"]',
      )?.disabled,
    ).toBe(true)
    const explanation = container.querySelector<HTMLButtonElement>(
      'button[aria-label="説明文書：PDFをダウンロード"]',
    ) as HTMLButtonElement
    expect(explanation.disabled).toBe(false)
    await act(async () => explanation.click())
    expect(mocks.explanation).toHaveBeenCalledTimes(1)
    expect(
      container.querySelector('a[href="mailto:research@example.invalid"]'),
    ).not.toBeNull()
    expect(container.textContent).not.toContain("履歴がありません")
    expect(container.textContent).toContain(
      stage === Stage.confirmationSent
        ? "メール認証待ち"
        : "このブラウザーでは同意履歴を確認できません",
    )
  },
)

it.each(["checking", "unavailable"])(
  "keeps protected downloads disabled while session admission is %s",
  async (sessionAdmission) => {
    mocks.context.mockReturnValue({
      stage: Stage.authenticated,
      sessionAdmission,
    })
    const { container } = await renderPage()
    expect(container.textContent).toContain(
      sessionAdmission === "checking"
        ? "利用状態を確認しています。"
        : "利用状態を確認できません。上の同意履歴の案内に従ってください。",
    )
    const plan = container.querySelector<HTMLButtonElement>(
      'button[aria-label="研究計画書：PDFをダウンロード"]',
    ) as HTMLButtonElement
    expect(plan.disabled).toBe(true)
    await act(async () => plan.click())
    expect(mocks.plan).not.toHaveBeenCalled()
  },
)
