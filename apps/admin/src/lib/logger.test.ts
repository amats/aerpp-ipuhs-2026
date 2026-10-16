import { expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const output = vi.hoisted(() => [] as string[])
vi.mock("pino", async (importOriginal) => {
  const { default: pino } = await importOriginal<typeof import("pino")>()
  return {
    default: (options: Parameters<typeof pino>[0]) =>
      pino(options, { write: (line) => output.push(line) }),
  }
})

import { logAuthenticationFailure, logAuthenticationWarning } from "./logger"

it("emits fixed authentication diagnostics with Cloud Logging severity", () => {
  logAuthenticationFailure()
  logAuthenticationWarning()
  expect(output.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      severity: "ERROR",
      operation: "authenticateAdmin",
      code: "AUTHENTICATION_FAILED",
    }),
    expect.objectContaining({
      severity: "WARNING",
      operation: "authenticateAdmin",
      code: "AUTHENTICATION_WARNING",
    }),
  ])
})
