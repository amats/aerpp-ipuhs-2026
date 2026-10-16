/** @vitest-environment jsdom */

import { act, type ComponentType, type ReactNode, useState } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { EMPTY_DOCUMENT_DRAFT } from "@/features/document/document-draft-types"
import TextEditor from "@/features/document/text-editor"
import { useDocumentEditor } from "@/features/document/use-document-editor"
import WithdrawPage from "@/features/withdraw/withdraw-page"
import { type ConsentDraft, EMPTY_CONSENT_DRAFT } from "./consent-draft-types"
import SectionConsent from "./section-consent"

const { completeConsentMock, completeWithdrawalMock, prepareConsentMock } =
  vi.hoisted(() => ({
    completeConsentMock: vi.fn(),
    prepareConsentMock: vi.fn(async () => ({
      ok: true,
      consentContext: "sealed-context",
    })),
    completeWithdrawalMock: vi.fn(),
  }))

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => {
    const [consentDraft, setConsentDraft] = useState(EMPTY_CONSENT_DRAFT)
    const [documentDraft, updateDocumentDraft] = useState(EMPTY_DOCUMENT_DRAFT)
    return {
      stage: "authenticated",
      analysisJob: null,
      documentDraft,
      updateDocumentDraft,
      startAnalysis: vi.fn(),
      prepareConsent: prepareConsentMock,
      completeConsent: completeConsentMock,
      completeWithdrawal: completeWithdrawalMock,
      consentDraft,
      updateConsentDraft: (draft: Partial<ConsentDraft>) =>
        setConsentDraft((current) => ({ ...current, ...draft })),
    }
  },
}))
vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({ updateStatusMessage: vi.fn() }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/assets/withdrawal.mdx", () => ({ default: () => null }))
vi.mock("@/assets/consent.mdx", () => ({
  default: ({
    components,
  }: {
    components: { CheckBox: ComponentType<{ id: string; children: ReactNode }> }
  }) => (
    <>
      {[
        "understoodRisk",
        "understoodWithdraw",
        "agreeDataUsage",
        "agreeParticipation",
      ].map((id) => (
        <components.CheckBox key={id} id={id}>
          {id}
        </components.CheckBox>
      ))}
    </>
  ),
}))

function DocumentInput() {
  const editor = useDocumentEditor()
  return (
    <TextEditor
      documentKey="document-1"
      documentTitle="Document"
      document={editor.documents["document-1"]}
      onChange={editor.updateDocument}
      onClear={editor.clearDocument}
    />
  )
}

it.each([
  ["email", SectionConsent, "input[type=email]", HTMLInputElement],
  ["document", DocumentInput, "textarea", HTMLTextAreaElement],
] as const)(
  "keeps each typed %s character before the next input event",
  async (_name, Component, selector, Element) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Component />))
      const input = container.querySelector(selector) as
        | HTMLInputElement
        | HTMLTextAreaElement
      const setNativeValue = Object.getOwnPropertyDescriptor(
        Element.prototype,
        "value",
      )?.set
      input.focus()
      await act(async () => {
        let expected = ""
        for (const character of "user@example.com") {
          expected += character
          setNativeValue?.call(input, input.value + character)
          input.dispatchEvent(new Event("input", { bubbles: true }))
          expect(input.value).toBe(expected)
        }
      })
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  },
)

it.each([
  ["consent", SectionConsent, completeConsentMock],
  ["withdrawal", WithdrawPage, completeWithdrawalMock],
] as const)(
  "preserves submitted %s input during a pending request and allows editing and retry after failure",
  async (_name, Component, submit) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    submit.mockReset()
    let fail!: () => void
    submit.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = () => reject(new Error("temporary transport failure"))
      }),
    )
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(<Component contactEmail="support@example.invalid" />),
      )
      const email = container.querySelector<HTMLInputElement>(
        'input[type="email"]',
      ) as HTMLInputElement
      const form = container.querySelector("form") as HTMLFormElement
      const checks = Array.from(
        container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      )
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set
      expect(email.readOnly).toBe(false)
      await act(async () => {
        for (const check of checks) check.click()
        setValue?.call(email, "user@example.com")
        email.dispatchEvent(new Event("input", { bubbles: true }))
      })
      await act(async () => vi.advanceTimersByTime(300))
      await act(async () =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      )
      expect(submit).toHaveBeenCalledExactlyOnceWith(
        "user@example.com",
        ...(_name === "consent" ? ["sealed-context"] : []),
      )
      expect(email.readOnly).toBe(true)
      expect(checks.every((check) => check.matches(":disabled"))).toBe(true)
      await act(async () => {
        for (const check of checks) check.click()
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        )
      })
      expect(checks.every((check) => check.checked)).toBe(true)
      expect(submit).toHaveBeenCalledTimes(1)
      await act(async () => fail())
      expect(email.readOnly).toBe(false)
      expect(email.value).toBe("user@example.com")
      expect(checks.every((check) => !check.matches(":disabled"))).toBe(true)
      await act(async () => {
        setValue?.call(email, "retry@example.com")
        email.dispatchEvent(new Event("input", { bubbles: true }))
      })
      await act(async () => vi.advanceTimersByTime(300))
      submit.mockResolvedValueOnce({ ok: false, reason: "session_busy" })
      await act(async () =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      )
      expect(submit).toHaveBeenLastCalledWith(
        "retry@example.com",
        ...(_name === "consent" ? ["sealed-context"] : []),
      )
      expect(email.readOnly).toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.useRealTimers()
    }
  },
)
