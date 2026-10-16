import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND")
})

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}))

vi.mock("@aerpp/config/server/web", () => ({
  env: {
    debugPagesEnabled: true,
  },
}))

describe("DebugLayout", () => {
  it("renders children when debug pages are enabled", async () => {
    const { default: DebugLayout } = await import("./layout")
    const markup = renderToStaticMarkup(
      <DebugLayout>
        <div>debug-child</div>
      </DebugLayout>,
    )

    expect(markup).toContain("debug-child")
  })

  it("returns not found when debug pages are disabled", async () => {
    vi.resetModules()
    vi.doMock("next/navigation", () => ({
      notFound: notFoundMock,
    }))
    vi.doMock("@aerpp/config/server/web", () => ({
      env: {
        debugPagesEnabled: false,
      },
    }))

    const { default: DebugLayout } = await import("./layout")

    expect(() =>
      renderToStaticMarkup(
        <DebugLayout>
          <div>debug-child</div>
        </DebugLayout>,
      ),
    ).toThrow("NOT_FOUND")
  })
})
