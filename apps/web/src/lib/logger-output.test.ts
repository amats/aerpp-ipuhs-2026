import { expect, it, vi } from "vitest"

const output = vi.hoisted(() => [] as string[])
const loggingEnvironment = vi.hoisted(() => ({ nodeEnv: "production" }))
vi.mock("@aerpp/config/server/web", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@aerpp/config/server/web")>()
  return {
    ...original,
    env: {
      ...original.env,
      get nodeEnv() {
        return loggingEnvironment.nodeEnv
      },
    },
  }
})
vi.mock("pino", async (importOriginal) => {
  const { default: pino } = await importOriginal<typeof import("pino")>()
  return {
    default: (
      options: Parameters<typeof pino>[0],
      stream?: import("pino").DestinationStream,
    ) =>
      pino(
        { ...options, enabled: true },
        stream ?? { write: (line) => output.push(line) },
      ),
  }
})

import { createLogger } from "./logger"
import { LOG_EVENT } from "./logger-events"

it("applies the privacy boundary to emitted logs and child context", () => {
  output.length = 0
  const logger = createLogger({
    component: "auth",
    requestId: "synthetic-request",
    route: "/api/test?token=private-token",
  })
  logger.error({
    event: LOG_EVENT.authVerifyFailed,
    error: Object.assign(new Error("private-message"), {
      name: "private-name",
    }),
    email: "private@example.invalid",
    headers: { authorization: "private-token" },
    prompt: "private-document",
    outcome: "failed",
  })
  logger.error({ event: "private-event", error: new Error("private-error") })
  const entries = output.map((line) => JSON.parse(line))
  expect(entries[0]).toMatchObject({
    event: LOG_EVENT.authVerifyFailed,
    route: "/api/test",
    requestId: "synthetic-request",
    severity: "ERROR",
    error: { name: "Error", message: "redacted" },
  })
  expect(entries[1]).not.toHaveProperty("event")
  expect(entries[1].error.messageHash).toMatch(/^[a-f0-9]{12}$/)
  expect(output.join("")).not.toContain("private")
})

it("emits document-history failures without PDF or contact content", () => {
  output.length = 0
  createLogger({ component: "pdf", operation: "history" }).error({
    event: LOG_EVENT.pdfHistoryFailed,
    error: new Error("private failure"),
    email: "private@example.invalid",
    encryptedEmail: "private ciphertext",
    contentBase64: "private pdf",
  })
  expect(JSON.parse(output[0]).event).toBe(LOG_EVENT.pdfHistoryFailed)
  expect(output.join("")).not.toContain("private")
})

it("formats development events only after privacy filtering", async () => {
  loggingEnvironment.nodeEnv = "development"
  vi.resetModules()
  const { createLogger: createDevelopmentLogger } = await import("./logger")
  const lines: string[] = []
  const write = vi.spyOn(process.stdout, "write").mockImplementation((line) => {
    lines.push(String(line))
    return true
  })
  try {
    const logger = createDevelopmentLogger({
      component: "auth",
      requestId: "synthetic-request",
      route: "/api/test?token=private-token",
    })
    logger.error({
      event: LOG_EVENT.authVerifyFailed,
      error: new Error("private-message"),
      email: "private@example.invalid",
      session: "private-session",
      prompt: "private-document",
      clientId: "private-client",
      outcome: "failed",
    })
    logger.warn({ event: "private-event", issue: "first\nsecond" })
  } finally {
    write.mockRestore()
    loggingEnvironment.nodeEnv = "production"
  }
  expect(lines[0]).toMatch(
    /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] ERROR auth\.verify\.failed\n {2}/,
  )
  expect(lines[0]).toContain('requestId="synthetic-request"')
  expect(lines[0]).toContain('route="/api/test"')
  expect(lines[0]).toMatch(/clientId="[a-f0-9]{12}"/)
  expect(lines[0]).toContain('"message":"redacted"')
  expect(lines[0]).toMatch(/"messageHash":"[a-f0-9]{12}"/)
  expect(lines[1]).toContain("WARN  log\n")
  expect(lines[1]).toContain('issue="first\\nsecond"')
  expect(lines[1].split("\n")).toHaveLength(3)
  expect(lines.join("")).not.toContain("private")
  expect(lines.join("")).not.toMatch(
    /schemaVersion=|service=|version=|env=|severity=|logger=/,
  )
})
