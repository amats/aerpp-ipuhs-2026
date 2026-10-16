import type { ReactNode } from "react"
import { renderToStaticMarkup as renderHtml } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import InformationDraftProvider from "@/features/information/information-draft-provider"
import AppShell from "./app-shell"

function renderToStaticMarkup(element: ReactNode) {
  return renderHtml(
    <InformationDraftProvider>{element}</InformationDraftProvider>,
  )
}

vi.mock("server-only", () => ({}))
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getConfiguredServerId: vi.fn(() => "configured-server"),
  env: {
    adminAuthBypassEnabled: false,
    supportReceptionExpiresAt: new Date("2026-09-30T15:00:00Z"),
    supportBackendStopsAt: new Date("2026-11-30T15:00:00Z"),
  },
}))
vi.mock("@/lib/auth", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@aerpp/config/server/admin", () => ({ env: mocks.env }))
vi.mock("@/features/monitoring/participant-records", () => ({
  getConfiguredServerId: mocks.getConfiguredServerId,
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/survey",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.env.adminAuthBypassEnabled = false
  mocks.auth.mockResolvedValue({ user: { email: "admin@example.invalid" } })
})

it("authenticates before resolving the environment scope", async () => {
  mocks.auth.mockRejectedValueOnce(new Error("redirect"))
  await expect(
    AppShell({ currentPath: "/survey", children: "Content" }),
  ).rejects.toThrow("redirect")
  expect(mocks.getConfiguredServerId).not.toHaveBeenCalled()
})

it.each(["all", "other-server", ["one", "two"]])(
  "ignores server query overrides %s",
  async (serverId) => {
    const html = renderToStaticMarkup(
      await AppShell({
        currentPath: "/survey",
        searchParams: Promise.resolve({ serverId }),
        children: <section>Survey content</section>,
      }),
    )
    expect(html).toContain("serverId: configured-server")
    expect(html).toContain("Web受付終了日時")
    expect(html).toContain("Support終了日時")
    expect(html).toContain("2026/12/01 00:00:00")
    expect(html).toContain("2026/10/01 00:00:00")
    expect(html).toContain("日本時間・UTC+09:00")
    expect(html).toContain('dateTime="2026-09-30T15:00:00.000Z"')
    expect(html).not.toContain("?serverId=")
    expect(html).not.toMatch(/<label[^>]*>serverId<\/label>/)
    expect(html).toContain('href="/license"')
    const links = [...html.matchAll(/href="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((link) => link !== "/license")
    expect(links).toHaveLength(14)
    expect(links.slice(0, 7)).toEqual(links.slice(7))
    expect(html.match(/aria-current="page"/g)).toHaveLength(2)
    expect(html).toMatch(/<h1[^>]*>アンケート結果<\/h1>/)
    expect(html).toContain("Survey content")
    expect(html).toContain("サインアウト")
  },
)

it("preserves development bypass controls", async () => {
  mocks.env.adminAuthBypassEnabled = true
  const html = renderToStaticMarkup(
    await AppShell({ currentPath: "/dashboard", children: "Content" }),
  )
  expect(html).toContain("Local mode")
  expect(html).not.toContain("サインアウト")
})

it("preserves data purpose in navigation without propagating server parameters", async () => {
  const html = renderToStaticMarkup(
    await AppShell({
      currentPath: "/survey",
      children: "Content",
      searchParams: Promise.resolve({ serverId: "all", dataPurpose: "test" }),
    }),
  )
  expect(html).toContain("/participant?dataPurpose=test")
  expect(html).toMatch(/<option[^>]*value="test"[^>]*selected=""/)
})

it("shows the purpose selector on operational status and explains its environment-wide log boundary", async () => {
  const html = renderToStaticMarkup(
    await AppShell({
      currentPath: "/log",
      children: "Operations",
      searchParams: Promise.resolve({ dataPurpose: "test", period: "7" }),
    }),
  )
  expect(html).toContain("運用状況")
  expect(html).toContain("参加・回答履歴")
  expect(html).toContain(
    "運用ログ・メンテナンス・お知らせは環境全体が対象です。",
  )
  expect(html).toMatch(/<option[^>]*value="test"[^>]*selected=""/)
})
