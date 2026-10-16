/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"
import { setTabToken } from "@/lib/tab-token"

const resendConsentEmailActionMock = vi.fn()
vi.mock("@/features/app-context/actions-step-state", () => ({
  resendConsentEmailAction: resendConsentEmailActionMock,
}))
const confirmAuthenticationMock = vi.fn()
const correctConsentEmailMock = vi.fn()
const moveToExplanationMock = vi.fn()
const resetToStartMock = vi.fn()
const prepareNewAnalysisMock = vi.fn()
const updateStatusMock = vi.fn()
const downloadPdfMock = vi.fn()
const requestConsentPdfMock = vi.fn()
const appContextValue: {
  correctConsentEmail: typeof correctConsentEmailMock
  confirmAuthentication: typeof confirmAuthenticationMock
  moveToExplanation: typeof moveToExplanationMock
  resetToStart: typeof resetToStartMock
  prepareNewAnalysis: typeof prepareNewAnalysisMock
  stage: Stage
} = {
  confirmAuthentication: confirmAuthenticationMock,
  correctConsentEmail: correctConsentEmailMock,
  moveToExplanation: moveToExplanationMock,
  resetToStart: resetToStartMock,
  prepareNewAnalysis: prepareNewAnalysisMock,
  stage: Stage.confirmationSent,
}

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => appContextValue,
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({
    updateStatusMessage: updateStatusMock,
  }),
}))

vi.mock("@/features/pdf/download-pdf", () => ({
  downloadPdf: downloadPdfMock,
}))

vi.mock("@/features/pdf/document-client", () => ({
  requestConsentPdf: requestConsentPdfMock,
}))

