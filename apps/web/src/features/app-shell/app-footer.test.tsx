/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"

const useAppContextMock = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => useAppContextMock(),
}))

describe("AppFooter", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useAppContextMock.mockReset()
    useAppContextMock.mockReturnValue({
      stage: Stage.unauthenticated,
    })
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("shows the current app version", async () => {
    const { default: AppFooter } = await import("./app-footer")
    const root = createRoot(container)

    await act(async () => {
      root.render(<AppFooter appVersion="1.2.3" />)
    })

    expect(container.textContent).toContain("Version 1.2.3")
  })

  it("shows the withdrawal link for authenticated or completed participants", async () => {
    useAppContextMock.mockReturnValue({
      stage: Stage.followUp,
    })

    const { default: AppFooter } = await import("./app-footer")
    const root = createRoot(container)

    await act(async () => {
      root.render(<AppFooter appVersion="1.2.3" />)
    })

    expect(container.textContent).toContain("同意の撤回")
    expect(container.querySelector('a[href="/withdraw"]')).not.toBeNull()
  })

  it("keeps withdrawal reachable before authentication", async () => {
    const { default: AppFooter } = await import("./app-footer")
    const root = createRoot(container)

    await act(async () => {
      root.render(<AppFooter appVersion="1.2.3" />)
    })

    expect(container.textContent).toContain("同意の撤回")
    expect(container.querySelector('a[href="/withdraw"]')).not.toBeNull()
  })

  it("shows debug and reset links outside production", async () => {
    const { default: AppFooter } = await import("./app-footer")
    const root = createRoot(container)

    await act(async () => {
      root.render(<AppFooter appVersion="1.2.3" showDevelopmentLinks />)
    })

    expect(container.querySelector('a[href="/debug"]')).not.toBeNull()
    expect(container.querySelector('a[href="/debug/home-flow"]')).not.toBeNull()
    expect(
      container.querySelector('a[href="/debug/alert-message"]'),
    ).not.toBeNull()
    expect(container.querySelector('a[href="/reset"]')).not.toBeNull()
  })

  it("hides debug and reset links when development links are disabled", async () => {
    const { default: AppFooter } = await import("./app-footer")
    const root = createRoot(container)

    await act(async () => {
      root.render(<AppFooter appVersion="1.2.3" />)
    })

    expect(container.querySelector('a[href="/debug"]')).toBeNull()
    expect(container.querySelector('a[href="/debug/home-flow"]')).toBeNull()
    expect(container.querySelector('a[href="/debug/alert-message"]')).toBeNull()
    expect(container.querySelector('a[href="/reset"]')).toBeNull()
  })
})
