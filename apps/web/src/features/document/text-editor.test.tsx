/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import TextEditor from "./text-editor"

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ""
})

it("reconciles native restoration with the latest draft without editing it", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockReturnValue(1)
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})
  const onChange = vi.fn()
  const renderEditor = (text: string) =>
    root.render(
      <TextEditor
        documentKey="document-1"
        documentTitle="書類1"
        document={text}
        onChange={onChange}
        onClear={vi.fn()}
      />,
    )
  await act(async () => renderEditor(""))
  const textarea = container.querySelector("textarea") as HTMLTextAreaElement
  textarea.value = "ブラウザーが復元した以前の本文"
  await act(async () => requestFrame.mock.calls.at(-1)?.[0](0))
  expect(textarea.value).toBe("")

  await act(async () => renderEditor("現在の下書き"))
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))
  textarea.value = "pageshow後に復元された古い本文"
  await act(async () => requestFrame.mock.calls.at(-1)?.[0](0))
  expect(textarea.value).toBe("現在の下書き")

  window.dispatchEvent(new PageTransitionEvent("pageshow"))
  await act(async () => renderEditor("新しく編集した本文"))
  await act(async () => requestFrame.mock.calls.at(-1)?.[0](0))
  expect(textarea.value).toBe("新しく編集した本文")
  expect(onChange).not.toHaveBeenCalled()
  await act(async () => root.unmount())
})

it("cancels pending restoration and removes its page listener on unmount", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockReturnValue(7)
  const cancelFrame = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => {})
  await act(async () =>
    root.render(
      <TextEditor
        documentKey="document-1"
        documentTitle="書類1"
        document="保持する本文"
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    ),
  )
  const textarea = container.querySelector("textarea") as HTMLTextAreaElement
  await act(async () => root.unmount())
  expect(cancelFrame).toHaveBeenCalledWith(7)
  requestFrame.mockClear()
  window.dispatchEvent(new PageTransitionEvent("pageshow"))
  expect(requestFrame).not.toHaveBeenCalled()
  expect(textarea.value).toBe("保持する本文")
})
