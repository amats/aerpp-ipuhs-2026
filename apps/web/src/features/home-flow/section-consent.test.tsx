/** @vitest-environment jsdom */

import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  type ConsentDraft,
  EMPTY_CONSENT_DRAFT,
} from "@/features/home-flow/consent-draft-types"

const updateStatusMock = vi.fn()
const completeConsentMock = vi.fn()
const prepareConsentMock = vi.fn()

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => {
    const [consentDraft, setConsentDraft] = useState(EMPTY_CONSENT_DRAFT)
    return {
      prepareConsent: prepareConsentMock,
      completeConsent: completeConsentMock,
      consentDraft,
      updateConsentDraft: (draft: Partial<ConsentDraft>) =>
        setConsentDraft((current) => ({ ...current, ...draft })),
    }
  },
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({
    updateStatusMessage: updateStatusMock,
  }),
}))

vi.mock("@/assets/consent.mdx", () => ({
  default: ({
    components,
  }: {
    components: {
      CheckBox: ({
        id,
        children,
      }: {
        id: string
        children: React.ReactNode
      }) => React.ReactNode
    }
  }) => (
    <div>
      <components.CheckBox id="understoodRisk">risk</components.CheckBox>
      <components.CheckBox id="understoodWithdraw">
        withdraw
      </components.CheckBox>
      <components.CheckBox id="agreeDataUsage">data</components.CheckBox>
      <components.CheckBox id="agreeParticipation">
        participation
      </components.CheckBox>
    </div>
  ),
}))

