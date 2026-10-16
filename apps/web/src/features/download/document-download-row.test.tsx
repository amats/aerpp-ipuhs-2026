/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock("@/features/pdf/download-pdf", () => ({ downloadPdf: mocks.download }))

import DocumentDownloadRow from "./document-download-row"

beforeEach(() => vi.resetAllMocks())

async function renderRow() {
  const container = document.createElement("div")
  const root = createRoot(container)
  const loadPdf = vi.fn()
  await act(async () =>
    root.render(
      <ul>
        <DocumentDownloadRow label="同意書の控え" loadPdf={loadPdf} />
      </ul>,
    ),
  )
  return {
    container,
    root,
    loadPdf,
    button: container.querySelector("button") as HTMLButtonElement,
  }
}

it("shows preparation, prevents duplicate clicks, and offers a local retry without redoing consent", async () => {
  const response = Promise.withResolvers<void>()
  mocks.download
    .mockReturnValueOnce(response.promise)
    .mockResolvedValueOnce(undefined)
  const { container, button, loadPdf } = await renderRow()
  await act(async () => {
    button.click()
    button.click()
  })
  expect(mocks.download).toHaveBeenCalledTimes(1)
  expect(mocks.download).toHaveBeenCalledWith(loadPdf)
  expect(button.disabled).toBe(true)
  expect(button.getAttribute("aria-busy")).toBe("true")
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "同意書の控えを準備しています",
  )
  await act(async () =>
    response.reject(new Error("記録時の書類を取得できませんでした。")),
  )
  expect(button.disabled).toBe(false)
  expect(button.textContent).toContain("再試行")
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "記録時の書類を取得できませんでした",
  )
  await act(async () => button.click())
  expect(mocks.download).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it.each([false, true])(
  "ignores late PDF UI updates after leaving the page (failure=%s)",
  async (failed) => {
    const response = Promise.withResolvers<void>()
    mocks.download.mockReturnValueOnce(response.promise)
    const { root, button } = await renderRow()
    await act(async () => button.click())
    await act(async () => root.render(<p>次の画面の案内</p>))
    await act(async () =>
      failed === true
        ? response.reject(new Error("late response"))
        : response.resolve(),
    )
    expect(button.textContent).toBe("PDFを準備しています…")
  },
)
