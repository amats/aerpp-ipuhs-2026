import { notFound, redirect } from "next/navigation"
import { beforeEach, expect, it, vi } from "vitest"
import { loadPageData } from "./load-page-data"

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("pino", () => ({ default: () => ({ error: logError }) }))

beforeEach(() => vi.clearAllMocks())

it("distinguishes a failed read from a successful empty result and allows retry", async () => {
  const error = Object.assign(new Error("synthetic-private-message"), {
    code: 7,
    details: "synthetic-private-email@example.invalid",
    metadata: { authorization: "synthetic-private-token" },
  })
  const emptyData = { totalRecords: 0, records: [] }
  const read = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(emptyData)

  const failure = await loadPageData("loadParticipantPageData", read)
  expect(failure).toEqual({ ok: false })
  expect(logError).toHaveBeenCalledExactlyOnceWith(
    { operation: "loadParticipantPageData", status: 7 },
    "Data request failed",
  )
  const serialized = JSON.stringify([failure, logError.mock.calls])
  for (const value of [
    error.message,
    error.details,
    error.metadata.authorization,
  ])
    expect(serialized).not.toContain(value)

  expect(await loadPageData("loadParticipantPageData", read)).toEqual({
    ok: true,
    data: emptyData,
  })
  expect(logError).toHaveBeenCalledTimes(1)
})

it.each(["synthetic-private-code", Infinity, 700, 1.5, undefined])(
  "omits unsupported status codes (%s)",
  async (code) => {
    await loadPageData("loadSurveyPageData", async () => {
      throw { code, message: "synthetic-private-message" }
    })
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      { operation: "loadSurveyPageData", status: undefined },
      "Data request failed",
    )
  },
)

it.each([
  ["authentication redirect", () => redirect("/api/auth/signin")],
  ["not found", () => notFound()],
] as const)("preserves framework control flow: %s", async (_, interrupt) => {
  await expect(
    loadPageData("loadDashboardData", async () => interrupt()),
  ).rejects.toThrow()
  expect(logError).not.toHaveBeenCalled()
})
