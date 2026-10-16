import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({ debugPagesEnabled: true }))
vi.mock("@aerpp/config/server/web", () => ({ env: runtime }))

vi.mock("@/features/debug/debug-home-flow-panel", () => ({
  default: () => <div>home-flow-debug-panel</div>,
}))

vi.mock("@/features/debug/debug-refresh-button", () => ({
  default: () => <div>refresh-button</div>,
}))

vi.mock("@/features/app-shell/app-shell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("@/ui/card-section", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/section-heading", () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

describe("DebugHomeFlowPage", () => {
  it("renders the home flow debug snapshot", async () => {
    const { default: DebugHomeFlowPage } = await import("./page")
    const markup = renderToStaticMarkup(<DebugHomeFlowPage />)

    expect(markup).toContain("Home flow debug snapshot")
    expect(markup).toContain("refresh-button")
    expect(markup).toContain("home-flow-debug-panel")
  })

  it("rejects a disabled page before rendering its client snapshot", async () => {
    runtime.debugPagesEnabled = false
    try {
      const { default: Page } = await import("./page")
      expect(() => Page()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404")
    } finally {
      runtime.debugPagesEnabled = true
    }
  })
})
