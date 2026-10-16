/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"

const downloadPdfMock = vi.fn()
const requestWithdrawalPdfMock = vi.fn()
const completeWithdrawalMock = vi.fn()
const routerPushMock = vi.fn()
const routerReplaceMock = vi.fn()
let currentStage: Stage = Stage.authenticated
let cleanupStatus = "unconfirmed"

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
  }),
}))

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => ({
    completeWithdrawal: completeWithdrawalMock,
    stage: currentStage,
    withdrawalCleanupStatus: cleanupStatus,
  }),
}))

vi.mock("@/features/pdf/download-pdf", () => ({
  downloadPdf: downloadPdfMock,
}))

vi.mock("@/features/pdf/document-client", () => ({
  requestWithdrawalPdf: requestWithdrawalPdfMock,
}))

vi.mock("@/assets/withdrawal.mdx", () => ({
  default: () => <div>withdrawal</div>,
}))

vi.mock("@/ui/alert-message", () => ({
  default: ({ children, id }: { children: React.ReactNode; id?: string }) => (
    <div id={id}>{children}</div>
  ),
}))

vi.mock("@/ui/card-section", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/email-action-row", () => ({
  default: ({
    onChange,
    onSubmit,
    disabled,
    buttonText,
  }: {
    email: string
    onChange: React.ChangeEventHandler<HTMLInputElement>
    onSubmit: () => void
    disabled: boolean
    inputId?: string
    buttonText: string
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onChange({
            target: { value: "invalid" },
          } as React.ChangeEvent<HTMLInputElement>)
        }
      >
        set-invalid-email
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({
            target: { value: "user@example.com" },
          } as React.ChangeEvent<HTMLInputElement>)
        }
      >
        set-valid-email
      </button>
      <button type="button" disabled={disabled} onClick={onSubmit}>
        {buttonText}
      </button>
    </div>
  ),
}))

