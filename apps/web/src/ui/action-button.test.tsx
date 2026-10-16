/** @vitest-environment jsdom */

import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import ActionButton from "./action-button"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it("blocks clicks while pending and restores the label when ready", async () => {
  const onClick = vi.fn()
  const renderButton = (pending: boolean, disabled = false) =>
    act(async () => {
      root.render(
        <ActionButton
          pending={pending}
          pendingLabel="準備中..."
          disabled={disabled}
          onClick={onClick}
        >
          次に進む
        </ActionButton>,
      )
    })

  await renderButton(true)
  const button = container.querySelector("button")
  if (!button) throw new Error("Action button is missing")
  expect(button.textContent).toBe("準備中...")
  expect(button.getAttribute("aria-busy")).toBe("true")
  expect(button.disabled).toBe(true)
  await act(async () => button.click())
  expect(onClick).not.toHaveBeenCalled()

  await renderButton(false, true)
  expect(button.textContent).toBe("次に進む")
  expect(button.getAttribute("aria-busy")).not.toBe("true")
  expect(button.disabled).toBe(true)

  await renderButton(false)
  await act(async () => button.click())
  expect(onClick).toHaveBeenCalledTimes(1)
})

it("defaults to a non-submit button and preserves explicit form submission", async () => {
  const onSubmit = vi.fn((event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
  })
  const ref = createRef<HTMLButtonElement>()
  await act(async () => {
    root.render(
      <form onSubmit={onSubmit}>
        <p id="action-hint">回答を確認してください。</p>
        <ActionButton variant="secondary">戻る</ActionButton>
        <ActionButton ref={ref} type="submit" aria-describedby="action-hint">
          送信
        </ActionButton>
      </form>,
    )
  })

  const backButton = container.querySelector("button")
  if (!backButton) throw new Error("Back button is missing")
  await act(async () => backButton.click())
  expect(onSubmit).not.toHaveBeenCalled()
  expect(ref.current?.getAttribute("aria-describedby")).toBe("action-hint")
  await act(async () => ref.current?.click())
  expect(onSubmit).toHaveBeenCalledTimes(1)
})