vi.mock("@/ui/card-section", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/section-heading", () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

describe("SectionAuth", () => {
  let container: HTMLDivElement

  function getContinueButton() {
    const buttons = container.querySelectorAll("button")

    return (
      Array.from(buttons).find((button) => button.textContent === "次に進む") ??
      null
    )
  }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    appContextValue.stage = Stage.confirmationSent
    resendConsentEmailActionMock.mockReset()
    confirmAuthenticationMock.mockReset()
    correctConsentEmailMock.mockReset().mockResolvedValue({ ok: true })
    moveToExplanationMock.mockReset()
    resetToStartMock.mockReset()
    prepareNewAnalysisMock.mockReset()
    updateStatusMock.mockReset()
    downloadPdfMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  it("limits resends, disables authentication while sending, and keeps retry failures visible", async () => {
    vi.useFakeTimers()
    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)
    await act(async () => root.render(<SectionAuth />))
    const resend = () =>
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("再送"),
      ) as HTMLButtonElement
    expect(resend().disabled).toBe(true)
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(resend().disabled).toBe(false)
    const pending = Promise.withResolvers<{ ok: false; reason: string }>()
    resendConsentEmailActionMock.mockReturnValueOnce(pending.promise)
    await act(async () => resend().click())
    expect(resend().disabled).toBe(true)
    expect(getContinueButton()?.disabled).toBe(true)
    await act(async () =>
      pending.resolve({ ok: false, reason: "send_rate_limited" }),
    )
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("1時間に5回"),
        tone: "error",
      }),
    )
    expect(resend().disabled).toBe(true)
    await act(async () => vi.advanceTimersByTime(60_000))
    resendConsentEmailActionMock.mockResolvedValueOnce({ ok: true })
    await act(async () => resend().click())
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("再送を受け付けました"),
      }),
    )
    expect(confirmAuthenticationMock).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it("does not publish a late resend result after leaving the authentication screen", async () => {
    vi.useFakeTimers()
    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)
    await act(async () => root.render(<SectionAuth />))
    await act(async () => vi.advanceTimersByTime(60_000))
    const pending = Promise.withResolvers<{ ok: true }>()
    resendConsentEmailActionMock.mockReturnValueOnce(pending.promise)
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "認証メールを再送")
        ?.click(),
    )
    await act(async () => root.unmount())
    await act(async () => pending.resolve({ ok: true }))
    expect(updateStatusMock).not.toHaveBeenCalled()
  })

  it("shows the configured sender and omits the sentence when absent", async () => {
    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <SectionAuth authenticationEmailSender="sender@example.invalid" />,
      )
    })
    expect(container.textContent).toContain(
      "メールは、sender@example.invalid から送信されます。",
    )
    await act(async () => root.render(<SectionAuth />))
    expect(container.textContent).not.toContain("から送信されます")
    await act(async () => root.unmount())
  })

  it("offers reload without resetting shared state when consent is not completed yet", async () => {
    appContextValue.stage = Stage.unauthenticated

    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionAuth />)
    })

    expect(container.textContent).toContain("ページを再読み込み")
    expect(container.textContent).toContain("入力中の書類")
    expect(resetToStartMock).not.toHaveBeenCalled()
    expect(confirmAuthenticationMock).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it("moves to the document step after successful authentication", async () => {
    confirmAuthenticationMock.mockResolvedValue({
      ok: true,
    })
    appContextValue.stage = Stage.confirmationSent

    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionAuth />)
    })

    await act(async () => {
      getContinueButton()?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(confirmAuthenticationMock).toHaveBeenCalled()
    expect(updateStatusMock).toHaveBeenCalledWith(null)
    expect(prepareNewAnalysisMock).not.toHaveBeenCalled()
    expect(downloadPdfMock).toHaveBeenCalledWith(requestConsentPdfMock, {
      ordinaryOperation: true,
    })
  })

  it.each([false, true])(
    "only reports optional receipt failure while its state is current (changed: %s)",
    async (changed) => {
      confirmAuthenticationMock.mockResolvedValue({ ok: true })
      setTabToken("receipt-generation:old-state")
      let reject!: (reason: Error) => void
      downloadPdfMock.mockReturnValue(
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
      )
      const { default: SectionAuth } = await import("./section-auth")
      const root = createRoot(container)
      try {
        await act(async () => root.render(<SectionAuth />))
        await act(async () => getContinueButton()?.click())
        updateStatusMock.mockClear()
        if (changed) setTabToken("receipt-generation:new-state")
        await act(async () => reject(new Error("Synthetic PDF failure")))
        if (changed) expect(updateStatusMock).not.toHaveBeenCalled()
        else
          expect(updateStatusMock).toHaveBeenCalledWith({
            message: expect.stringContaining("メール認証は完了しています"),
            tone: "warning",
          })
      } finally {
        await act(async () => root.unmount())
      }
    },
  )

  it("keeps confirmed authentication distinct from local cleanup failure", async () => {
    confirmAuthenticationMock.mockResolvedValue({
      ok: false,
      reason: "result_clear_failed",
    })
    appContextValue.stage = Stage.confirmationSent
    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<SectionAuth />))
      await act(async () => getContinueButton()?.click())
      expect(updateStatusMock).toHaveBeenCalledWith({
        message: expect.stringContaining("メール認証は完了しましたが"),
        tone: "warning",
        recovery: "reload",
      })
      expect(downloadPdfMock).not.toHaveBeenCalled()
      expect(prepareNewAnalysisMock).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it("shows a state update error when authentication preparation fails", async () => {
    confirmAuthenticationMock.mockResolvedValue({
      ok: false,
      reason: "step_state_write_failed",
    })
    appContextValue.stage = Stage.confirmationSent

    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionAuth />)
    })

    await act(async () => {
      getContinueButton()?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(updateStatusMock).toHaveBeenCalledWith({
      message: "状態の更新に失敗しました。時間をおいて再度お試しください。",
      tone: "error",
    })
    expect(prepareNewAnalysisMock).not.toHaveBeenCalled()
  })

  it("releases the busy state and allows retry after a server-action network failure", async () => {
    confirmAuthenticationMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true })
    appContextValue.stage = Stage.confirmationSent
    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)
    await act(async () => {
      root.render(<SectionAuth />)
    })
    await act(async () => {
      getContinueButton()?.click()
    })
    expect(getContinueButton()?.disabled).toBe(false)
    expect(getContinueButton()?.textContent).toBe("次に進む")
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error" }),
    )
    expect(downloadPdfMock).not.toHaveBeenCalled()
    await act(async () => {
      getContinueButton()?.click()
    })
    expect(confirmAuthenticationMock).toHaveBeenCalledTimes(2)
    expect(downloadPdfMock).toHaveBeenCalledTimes(1)
    expect(updateStatusMock).toHaveBeenLastCalledWith(null)
  })
  it("offers immediate email correction while resend is waiting", async () => {
    const { default: SectionAuth } = await import("./section-auth")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<SectionAuth />))
      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      )
      const correction = buttons.find(
        (button) => button.textContent === "メールアドレスを訂正する",
      )
      expect(correction?.disabled).toBe(false)
      await act(async () => correction?.click())
      expect(correctConsentEmailMock).toHaveBeenCalledOnce()
      expect(resendConsentEmailActionMock).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })
  it.each([
    ["auth_expired", "有効期限が切れています", true],
    ["auth_superseded", "復旧許可または参加状態の変更", true],
    ["auth_invalid", "このメール認証を確認できません", true],
    ["auth_unavailable", "通信状態を確認", false],
  ])(
    "explains %s without treating it as pending mail",
    async (reason, message, reset) => {
      confirmAuthenticationMock.mockResolvedValue({ ok: false, reason })
      appContextValue.stage = Stage.confirmationSent
      const { default: SectionAuth } = await import("./section-auth")
      const root = createRoot(container)
      try {
        await act(async () => root.render(<SectionAuth />))
        await act(async () => getContinueButton()?.click())
        expect(updateStatusMock).toHaveBeenCalledWith({
          message: expect.stringContaining(message),
          tone: "error",
        })
        expect(moveToExplanationMock).not.toHaveBeenCalled()
        expect(downloadPdfMock).not.toHaveBeenCalled()
        const restartButton = Array.from(
          container.querySelectorAll<HTMLButtonElement>("button"),
        ).find((button) => button.textContent === "同意手続きをやり直す")
        if (reset) {
          expect(restartButton).toBeDefined()
          await act(async () => restartButton?.click())
          expect(resetToStartMock).toHaveBeenCalledTimes(1)
        } else {
          expect(restartButton).toBeUndefined()
          expect(resetToStartMock).not.toHaveBeenCalled()
        }
      } finally {
        await act(async () => root.unmount())
      }
    },
  )
})
