/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import OperationalQuery from "./operational-query"

it("copies the exact displayed query, reports failure without hiding it, and supports retry", async () => {
  const query = 'timestamp>="2026-10-08T00:00:00.000Z" AND (severity>=WARNING)'
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal("navigator", { clipboard: { writeText } })
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    await act(async () => root.render(<OperationalQuery query={query} />))
    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.getAttribute("aria-label")).toBe("ログの検索条件をコピー")
    await act(async () => button.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith(query)
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "コピーしました。",
    )
    writeText.mockRejectedValueOnce(new Error("Clipboard denied"))
    await act(async () => button.click())
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "コピーできませんでした。",
    )
    expect(container.querySelector("pre")?.textContent).toBe(query)
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "コピーしました。",
    )
    vi.stubGlobal("navigator", {})
    await act(async () => button.click())
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "下の検索条件を選択してコピーしてください。",
    )
    expect(container.querySelector("pre")?.textContent).toBe(query)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
