/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import EmailActionRow from "./email-action-row"

describe("EmailActionRow", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("marks the input as invalid when hasError is enabled", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <EmailActionRow
          email="invalid"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          disabled={false}
          hasError
          describedById="email-error"
          buttonText="送信"
        />,
      )
    })

    const input = container.querySelector("input")

    expect(input?.getAttribute("aria-invalid")).toBe("true")
    expect(input?.getAttribute("aria-describedby")).toBe("email-error")
  })

  it("does not call onSubmit when the form is disabled", async () => {
    const onSubmit = vi.fn()
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <EmailActionRow
          email="user@example.com"
          onChange={vi.fn()}
          onSubmit={onSubmit}
          disabled
          buttonText="送信"
        />,
      )
    })

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        )
    })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("calls onSubmit when the form is enabled", async () => {
    const onSubmit = vi.fn()
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <EmailActionRow
          email="user@example.com"
          onChange={vi.fn()}
          onSubmit={onSubmit}
          disabled={false}
          buttonText="送信"
        />,
      )
    })

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        )
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("uses a full-width mobile action and an intrinsic desktop width", async () => {
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <EmailActionRow
          email="user@example.com"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          disabled={false}
          buttonText="送信"
        />,
      )
    })

    const button = container.querySelector("button")

    expect(button?.classList.contains("w-full")).toBe(true)
    expect(button?.classList.contains("sm:w-auto")).toBe(true)
  })
})
