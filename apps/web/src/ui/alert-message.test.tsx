/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import AlertMessage from "./alert-message"

describe("AlertMessage", () => {
  let container: HTMLDivElement

  function getMessageByRole(role: "alert" | "status") {
    return container.querySelector(`[role="${role}"]`)
  }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it.each([
    {
      tone: "error" as const,
      expectedRole: "alert" as const,
      expectedAriaLive: "assertive" as const,
    },
    {
      tone: undefined,
      expectedRole: "status" as const,
      expectedAriaLive: "polite" as const,
    },
    {
      tone: "warning" as const,
      expectedRole: "status" as const,
      expectedAriaLive: "polite" as const,
    },
  ])(
    "applies the expected announcement semantics for $tone tone",
    async ({ tone, expectedRole, expectedAriaLive }) => {
      const root = createRoot(container)

      await act(async () => {
        root.render(<AlertMessage tone={tone}>Message</AlertMessage>)
      })

      const message = getMessageByRole(expectedRole)

      expect(message?.textContent).toContain("Message")
      expect(message?.getAttribute("role")).toBe(expectedRole)
      expect(message?.getAttribute("aria-live")).toBe(expectedAriaLive)
    },
  )

  it("renders the warning tone symbol when warning is requested", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(<AlertMessage tone="warning">Careful</AlertMessage>)
    })

    const symbol = container.querySelector('[data-tone-symbol="warning"]')

    expect(symbol).not.toBeNull()
    expect(getMessageByRole("status")?.textContent).toContain("Careful")
  })

  it("lets callers override the announcement role", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AlertMessage tone="success" role="alert">
          Success
        </AlertMessage>,
      )
    })

    expect(getMessageByRole("alert")?.textContent).toContain("Success")
  })

  it.each([false, true])(
    "provides a focusable dismiss action (compact: %s)",
    async (compact) => {
      const root = createRoot(container)
      const onDismiss = vi.fn()

      await act(async () => {
        root.render(
          <AlertMessage tone="info" compact={compact} onDismiss={onDismiss}>
            Dismissible
          </AlertMessage>,
        )
      })

      const dismissButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="閉じる"]',
      )

      expect(dismissButton).not.toBeNull()
      dismissButton?.focus()
      expect(document.activeElement).toBe(dismissButton)
      await act(async () => {
        dismissButton?.click()
      })
      expect(onDismiss).toHaveBeenCalledTimes(1)
      await act(async () => root.unmount())
    },
  )
})
