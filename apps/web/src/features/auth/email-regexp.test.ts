import { afterEach, describe, expect, it, vi } from "vitest"

describe("EMAIL_REGEXP", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN
    vi.resetModules()
  })

  it.each(["", "   "])(
    "uses the default email format for a blank pattern %j",
    async (pattern) => {
      process.env.NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN = pattern
      const { EMAIL_REGEXP } = await import("./email-regexp")
      expect(EMAIL_REGEXP.test("user@example.com")).toBe(true)
      expect(EMAIL_REGEXP.test("not-an-email")).toBe(false)
      expect(EMAIL_REGEXP.test("")).toBe(false)
    },
  )

  it("ignores regex flags provided via NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN", async () => {
    process.env.NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN =
      "/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/g"

    const { EMAIL_REGEXP } = await import("./email-regexp")

    expect(EMAIL_REGEXP.flags).toBe("")
    expect(EMAIL_REGEXP.test("user@example.com")).toBe(true)
    expect(EMAIL_REGEXP.test("user@example.com")).toBe(true)
  })
})