vi.mock("@/ui/card-panel", () => ({
  default: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
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
      <button type="button" onClick={onSubmit}>
        force-submit
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

describe("SectionConsent", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    updateStatusMock.mockReset()
    prepareConsentMock
      .mockReset()
      .mockResolvedValue({ ok: true, consentContext: "sealed-context" })
    completeConsentMock.mockReset()
    completeConsentMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  it("keeps checkbox focus and neighboring controls mounted when toggled", async () => {
    const { default: SectionConsent } = await import("./section-consent")
    const root = createRoot(container)
    await act(async () => {
      root.render(<SectionConsent />)
    })

    const checkbox = container.querySelector<HTMLInputElement>(
      "#understoodRisk",
    ) as HTMLInputElement
    const neighbor = container.querySelector("#understoodWithdraw")
    checkbox.focus()
    await act(async () => {
      checkbox.click()
    })

    expect(document.activeElement).toBe(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(container.querySelector("#understoodWithdraw")).toBe(neighbor)
    await act(async () => root.unmount())
  })

  it("keeps submit disabled while email validation is debounced and then shows the error", async () => {
    const { default: SectionConsent } = await import("./section-consent")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionConsent />)
    })

    expect(container.querySelector("fieldset")?.textContent).toContain(
      "研究参加への同意確認項目",
    )

    for (const checkbox of Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    )) {
      await act(async () => {
        checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
    }

    const invalidEmailButton = Array.from(
      container.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "set-invalid-email",
    ) as HTMLButtonElement
    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "同意する",
    ) as HTMLButtonElement

    await act(async () => {
      invalidEmailButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(submitButton.disabled).toBe(true)
    expect(container.textContent).not.toContain(
      "本学の有効なメールアドレスを入力してください。",
    )

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(submitButton.disabled).toBe(true)
    expect(container.textContent).toContain(
      "本学の有効なメールアドレスを入力してください。",
    )
  })

  it("shows a state update error when consent email sends but state persistence fails", async () => {
    completeConsentMock.mockResolvedValue({
      ok: false,
      reason: "step_state_write_failed",
    })

    const { default: SectionConsent } = await import("./section-consent")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionConsent />)
    })

    for (const checkbox of Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    )) {
      await act(async () => {
        checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
    }

    const validEmailButton = Array.from(
      container.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "set-valid-email",
    ) as HTMLButtonElement

    await act(async () => {
      validEmailButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "force-submit",
    ) as HTMLButtonElement

    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(updateStatusMock).toHaveBeenCalledWith({
      message: "状態の更新に失敗しました。時間をおいて再度お試しください。",
      tone: "error",
    })
    expect(container.textContent).toContain(
      "状態の更新に失敗しました。時間をおいて再度お試しください。",
    )
  })

  it.each(["send_failed", "network_error"])(
    "allows retry with unchanged valid email after %s",
    async (failure) => {
      if (failure === "network_error")
        completeConsentMock.mockRejectedValueOnce(
          new TypeError("Failed to fetch"),
        )
      else
        completeConsentMock.mockResolvedValueOnce({
          ok: false,
          reason: failure,
        })
      const { default: SectionConsent } = await import("./section-consent")
      const root = createRoot(container)
      await act(async () => {
        root.render(<SectionConsent />)
      })
      for (const id of [
        "understoodRisk",
        "understoodWithdraw",
        "agreeDataUsage",
        "agreeParticipation",
      ]) {
        await act(async () => {
          ;(container.querySelector(`#${id}`) as HTMLInputElement).click()
        })
      }
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
      expect(byText("同意する").disabled).toBe(false)
      await act(async () => {
        byText("同意する").click()
      })
      expect(container.textContent).toContain(
        "メールの送信結果を確認できませんでした",
      )
      expect(byText("同意する").disabled).toBe(false)
      await act(async () => {
        byText("同意する").click()
      })
      expect(completeConsentMock).toHaveBeenCalledTimes(2)
      expect(completeConsentMock).toHaveBeenNthCalledWith(
        2,
        "user@example.com",
        "sealed-context",
      )
      expect(container.textContent).not.toContain(
        "メールの送信結果を確認できませんでした",
      )
    },
  )
  it.each(["consent_superseded", "consent_expired"])(
    "waits for the snapshot and requires renewed checks after %s",
    async (reason) => {
      let ready!: (value: { ok: true; consentContext: string }) => void
      prepareConsentMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            ready = resolve
          }),
      )
      completeConsentMock.mockResolvedValueOnce({
        ok: false,
        reason,
      })
      const { default: SectionConsent } = await import("./section-consent")
      const root = createRoot(container)
      const button = (name: string) =>
        Array.from(container.querySelectorAll("button")).find(
          (item) => item.textContent === name,
        ) as HTMLButtonElement
      await act(async () => root.render(<SectionConsent />))
      await act(async () => {
        for (const checkbox of container.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ))
          checkbox.click()
        button("set-valid-email").click()
      })
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      expect(button("同意する").disabled).toBe(true)
      await act(async () => {
        button("force-submit").click()
      })
      expect(completeConsentMock).not.toHaveBeenCalled()
      await act(async () => {
        ready({ ok: true, consentContext: "old-context" })
      })
      expect(button("同意する").disabled).toBe(false)
      await act(async () => {
        button("同意する").click()
      })
      expect(completeConsentMock).toHaveBeenCalledWith(
        "user@example.com",
        "old-context",
      )
      expect(prepareConsentMock).toHaveBeenCalledTimes(1)
      expect(button("同意する").disabled).toBe(true)
      expect(
        Array.from(
          container.querySelectorAll<HTMLInputElement>(
            'input[type="checkbox"]',
          ),
        ).every((item) => !item.checked),
      ).toBe(true)
      expect(container.textContent).toContain(
        reason === "consent_expired"
          ? "同意の確認から時間が経過しました"
          : "参加状態が変更されました",
      )
      await act(async () => {
        button("参加状態を再確認").click()
      })
      expect(prepareConsentMock).toHaveBeenCalledTimes(2)
      expect(button("同意する").disabled).toBe(true)
      await act(async () => {
        for (const checkbox of container.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ))
          checkbox.click()
      })
      await act(async () => {
        button("同意する").click()
      })
      expect(completeConsentMock).toHaveBeenLastCalledWith(
        "user@example.com",
        "sealed-context",
      )
      await act(async () => root.unmount())
    },
  )
})
