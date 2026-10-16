/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import RouteFocusBoundary from "./route-focus-boundary"

let pathname = "/"
vi.mock("next/navigation", () => ({ usePathname: () => pathname }))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  pathname = "/"
  window.history.replaceState(null, "", "/")
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return (this.hasAttribute("hidden")
        ? []
        : [new DOMRect(0, 0, 100, 30)]) as unknown as DOMRectList
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ""
})

it("preserves initial focus, then focuses the visible route heading", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockReturnValue(1)
  const cancelFrame = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => {})
  const renderRoute = () =>
    root.render(
      <RouteFocusBoundary>
        <nav>
          <h2>Progress navigation</h2>
        </nav>
        <h2 hidden tabIndex={-1}>
          Cached heading
        </h2>
        <h2 tabIndex={-1}>{pathname}</h2>
        <button type="button">Route control</button>
      </RouteFocusBoundary>,
    )
  await act(async () => renderRoute())
  expect(requestFrame).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(document.body)
  pathname = "/license"
  await act(async () => renderRoute())
  await act(async () => requestFrame.mock.calls[0][0](0))
  expect(document.activeElement?.textContent).toBe("/license")
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
    behavior: "instant",
    block: "center",
  })
  pathname = "/download"
  await act(async () => renderRoute())
  await act(async () => root.unmount())
  expect(cancelFrame).toHaveBeenCalledWith(1)
})

it("waits for a route heading revealed after its pathname commits", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockReturnValue(1)
  await act(async () =>
    root.render(
      <RouteFocusBoundary>
        <div>Initial page</div>
      </RouteFocusBoundary>,
    ),
  )
  pathname = "/license"
  await act(async () =>
    root.render(
      <RouteFocusBoundary>
        <div>Loading</div>
      </RouteFocusBoundary>,
    ),
  )
  await act(async () => requestFrame.mock.calls[0][0](0))
  expect(document.activeElement).toBe(document.body)
  await act(async () =>
    root.render(
      <RouteFocusBoundary>
        <h2 tabIndex={-1}>Loaded heading</h2>
      </RouteFocusBoundary>,
    ),
  )
  await act(async () => requestFrame.mock.calls[1][0](0))
  expect(document.activeElement?.textContent).toBe("Loaded heading")
  await act(async () => root.unmount())
})

it.each(["history", "fragment"])(
  "leaves %s scrolling to the browser and focuses the next ordinary navigation",
  async (navigation) => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(1)
    const renderRoute = () =>
      root.render(
        <RouteFocusBoundary>
          <h2 tabIndex={-1}>{pathname}</h2>
        </RouteFocusBoundary>,
      )
    await act(async () => renderRoute())
    pathname = "/license"
    window.history.replaceState(
      null,
      "",
      navigation === "fragment" ? "/license#model" : "/license",
    )
    if (navigation === "history")
      window.dispatchEvent(new PopStateEvent("popstate"))
    await act(async () => renderRoute())
    expect(requestFrame).not.toHaveBeenCalled()
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    pathname = "/download"
    window.history.replaceState(null, "", pathname)
    await act(async () => renderRoute())
    await act(async () => requestFrame.mock.calls[0][0](0))
    expect(document.activeElement?.textContent).toBe("/download")
    await act(async () => root.unmount())
  },
)
