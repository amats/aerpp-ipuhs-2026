import { env } from "@aerpp/config/server/web"
import { afterEach, expect, it, vi } from "vitest"

const { readState } = vi.hoisted(() => ({ readState: vi.fn() }))
vi.mock("next/server", () => ({ connection: async () => {} }))
vi.mock("@/features/app-context/step-state-session", () => ({
  readInitialStepState: readState,
}))
vi.mock("@/features/app-context/app-context-provider", () => ({
  AppContextProvider: () => null,
}))
vi.mock("@/features/app-shell/app-header", () => ({ default: () => null }))
vi.mock("@/features/app-shell/app-footer", () => ({ default: () => null }))

import ReceptionBoundary from "@/features/reception/reception-boundary"
import ReceptionClosed from "@/features/reception/reception-closed"
import AppShell from "./app-shell"

const cutoff = env.receptionExpiresAt
afterEach(() => {
  env.receptionExpiresAt = cutoff
  vi.clearAllMocks()
  vi.useRealTimers()
})

it("renders closure before reading any participant session after the cutoff", async () => {
  env.receptionExpiresAt = new Date(Date.now() - 1)
  const output = await AppShell({ children: <p>参加画面</p> })
  expect(output.type).toBe(ReceptionClosed)
  expect(output.props.contactEmail).toBe(env.supportContactEmail)
  expect(readState).not.toHaveBeenCalled()
})

it("places all participant routes inside the reception boundary while open", async () => {
  env.receptionExpiresAt = new Date(Date.now() + 60_000)
  readState.mockResolvedValue({ stage: "follow_up", step: "survey" })
  const output = await AppShell({ children: <p>参加画面</p> })
  expect(output.type).toBe(ReceptionBoundary)
  expect(output.props.contactEmail).toBe(env.supportContactEmail)
  expect(output.props.remainingMs).toBeGreaterThan(0)
  expect(readState).toHaveBeenCalledOnce()
})

it("subtracts session hydration time from the browser countdown", async () => {
  vi.useFakeTimers()
  const started = Date.now()
  env.receptionExpiresAt = new Date(started + 60_000)
  readState.mockImplementationOnce(async () => {
    vi.setSystemTime(started + 30_000)
    return { stage: "follow_up", step: "survey" }
  })
  const output = await AppShell({ children: <p>参加画面</p> })
  expect(output.type).toBe(ReceptionBoundary)
  expect(output.props.contactEmail).toBe(env.supportContactEmail)
  expect(output.props.remainingMs).toBe(30_000)
})

it("renders closure if the cookie cutoff passes during session hydration", async () => {
  vi.useFakeTimers()
  env.receptionExpiresAt = new Date(Date.now() + 1000)
  readState.mockImplementationOnce(async () => {
    vi.setSystemTime(env.receptionExpiresAt)
    return { stage: "unauthenticated", step: "start" }
  })
  const output = await AppShell({ children: <p>参加画面</p> })
  expect(output.type).toBe(ReceptionClosed)
  expect(output.props.contactEmail).toBe(env.supportContactEmail)
})
