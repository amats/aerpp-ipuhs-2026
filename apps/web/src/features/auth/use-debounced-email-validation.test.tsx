/** @vitest-environment jsdom */

import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

describe("useDebouncedEmailValidation", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  it("keeps submission disabled on the first render of changed input", async () => {
    const { useDebouncedEmailValidation } = await import(
      "./use-debounced-email-validation"
    )
    const observed: boolean[] = []
    function Probe({ email }: { email: string }) {
      const { isValidationPending } = useDebouncedEmailValidation({
        email,
        invalidMessage: "invalid",
      })
      useLayoutEffect(() => {
        if (email) observed.push(isValidationPending)
      }, [email, isValidationPending])
      return null
    }
    const root = createRoot(container)
    await act(async () => root.render(<Probe email="" />))
    await act(async () => root.render(<Probe email="user@example.invalid" />))
    expect(observed[0]).toBe(true)
    await act(async () => root.unmount())
  })

  it("delays invalid email errors until the debounce interval passes", async () => {
    const { useDebouncedEmailValidation } = await import(
      "./use-debounced-email-validation"
    )

    function Probe({ email }: { email: string }) {
      const { emailError, isValidationPending } = useDebouncedEmailValidation({
        email,
        invalidMessage: "invalid",
        debounceMs: 300,
      })
      return (
        <div>{`${emailError ?? "none"}:${String(isValidationPending)}`}</div>
      )
    }

    const root = createRoot(container)

    await act(async () => {
      root.render(<Probe email="invalid" />)
    })

    expect(container.textContent).toBe("none:true")

    await act(async () => {
      vi.advanceTimersByTime(299)
    })

    expect(container.textContent).toBe("none:true")

    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(container.textContent).toBe("invalid:false")
  })

  it("cancels the stale validation result when the email changes before timeout", async () => {
    const { useDebouncedEmailValidation } = await import(
      "./use-debounced-email-validation"
    )

    function Probe({ email }: { email: string }) {
      const { emailError, isValidationPending } = useDebouncedEmailValidation({
        email,
        invalidMessage: "invalid",
        debounceMs: 300,
      })
      return (
        <div>{`${emailError ?? "none"}:${String(isValidationPending)}`}</div>
      )
    }

    const root = createRoot(container)

    await act(async () => {
      root.render(<Probe email="invalid" />)
    })

    await act(async () => {
      vi.advanceTimersByTime(150)
      root.render(<Probe email="user@example.com" />)
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(container.textContent).toBe("none:false")
  })
})
