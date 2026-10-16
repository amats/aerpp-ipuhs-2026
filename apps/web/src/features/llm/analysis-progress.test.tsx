/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { AnalysisElapsedTime } from "./analysis-job-types"
import AnalysisProgress from "./analysis-progress"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function render(elapsedTime: AnalysisElapsedTime | null) {
  await act(async () =>
    root.render(<AnalysisProgress elapsedTime={elapsedTime} />),
  )
}

async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTime(milliseconds))
}

it("starts ticking one second after the first elapsed observation arrives", async () => {
  await render(null)
  expect(container.textContent).toContain("処理状況を確認しています。")
  await advance(700)
  await render({ elapsedMs: 0, receivedAtMs: performance.now() })
  await advance(999)
  expect(container.textContent).toContain("経過時間 0分00秒")
  await advance(1)
  expect(container.textContent).toContain("経過時間 0分01秒")
  await advance(1000)
  expect(container.textContent).toContain("経過時間 0分02秒")
})

it("keeps the display and tick schedule steady across early, late and regressing status samples", async () => {
  await render({ elapsedMs: 900, receivedAtMs: performance.now() })
  await advance(600)
  await render({ elapsedMs: 1500, receivedAtMs: performance.now() })
  expect(container.textContent).toContain("経過時間 0分00秒")
  await advance(400)
  expect(container.textContent).toContain("経過時間 0分01秒")

  await advance(300)
  await render({ elapsedMs: 500, receivedAtMs: performance.now() })
  expect(container.textContent).toContain("経過時間 0分01秒")
  await advance(600)
  await render({ elapsedMs: 15_000, receivedAtMs: performance.now() })
  expect(container.textContent).toContain("経過時間 0分01秒")
  await advance(100)
  expect(container.textContent).toContain("経過時間 0分02秒")
})

it("advances only one second after delayed rendering instead of catching up", async () => {
  await render({ elapsedMs: 0, receivedAtMs: performance.now() })
  await advance(30_000)
  expect(container.textContent).toContain("経過時間 0分01秒")
  await advance(999)
  expect(container.textContent).toContain("経過時間 0分01秒")
  await advance(1)
  expect(container.textContent).toContain("経過時間 0分02秒")
})

it("restores server elapsed time on remount independently of the browser wall clock", async () => {
  vi.spyOn(Date, "now").mockReturnValue(120_000)
  await render({ elapsedMs: 59_000, receivedAtMs: performance.now() - 500 })
  expect(container.textContent).toContain("経過時間 0分59秒")
  await advance(1000)
  expect(container.textContent).toContain("経過時間 1分00秒")

  await act(async () => root.unmount())
  expect(vi.getTimerCount()).toBe(0)
  root = createRoot(container)
  vi.mocked(Date.now).mockReturnValue(-120_000)
  await render({ elapsedMs: 73_500, receivedAtMs: performance.now() - 600 })
  expect(container.textContent).toContain("経過時間 1分14秒")
  await advance(1000)
  expect(container.textContent).toContain("経過時間 1分15秒")
})
