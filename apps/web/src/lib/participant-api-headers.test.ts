import { describe, expect, it, vi } from "vitest"

const settings = vi.hoisted(() => ({
  receptionExpiresAt: new Date("2099-01-01T00:00:00Z"),
  supportApiCredential: `synthetic.${"a".repeat(43)}`,
}))
vi.mock("@aerpp/config/server/web", () => ({ env: settings }))

import { participantApiHeaders } from "./participant-api-headers"

describe("participant API authentication", () => {
  it("sends only the selected backend credential header", () => {
    settings.supportApiCredential = `synthetic.${"a".repeat(43)}`
    expect(participantApiHeaders()).toEqual({
      Authorization: `Bearer ${settings.supportApiCredential}`,
    })
  })
})
