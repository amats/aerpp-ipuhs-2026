import { describe, expect, it } from "vitest"
import { participationEventSchema } from "./participation-event-types"

const owner = {
  id: "history",
  serverId: "server",
  clientId: "client",
  pseudonym: "participant",
  documentSet: { version: "1.0", sha256: "a".repeat(64) },
  encryptedEmail: "synthetic-ciphertext",
  consentRequestedAt: "2026-03-19T00:00:00.000Z",
}

describe("consent history event times", () => {
  it.each([
    ["consent", "consentConfirmedAt"],
    ["withdrawal", "withdrawalAcceptedAt"],
  ] as const)("uses %s event time for document dates", (eventType, field) => {
    const result = participationEventSchema.parse({
      ...owner,
      eventType,
      [field]: "2026-03-20T00:00:00.000Z",
    })
    expect(result.eventAt).toEqual(new Date("2026-03-20T00:00:00.000Z"))
    expect(result).not.toHaveProperty("createdAt")
    for (const timestamp of [undefined, null, "invalid"]) {
      expect(
        participationEventSchema.safeParse({
          ...owner,
          eventType,
          [field]: timestamp,
        }).success,
      ).toBe(false)
    }
  })
})
