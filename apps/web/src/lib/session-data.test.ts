import { expect, it } from "vitest"
import { splitSessionData } from "./session-data"
import { hashSessionState } from "./session-state-hash"

it("accepts browser-generated coordination identifiers", () => {
  expect(
    splitSessionData({ coordinationId: "11111111-1111-1111-1111-111111111111" })
      .state.coordinationId,
  ).toBe("11111111-1111-1111-1111-111111111111")
})

it("excludes email and private request context from business hashing", () => {
  const state = { stage: "unauthenticated", rootStep: "start" }
  expect(hashSessionState({ ...state, email: "first@example.invalid" })).toBe(
    hashSessionState({
      ...state,
      email: "second@example.invalid",
      preparedConsentContext: "ciphertext",
    }),
  )
  const parts = splitSessionData({
    ...state,
    email: "first@example.invalid",
    preparedConsentContext: "ciphertext",
  })
  expect(parts.state).toEqual(state)
  expect(parts.privateState).toMatchObject({
    email: "first@example.invalid",
    preparedConsentContext: "ciphertext",
  })
})

it("shares intro and result/survey hashes while binding consent identity", () => {
  const intro = { stage: "unauthenticated", rootStep: "start" }
  for (const rootStep of ["explanation", "consent"])
    expect(hashSessionState({ ...intro, rootStep })).toBe(
      hashSessionState(intro),
    )
  expect(hashSessionState({ ...intro, consentId: "first" })).not.toBe(
    hashSessionState({ ...intro, consentId: "second" }),
  )
  expect(hashSessionState({ stage: "authenticated", rootStep: "result" })).toBe(
    hashSessionState({ stage: "authenticated", rootStep: "survey" }),
  )
})

it.each([
  "document",
  "analysisResult",
  "surveyAnswer",
  "encryptedEmail",
  "expiresAt",
  "withdrawalHadCompletedAnalysis",
])("rejects unallowlisted %s from persisted session state", (field) => {
  expect(() =>
    splitSessionData({
      stage: "unauthenticated",
      rootStep: "start",
      [field]: "private content",
    }),
  ).toThrow()
})
