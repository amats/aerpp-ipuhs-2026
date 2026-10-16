import { describe, expect, it } from "vitest"
import { readApiErrorCode } from "./participant-api-contract-helpers"

describe("participant API error boundary", () => {
  it("returns current and unknown future error codes", async () => {
    for (const code of ["AUTHENTICATION_INVALID", "FUTURE_ERROR"])
      expect(
        await readApiErrorCode(
          Response.json({ error: "synthetic failure", code }, { status: 401 }),
        ),
      ).toBe(code)
  })

  it("treats missing codes, malformed bodies and non-JSON failures as unknown errors", async () => {
    for (const body of [
      { error: "synthetic failure" },
      { error: "synthetic failure", code: null },
      { error: "synthetic failure", code: 500 },
      { code: "AUTHENTICATION_INVALID" },
      null,
    ])
      expect(
        await readApiErrorCode(Response.json(body, { status: 500 })),
      ).toBeNull()
    expect(
      await readApiErrorCode(
        new Response("upstream unavailable", { status: 502 }),
      ),
    ).toBeNull()
  })
})
