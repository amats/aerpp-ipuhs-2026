import { expect, it, vi } from "vitest"

const output = vi.hoisted(() => [] as string[])
vi.mock("pino", async (importOriginal) => {
  const { default: pino } = await importOriginal<typeof import("pino")>()
  return {
    default: (options: Parameters<typeof pino>[0]) =>
      pino(options, { write: (line) => output.push(line) }),
  }
})

import { logger } from "./logger.js"

it("emits Cloud Logging severity without duplicate numeric levels", () => {
  logger.info(
    { operation: "mailHealth", code: "MAINTENANCE_COMPLETED" },
    "Maintenance completed",
  )
  logger.warn({ operation: "startup" }, "Synthetic warning")
  logger.error(
    { operation: "mailHealth", code: "MAIL_REAUTHORIZATION_REQUIRED" },
    "Maintenance failed",
  )
  expect(output.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      severity: "INFO",
      message: "Maintenance completed",
    }),
    expect.objectContaining({ severity: "WARNING" }),
    expect.objectContaining({
      severity: "ERROR",
      operation: "mailHealth",
    }),
  ])
  for (const line of output)
    expect(JSON.parse(line)).not.toHaveProperty("level")
})
