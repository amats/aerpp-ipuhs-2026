import { describe, expect, it } from "vitest"

import {
  LOG_SCHEMA_VERSION,
  sanitizeLogContext,
  serializeError,
  toLogSeverity,
} from "./logger"

describe("sanitizeLogContext", () => {
  it("drops disallowed fields and hashes protected identifiers", () => {
    const context = sanitizeLogContext({
      analysisId: "analysis_123",
      clientId: "client_abc",
      documentCount: 2,
      email: "user@example.com",
      pseudonym: "psn_123",
    })

    expect(context).toEqual({
      analysisId: "analysis_123",
      clientId: expect.stringMatching(/^[a-f0-9]{12}$/),
      pseudonym: expect.stringMatching(/^[a-f0-9]{12}$/),
    })
  })

  it("excludes research measurements while preserving operational diagnostics", () => {
    expect(
      sanitizeLogContext({
        documentCount: 2,
        documentGraphemeCount: 300,
        totalCodeUnits: 300,
        totalGraphemeCount: 300,
        resultGraphemeCount: 50,
        modelName: "synthetic-model",
        processingDurationSeconds: 1,
        outcome: "completed",
        analysisId: "synthetic-analysis",
      }),
    ).toEqual({ outcome: "completed", analysisId: "synthetic-analysis" })
  })

  it("excludes URL query contents from route diagnostics", () => {
    const context = sanitizeLogContext({
      route: "/api/test?email=user@example.com",
    })

    expect(context).toEqual({
      route: "/api/test",
    })
  })

  it("keeps only structured trace identifiers rather than arbitrary header contents", () => {
    expect(
      sanitizeLogContext({
        traceId: "private-header-content",
        filename: "private-name.docx",
      }),
    ).toBeUndefined()
    const traceId = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`
    expect(sanitizeLogContext({ traceId })).toEqual({ traceId })
    expect(sanitizeLogContext({ target: "user@example.invalid" })).toEqual({
      target: "[redacted-email]",
    })
  })

  it("keeps documentId in the sanitized context", () => {
    const context = sanitizeLogContext({
      documentId: "aerpp:did-12345",
    })

    expect(context).toEqual({
      documentId: "aerpp:did-12345",
    })
  })

  it("keeps workflow diagnostics used by feature logs", () => {
    const context = sanitizeLogContext({
      invalidCount: 1,
      issue: "missing_analysis_id",
      rootStep: "survey",
    })

    expect(context).toEqual({
      invalidCount: 1,
      issue: "missing_analysis_id",
      rootStep: "survey",
    })
  })
})

describe("serializeError", () => {
  it("does not trust custom error names, causes or nested SDK fields", () => {
    const error = Object.assign(
      new Error("private-message", { cause: new Error("private-cause") }),
      {
        name: "private-email@example.invalid",
        details: "private-token",
      },
    )
    const result = serializeError(error)
    expect(result.name).toBe("Error")
    expect(JSON.stringify(result)).not.toContain("private")
  })

  it("redacts runtime error messages while preserving correlation", () => {
    const serialized = serializeError(
      new Error(
        "request failed for user@example.com with prompt: sensitive document body",
      ),
    )

    expect(serialized).toEqual({
      message: "redacted",
      messageHash: expect.stringMatching(/^[a-f0-9]{12}$/),
      name: "Error",
    })
    expect(JSON.stringify(serialized)).not.toContain("user@example.com")
    expect(JSON.stringify(serialized)).not.toContain("sensitive document body")
  })
})

describe("toLogSeverity", () => {
  it("maps pino levels to generic severities", () => {
    expect(toLogSeverity("debug")).toBe("DEBUG")
    expect(toLogSeverity("info")).toBe("INFO")
    expect(toLogSeverity("warn")).toBe("WARNING")
    expect(toLogSeverity("error")).toBe("ERROR")
    expect(toLogSeverity("fatal")).toBe("CRITICAL")
  })

  it("keeps unknown levels uppercase for downstream routing", () => {
    expect(toLogSeverity("notice")).toBe("NOTICE")
  })
})

describe("LOG_SCHEMA_VERSION", () => {
  it("pins the structured log schema version", () => {
    expect(LOG_SCHEMA_VERSION).toBe(1)
  })
})

it("keeps operational queue health while dropping retained payloads", () => {
  expect(
    sanitizeLogContext({
      pendingCount: 3,
      blockedCount: 1,
      oldestAgeMs: 60_000,
      outcome: "unconfirmed",
      payload: JSON.stringify({ email: "private@example.invalid" }),
    }),
  ).toEqual({
    pendingCount: 3,
    blockedCount: 1,
    oldestAgeMs: 60_000,
    outcome: "unconfirmed",
  })
})
