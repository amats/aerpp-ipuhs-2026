import { redirect } from "next/navigation"
import { expect, it, vi } from "vitest"
import Dashboard from "./dashboard"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  log: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({ env: {} }))
vi.mock("@/lib/auth", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@/lib/logger", () => ({ logPageDataFailure: mocks.log }))
vi.mock("./load-dashboard-data", () => ({ loadDashboardData: mocks.load }))

it("authenticates before the data-read error boundary or any dashboard reads", async () => {
  mocks.auth.mockImplementation(() => redirect("/api/auth/signin"))
  await expect(Dashboard({})).rejects.toThrow("NEXT_REDIRECT")
  expect(mocks.auth).toHaveBeenCalledWith("/dashboard")
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.log).not.toHaveBeenCalled()
})
