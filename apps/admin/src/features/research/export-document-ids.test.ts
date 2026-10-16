import { firestoreTimestampToIso } from "@aerpp/firestore/values"
import { Timestamp } from "@google-cloud/firestore"
import { expect, it } from "vitest"
import { addConsentDocumentIds } from "./export-document-ids"
import type { SourceDocument } from "./research-types"

const SECRET = "synthetic-identifier-secret"
const consent = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  data: {
    pseudonym: "person",
    email: "person@example.invalid",
    eventType: "consent",
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    consentConfirmedAt: "2026-03-20T14:59:59.999Z",
    ...data,
  },
})
const did = (records: SourceDocument[]) =>
  addConsentDocumentIds(records, SECRET)[0].data.did

it("uses JST calendar dates and preserves secret bytes", () => {
  const original = consent("first")
  const nextDay = consent("first", {
    consentConfirmedAt: "2026-03-20T15:00:00.000Z",
  })
  expect(did([original])).not.toBe(did([nextDay]))
  expect(did([nextDay])).toBe(
    did([consent("first", { consentConfirmedAt: "2026-03-21T14:59:59Z" })]),
  )
  expect(addConsentDocumentIds([original], ` ${SECRET} `)[0].data.did).not.toBe(
    did([original]),
  )
})

it.each([
  { email: undefined },
  { email: null },
  { email: " " },
  { email: "復号できません" },
  { consentConfirmedAt: undefined, createdAt: "2026-03-19T00:00:00Z" },
  { consentConfirmedAt: "invalid" },
  { consentConfirmedAt: "2026-02-30T12:00:00Z" },
  { consentConfirmedAt: "2026-09-28T12:00:00" },
  { consentConfirmedAt: { seconds: 1, nanoseconds: -1 } },
  { eventType: "unknown" },
  {
    eventType: "withdrawal",
    consentId: "missing",
    withdrawalAcceptedAt: "2026-03-22T00:00:00Z",
  },
])(
  "retains rows with null DID when required evidence is missing: %j",
  (data) => {
    expect(did([consent("row", data)])).toBeNull()
  },
)

it("does not select a different participant's dates or withdrawal links", () => {
  const original = consent("first")
  const other = consent("other", {
    pseudonym: "other-person",
    consentId: "shared-id",
    consentConfirmedAt: "2026-03-01T00:00:00Z",
  })
  expect(did([original, other])).toBe(did([original]))
  expect(
    did([
      consent("withdrawal", {
        eventType: "withdrawal",
        consentId: "shared-id",
        withdrawalAcceptedAt: "2026-03-22T00:00:00Z",
      }),
      other,
    ]),
  ).toBeNull()
})

it("derives each consent from its own record regardless of other confirmations", () => {
  const original = consent("dated")
  const rows = addConsentDocumentIds(
    [
      original,
      consent("later", { consentConfirmedAt: "2026-03-22T00:00:00Z" }),
      consent("undated", { consentConfirmedAt: null }),
    ],
    SECRET,
  )
  expect(rows[0].data.did).toBe(did([original]))
  expect(rows[1].data.did).not.toBe(rows[0].data.did)
  expect(rows[2].data.did).toBeNull()
})

it("keeps same-day confirmations identical regardless of record ID or timestamp precision", () => {
  const first = consent("document-one", {
    consentId: "confirmation-one",
    consentConfirmedAt: "2026-03-20T15:00:00.123Z",
  })
  const other = consent("document-two", {
    consentId: "confirmation-two",
    consentConfirmedAt: {
      seconds: Date.parse("2026-03-21T00:00:00Z") / 1000,
      nanoseconds: 123456789,
    },
  })
  expect(did([first])).toBe(did([other]))
})

it("requires the identifier secret even for an empty export", () => {
  expect(() => addConsentDocumentIds([], "")).toThrow(
    "Identifier hash secret required",
  )
})

it.each([999499999, 999500000, 999999999])(
  "matches the event date delivered to Web when Firestore rounds %s ns",
  (nanoseconds) => {
    const seconds = Date.parse("2026-09-28T14:59:59Z") / 1000
    const webTimestamp = firestoreTimestampToIso(
      new Timestamp(seconds, nanoseconds),
    )
    expect(
      did([consent("row", { consentConfirmedAt: { seconds, nanoseconds } })]),
    ).toBe(did([consent("row", { consentConfirmedAt: webTimestamp })]))
  },
)
