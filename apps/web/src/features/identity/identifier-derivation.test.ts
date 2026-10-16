import {
  deriveParticipantDocumentId,
  deriveParticipantPseudonym,
  formatParticipantDocumentDate,
} from "@aerpp/participant-api-contracts/identifiers"
import { expect, it } from "vitest"

const secret = "synthetic-identifier-secret"
it("pins the versioned HMAC representation and domain separation", () => {
  expect(
    deriveParticipantPseudonym("person@example.invalid", secret),
  ).toHaveLength(42)
  expect(
    deriveParticipantDocumentId(
      "person@example.invalid",
      "2026年3月20日",
      "consent",
      secret,
      "a".repeat(64),
    ),
  ).toHaveLength(42)
  expect(deriveParticipantPseudonym(" PERSON@EXAMPLE.INVALID ", secret)).toBe(
    "aerpp:pid-adc0246ab71baf83eed95b5d77a4e689",
  )
  expect(
    deriveParticipantPseudonym("ＰＥＲＳＯＮ@example.invalid", secret),
  ).toBe("aerpp:pid-adc0246ab71baf83eed95b5d77a4e689")
  expect(
    deriveParticipantDocumentId(
      "person@example.invalid",
      "2026年3月20日",
      "consent",
      secret,
      "a".repeat(64),
    ),
  ).toBe("aerpp:did-b2452bd0cf7b9ae1fcb4bba54647bf1a")
  expect(
    deriveParticipantDocumentId(
      "person@example.invalid",
      "2026年3月20日",
      "withdrawal",
      secret,
      "a".repeat(64),
    ),
  ).toBe("aerpp:did-782312ff4480cb22fcebce3c01647bcc")
  expect(
    deriveParticipantDocumentId(
      "person@example.invalid",
      "2026年3月21日",
      "consent",
      secret,
      "a".repeat(64),
    ),
  ).not.toBe("aerpp:did-b2452bd0cf7b9ae1fcb4bba54647bf1a")
  expect(
    deriveParticipantPseudonym("person@example.invalid", ` ${secret} `),
  ).toBe("aerpp:pid-8b37943850e629626c8ff744662e203b")
})
it("pins Japan calendar boundaries without relying on localized runtime formatting", () => {
  expect(
    formatParticipantDocumentDate(new Date("2026-03-20T14:59:59.999Z")),
  ).toBe("2026年3月20日")
  expect(
    formatParticipantDocumentDate(new Date("2026-03-20T15:00:00.000Z")),
  ).toBe("2026年3月21日")
  expect(() => formatParticipantDocumentDate(new Date(NaN))).toThrow()
  expect(() => deriveParticipantPseudonym(" ", secret)).toThrow()
  expect(() =>
    deriveParticipantPseudonym("person@example.invalid", ""),
  ).toThrow()
})

it("binds DID v2 to the document set without changing PID or identifier length", () => {
  const original = deriveParticipantDocumentId(
    "person@example.invalid",
    "2026年3月20日",
    "consent",
    secret,
    "a".repeat(64),
  )
  const changed = deriveParticipantDocumentId(
    "person@example.invalid",
    "2026年3月20日",
    "consent",
    secret,
    "b".repeat(64),
  )
  expect(original).not.toBe(changed)
  expect(original).toHaveLength(42)
  expect(deriveParticipantPseudonym("person@example.invalid", secret)).toBe(
    "aerpp:pid-adc0246ab71baf83eed95b5d77a4e689",
  )
  expect(() =>
    deriveParticipantDocumentId(
      "person@example.invalid",
      "2026年3月20日",
      "consent",
      secret,
      "",
    ),
  ).toThrow()
})
