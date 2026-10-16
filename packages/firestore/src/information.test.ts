import {
  InformationInputSchema,
  InformationRecordSchema,
  InformationTargetSchema,
} from "@aerpp/firestore/information-types"
import { describe, expect, it } from "vitest"

describe("information boundary validation", () => {
  const input = { content: "お知らせ", expireAt: "2030-01-01T00:00:00.000Z" }
  it("retains the Support contract including UTF-8 byte limits", () => {
    expect(InformationInputSchema.safeParse(input).success).toBe(true)
    for (const invalid of [
      { ...input, content: "" },
      { ...input, content: "あ".repeat(333334) },
      { ...input, content: "\ud800" },
      { ...input, tone: "other" },
      { ...input, expireAt: "0000-01-01T00:00:00.000Z" },
      { ...input, expireAt: "2030-01-01" },
      { ...input, createdAt: "injected" },
    ])
      expect(InformationInputSchema.safeParse(invalid).success).toBe(false)
  })
  it("requires complete current notice records", () => {
    const record = {
      ...input,
      id: "notice",
      version: { seconds: 123456789, nanoseconds: 0 },
      tone: "info",
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    expect(InformationRecordSchema.safeParse(record).success).toBe(true)
    for (const field of ["content", "tone", "expireAt", "createdAt"]) {
      const missing: Record<string, unknown> = { ...record }
      delete missing[field]
      expect(InformationRecordSchema.safeParse(missing).success).toBe(false)
      expect(
        InformationRecordSchema.safeParse({ ...record, [field]: null }).success,
      ).toBe(false)
    }
  })
  it("rejects paths and lossy or invalid concurrency tokens", () => {
    const version = { seconds: 123456789, nanoseconds: 123456789 }
    expect(
      InformationTargetSchema.parse({ id: "notice", version }).version,
    ).toEqual(version)
    for (const id of [
      "",
      "../secret",
      "a/b",
      ".",
      "..",
      "__reserved__",
      "あ".repeat(501),
    ]) {
      expect(InformationTargetSchema.safeParse({ id, version }).success).toBe(
        false,
      )
    }
    for (const invalid of [
      { seconds: 1 },
      { seconds: 1, nanoseconds: 1e9 },
      { seconds: 1.5, nanoseconds: 0 },
    ]) {
      expect(
        InformationTargetSchema.safeParse({ id: "notice", version: invalid })
          .success,
      ).toBe(false)
    }
  })
})
