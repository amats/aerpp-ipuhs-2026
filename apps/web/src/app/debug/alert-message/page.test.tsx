import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({ debugPagesEnabled: true }))
vi.mock("@aerpp/config/server/web", () => ({
  env: runtime,
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

vi.mock("@/ui/card-panel", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/section-heading", () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

vi.mock("@/features/debug/debug-alert-message-preview", () => ({
  default: () => (
    <div>
      <div>Standard</div>
      <div>Compact</div>
      <div>Warning</div>
      <div>Survey Context</div>
    </div>
  ),
}))

describe("AlertMessagePreviewPage", () => {
  it("renders when debug pages are enabled", async () => {
    const { default: AlertMessagePreviewPage } = await import("./page")
    const markup = renderToStaticMarkup(await AlertMessagePreviewPage())

    expect(markup).toContain("AlertMessage")
    expect(markup).toContain("入力エラー")
    expect(markup).toContain("Survey Context")
    expect(markup).toContain("Standard")
    expect(markup).toContain("Compact")
    expect(markup).toContain("Warning")
  })

  it("rejects a disabled preview before rendering", async () => {
    runtime.debugPagesEnabled = false
    try {
      const { default: Page } = await import("./page")
      await expect(Page()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404")
    } finally {
      runtime.debugPagesEnabled = true
    }
  })
})