vi.mock("@/ui/rich-text-block", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("@/ui/section-heading", () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

describe("WithdrawPage", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    currentStage = Stage.authenticated
    cleanupStatus = "unconfirmed"
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    downloadPdfMock.mockReset()
    completeWithdrawalMock.mockReset()
    routerPushMock.mockReset()
    routerReplaceMock.mockReset()
    completeWithdrawalMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  it.each(["pending", "localFailed", "complete"])(
    "keeps restored withdrawal terminal and offers contact and downloads with %s cleanup",
    async (status) => {
      currentStage = Stage.withdrawn
      cleanupStatus = status
      const { default: WithdrawPage } = await import("./withdraw-page")
      const root = createRoot(container)
      await act(async () =>
        root.render(<WithdrawPage contactEmail="support@example.invalid" />),
      )
      expect(routerReplaceMock).not.toHaveBeenCalled()
      expect(routerPushMock).not.toHaveBeenCalled()
      expect(container.querySelector('a[href="/download"]')).not.toBeNull()
      expect(
        container.querySelector('a[href="mailto:support@example.invalid"]'),
      ).not.toBeNull()
      expect(container.textContent).toContain(
        "研究責任者による復旧許可が必要です",
      )
      expect(container.textContent).not.toContain("開始画面へ戻る")
      await act(async () => root.unmount())
    },
  )

  it("keeps receipt navigation available when cleanup confirmation arrives after reload", async () => {
    currentStage = Stage.withdrawn
    const { default: WithdrawPage } = await import("./withdraw-page")
    const root = createRoot(container)
    await act(async () =>
      root.render(<WithdrawPage contactEmail="support@example.invalid" />),
    )
    expect(container.querySelector('a[href="/download"]')).not.toBeNull()
    cleanupStatus = "complete"
    await act(async () =>
      root.render(<WithdrawPage contactEmail="support@example.invalid" />),
    )
    expect(routerReplaceMock).not.toHaveBeenCalled()
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(container.querySelector('a[href="/download"]')).not.toBeNull()
    expect(downloadPdfMock).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it.each([Stage.unauthenticated, Stage.confirmationSent])(
    "hides withdrawal controls before authentication: %s",
    async (stage) => {
      currentStage = stage
      const { default: WithdrawPage } = await import("./withdraw-page")
      const root = createRoot(container)
      await act(async () =>
        root.render(<WithdrawPage contactEmail="support@example.invalid" />),
      )
      expect(
        Array.from(container.querySelectorAll("button")).some(
          (button) => button.textContent === "同意を撤回する",
        ),
      ).toBe(false)
      if (stage === Stage.confirmationSent)
        expect(container.textContent).toContain("メール認証の完了後")
      expect(completeWithdrawalMock).not.toHaveBeenCalled()
      await act(async () => root.unmount())
    },
  )

  it("shows the invalid email error only after the debounce interval", async () => {
    const { default: WithdrawPage } = await import("./withdraw-page")
    const root = createRoot(container)

    await act(async () => {
      root.render(<WithdrawPage contactEmail="support@example.invalid" />)
    })

    const invalidEmailButton = Array.from(
      container.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "set-invalid-email",
    ) as HTMLButtonElement
    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "同意を撤回する",
    ) as HTMLButtonElement

    await act(async () => {
      invalidEmailButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(submitButton.disabled).toBe(true)
    expect(container.textContent).not.toContain(
      "有効なメールアドレスを入力してください。",
    )

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(submitButton.disabled).toBe(true)
    expect(container.textContent).toContain(
      "有効なメールアドレスを入力してください。",
    )
  })

  it("downloads the withdrawal pdf and redirects home after a successful withdrawal", async () => {
    const { default: WithdrawPage } = await import("./withdraw-page")
    const root = createRoot(container)
    downloadPdfMock.mockResolvedValue(undefined)

    await act(async () => {
      root.render(<WithdrawPage contactEmail="support@example.invalid" />)
    })

    const buttons = Array.from(container.querySelectorAll("button"))
    const validEmailButton = buttons.find(
      (button) => button.textContent === "set-valid-email",
    ) as HTMLButtonElement
    const submitButton = buttons.find(
      (button) => button.textContent === "同意を撤回する",
    ) as HTMLButtonElement

    await act(async () => {
      validEmailButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(completeWithdrawalMock).toHaveBeenCalled()
    expect(downloadPdfMock).toHaveBeenCalledWith(requestWithdrawalPdfMock)
    expect(routerPushMock).toHaveBeenCalledWith("/")
  })

  it.each(["withdrawal", "pdf"])(
    "does not redirect or start another download after leaving during %s",
    async (pendingOperation) => {
      const pending = Promise.withResolvers<unknown>()
      if (pendingOperation === "withdrawal")
        completeWithdrawalMock.mockReturnValueOnce(pending.promise)
      else downloadPdfMock.mockReturnValueOnce(pending.promise)
      const { default: WithdrawPage } = await import("./withdraw-page")
      const root = createRoot(container)
      await act(async () =>
        root.render(<WithdrawPage contactEmail="support@example.invalid" />),
      )
      const byText = (text: string) =>
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === text,
        ) as HTMLButtonElement
      await act(async () => byText("set-valid-email").click())
      await act(async () => vi.advanceTimersByTime(300))
      await act(async () => byText("同意を撤回する").click())
      expect(completeWithdrawalMock).toHaveBeenCalledTimes(1)
      expect(downloadPdfMock).toHaveBeenCalledTimes(
        pendingOperation === "pdf" ? 1 : 0,
      )

      await act(async () => root.render(<div>another page</div>))
      await act(async () => pending.resolve({ ok: true }))

      expect(container.textContent).toBe("another page")
      expect(routerPushMock).not.toHaveBeenCalled()
      expect(downloadPdfMock).toHaveBeenCalledTimes(
        pendingOperation === "pdf" ? 1 : 0,
      )
      await act(async () => root.unmount())
    },
  )

  it("reports a PDF failure separately after withdrawal succeeds", async () => {
    downloadPdfMock.mockRejectedValueOnce(
      new Error("同意撤回書を取得できませんでした。"),
    )
    const { default: WithdrawPage } = await import("./withdraw-page")
    const root = createRoot(container)
    await act(async () =>
      root.render(<WithdrawPage contactEmail="support@example.invalid" />),
    )
    const byText = (text: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === text,
      ) as HTMLButtonElement
    await act(async () => byText("set-valid-email").click())
    await act(async () => vi.advanceTimersByTime(300))
    await act(async () => byText("同意を撤回する").click())
    expect(container.textContent).toContain(
      "同意撤回書のダウンロードに失敗しました。",
    )
    expect(container.textContent).not.toContain("同意の撤回に失敗しました")
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(byText("同意を撤回する").disabled).toBe(false)
    await act(async () => root.unmount())
  })

  it("retries only the PDF after accepted withdrawal without offering a start reset", async () => {
    completeWithdrawalMock.mockImplementation(async () => {
      currentStage = Stage.withdrawn
      cleanupStatus = "complete"
      return { ok: true }
    })
    downloadPdfMock.mockRejectedValueOnce(new Error("書類の取得に失敗しました"))
    const { default: WithdrawPage } = await import("./withdraw-page")
    const root = createRoot(container)
    const button = (text: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === text,
      ) as HTMLButtonElement
    await act(async () =>
      root.render(<WithdrawPage contactEmail="support@example.invalid" />),
    )
    await act(async () => button("set-valid-email").click())
    await act(async () => vi.advanceTimersByTime(300))
    await act(async () => button("同意を撤回する").click())
    expect(container.textContent).toContain("撤回申請は受理されています")
    expect(container.textContent).toContain(
      "同意撤回書のダウンロードに失敗しました",
    )
    expect(container.textContent).toContain(
      "研究責任者による復旧許可が必要です",
    )
    expect(container.textContent).not.toContain("開始画面へ戻る")
    expect(routerReplaceMock).not.toHaveBeenCalled()
    expect(routerPushMock).not.toHaveBeenCalled()
    await act(async () => button("同意撤回書の取得を再試行").click())
    expect(completeWithdrawalMock).toHaveBeenCalledTimes(1)
    expect(downloadPdfMock).toHaveBeenCalledTimes(2)
    expect(routerPushMock).toHaveBeenCalledWith("/")
    await act(async () => root.unmount())
  })

  it.each(["withdraw_failed", "network_error"])(
    "allows retry with unchanged valid email after %s",
    async (failure) => {
      if (failure === "network_error")
        completeWithdrawalMock.mockRejectedValueOnce(
          new TypeError("Failed to fetch"),
        )
      else
        completeWithdrawalMock.mockResolvedValueOnce({
          ok: false,
          reason: failure,
        })
      const { default: WithdrawPage } = await import("./withdraw-page")
      const root = createRoot(container)
      await act(async () => {
        root.render(<WithdrawPage contactEmail="support@example.invalid" />)
      })
      const byText = (text: string) =>
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === text,
        ) as HTMLButtonElement
      await act(async () => {
        byText("set-valid-email").click()
      })
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      expect(byText("同意を撤回する").disabled).toBe(false)
      await act(async () => {
        byText("同意を撤回する").click()
      })
      expect(container.textContent).toContain("同意の撤回")
      expect(container.textContent).toContain(
        "撤回申請の結果を確認できませんでした",
      )
      expect(container.textContent).not.toContain("同意の撤回に失敗しました")
      expect(container.textContent).not.toContain("Failed to fetch")
      expect(container.textContent).not.toContain("ダウンロードに失敗")
      expect(downloadPdfMock).not.toHaveBeenCalled()
      expect(routerPushMock).not.toHaveBeenCalled()
      expect(byText("同意を撤回する").disabled).toBe(false)
      await act(async () => {
        byText("同意を撤回する").click()
      })
      expect(completeWithdrawalMock).toHaveBeenCalledTimes(2)
      expect(completeWithdrawalMock).toHaveBeenNthCalledWith(
        2,
        "user@example.com",
      )
      expect(downloadPdfMock).toHaveBeenCalledTimes(1)
      expect(routerPushMock).toHaveBeenCalledWith("/")
    },
  )

  it.each([
    { resultCleared: false, resetAvailable: true },
    {
      resultCleared: false,
      cleanupPending: true,
      resetAvailable: false,
    },
    {
      resultCleared: false,
      stateWriteFailed: true,
      resetAvailable: false,
    },
  ])(
    "offers local reset only after server cleanup is confirmed: %j",
    async ({ resetAvailable, ...outcome }) => {
      completeWithdrawalMock.mockResolvedValueOnce({ ok: true, ...outcome })
      const { default: WithdrawPage } = await import("./withdraw-page")
      const root = createRoot(container)
      await act(async () =>
        root.render(<WithdrawPage contactEmail="support@example.invalid" />),
      )
      const byText = (text: string) =>
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === text,
        ) as HTMLButtonElement
      await act(async () => byText("set-valid-email").click())
      await act(async () => vi.advanceTimersByTime(300))
      await act(async () => byText("同意を撤回する").click())
      expect(
        Boolean(
          [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "ページを再読み込み",
          ),
        ),
      ).toBe(resetAvailable)
      expect(downloadPdfMock).toHaveBeenCalledTimes(1)
      expect(routerPushMock).toHaveBeenCalledWith("/")
      await act(async () => byText("set-invalid-email").click())
      expect(container.querySelector('a[href="/reset"]')).toBeNull()
      await act(async () => root.unmount())
    },
  )

  it("keeps deletion pending visible and retries without claiming completion", async () => {
    completeWithdrawalMock.mockResolvedValueOnce({
      ok: true,
      cleanupPending: true,
    })
    const { default: WithdrawPage } = await import("./withdraw-page")
    const root = createRoot(container)
    await act(async () =>
      root.render(<WithdrawPage contactEmail="support@example.invalid" />),
    )
    const byText = (text: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === text,
      ) as HTMLButtonElement
    await act(async () => byText("set-valid-email").click())
    await act(async () => vi.advanceTimersByTime(300))
    await act(async () => byText("同意を撤回する").click())
    expect(container.textContent).toContain("研究参加は撤回済みです")
    expect(container.textContent).toContain("データの削除は完了していません")
    expect(downloadPdfMock).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledWith("/")
    expect(byText("データ削除の再試行").disabled).toBe(false)
    await act(async () => byText("データ削除の再試行").click())
    expect(completeWithdrawalMock).toHaveBeenCalledTimes(2)
    expect(downloadPdfMock).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
  })
  it("shows accepted withdrawal and alternate receipt access while the optional PDF is stalled", async () => {
    const pending = Promise.withResolvers<void>()
    downloadPdfMock.mockReturnValueOnce(pending.promise)
    completeWithdrawalMock.mockImplementation(async () => {
      currentStage = Stage.withdrawn
      cleanupStatus = "complete"
      return { ok: true }
    })
    const { default: WithdrawPage } = await import("./withdraw-page")
    const root = createRoot(container)
    const button = (text: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === text,
      ) as HTMLButtonElement
    await act(async () =>
      root.render(<WithdrawPage contactEmail="support@example.invalid" />),
    )
    await act(async () => button("set-valid-email").click())
    await act(async () => vi.advanceTimersByTime(300))
    await act(async () => button("同意を撤回する").click())
    expect(container.textContent).toContain("研究参加の撤回を受け付けました")
    expect(container.textContent).toContain("同意撤回書を準備しています")
    expect(container.textContent).toContain(
      "研究責任者による復旧許可が必要です",
    )
    expect(container.querySelector('a[href="/download"]')).not.toBeNull()
    expect(routerPushMock).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    await act(async () => pending.resolve())
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(completeWithdrawalMock).toHaveBeenCalledOnce()
  })
  it.each([false, undefined, null, "false", "true", 1, {}, []])(
    "never starts receipt delivery without strict withdrawal acceptance (%j)",
    async (ok) => {
      completeWithdrawalMock.mockResolvedValueOnce({ ok })
      const { default: WithdrawPage } = await import("./withdraw-page")
      const root = createRoot(container)
      const button = (text: string) =>
        Array.from(container.querySelectorAll("button")).find(
          (item) => item.textContent === text,
        ) as HTMLButtonElement
      await act(async () =>
        root.render(<WithdrawPage contactEmail="support@example.invalid" />),
      )
      await act(async () => button("set-valid-email").click())
      await act(async () => vi.advanceTimersByTime(300))
      await act(async () => button("同意を撤回する").click())
      expect(downloadPdfMock).not.toHaveBeenCalled()
      expect(routerPushMock).not.toHaveBeenCalled()
      await act(async () => root.unmount())
    },
  )
})
