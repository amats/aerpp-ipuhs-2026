import type { ReactNode } from "react"
import { renderToStaticMarkup as renderHtml } from "react-dom/server"
import { beforeEach, expect, it, vi } from "vitest"
import AppShell from "@/features/app-shell/app-shell"
import Dashboard from "@/features/dashboard/dashboard"
import InformationDraftProvider from "@/features/information/information-draft-provider"
import ParticipantPage from "@/features/participant/participant"
import SurveyResults from "@/features/survey/survey-results"
import ParticipantActivity from "@/features/updates/participant-activity"

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  participant: vi.fn(),
  survey: vi.fn(),
  activity: vi.fn(),
}))
function renderToStaticMarkup(element: ReactNode) {
  return renderHtml(
    <InformationDraftProvider>{element}</InformationDraftProvider>,
  )
}

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logger", () => ({ logPageDataFailure: vi.fn() }))
vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => ({
    user: { email: "admin@example.invalid" },
  }),
}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: {
    adminAuthBypassEnabled: false,
    supportReceptionExpiresAt: new Date("2026-09-30T15:00:00Z"),
    supportBackendStopsAt: new Date("2026-11-30T14:59:59.999Z"),
  },
}))
vi.mock("@/features/monitoring/participant-records", () => ({
  getConfiguredServerId: () => "configured-server",
}))
vi.mock("@/features/dashboard/load-dashboard-data", () => ({
  loadDashboardData: mocks.dashboard,
}))
vi.mock("@/features/participant/load-participant-page-data", () => ({
  loadParticipantPageData: mocks.participant,
}))
vi.mock("@/features/survey/load-survey-page-data", () => ({
  loadSurveyPageData: mocks.survey,
}))
vi.mock("@/features/updates/load-activity-page-data", () => ({
  loadActivityPageData: mocks.activity,
}))
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams("dataPurpose=test"),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  for (const loader of Object.values(mocks))
    loader.mockRejectedValue(new Error("synthetic-private-sdk-message"))
})

it.each([
  ["/dashboard", Dashboard],
  ["/participant", ParticipantPage],
  ["/survey", SurveyResults],
  ["/updates", ParticipantActivity],
] as const)(
  "keeps navigation and a safe retry view for %s load failures",
  async (currentPath, Component) => {
    const searchParams = Promise.resolve({ dataPurpose: "test" })
    const html = renderToStaticMarkup(
      await AppShell({
        currentPath,
        searchParams,
        children: await Component({ searchParams }),
      }),
    )
    expect(html).toContain("データを取得できませんでした")
    expect(html).toMatch(/<button[^>]*>再試行<\/button>/)
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-label="メインナビゲーション"')
    expect(html).toContain('href="/participant?dataPurpose=test"')
    expect(html).not.toContain("synthetic-private-sdk-message")
    expect(html).not.toContain("最新状態の人数")
    expect(html).not.toContain("直近の更新一覧")
    expect(html).not.toContain("件中")
  },
)
