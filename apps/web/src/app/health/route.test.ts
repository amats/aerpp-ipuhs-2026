import { describe, expect, it } from "vitest"

const { GET } = await import("./route")

describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "ok" })
  })
})
