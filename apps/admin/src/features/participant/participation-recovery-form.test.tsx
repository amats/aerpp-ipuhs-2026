/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock("./actions-participation-recovery", () => ({
  authorizeParticipationRecoveryAction: authorize,
}))

import ParticipationRecoveryForm from "./participation-recovery-form"

it("keeps the confirmed operation after response loss and resubmits its exact identity", async () => {
  const review = {
    pseudonym: "synthetic-person",
    destination: "follow-up-document",
    reason: "synthetic reason",
    fingerprint: "synthetic-fingerprint",
    recoveryId: "11111111-1111-4111-8111-111111111111",
    status: "active",
    questionnaireKind: "initial",
    completedAt: null,
    presentedAt: null,
  }
  authorize
    .mockResolvedValueOnce({ message: "review", review })
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValueOnce({ message: "accepted" })
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  async function submit() {
    await act(async () => {
      const form = container.querySelector("form") as HTMLFormElement
      form.requestSubmit(
        form.querySelector('button[type="submit"]') as HTMLButtonElement,
      )
    })
  }
  try {
    await act(async () =>
      root.render(<ParticipationRecoveryForm pseudonym="synthetic-person" />),
    )
    const reason = container.querySelector("textarea") as HTMLTextAreaElement
    reason.value = "synthetic reason"
    await submit()
    await submit()
    expect(container.textContent).toContain("通信結果を確認できませんでした")
    expect(
      container.querySelector<HTMLInputElement>('input[name="recoveryId"]')
        ?.value,
    ).toBe(review.recoveryId)
    await submit()
    expect(container.textContent).toContain("accepted")
    expect(authorize).toHaveBeenCalledTimes(3)
    const first = authorize.mock.calls[1]
    const retry = authorize.mock.calls[2]
    expect(retry[0].review).toEqual(review)
    expect(Object.fromEntries(retry[1])).toEqual(Object.fromEntries(first[1]))
    expect(retry[1].get("confirm")).toBe("yes")
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
