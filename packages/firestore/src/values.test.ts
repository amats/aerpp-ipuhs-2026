import {
  firestoreTimestampToIso,
  isFutureFirestoreTimestamp,
  serializeFirestoreValue,
} from "@aerpp/firestore/values"
import { Timestamp } from "@google-cloud/firestore"
import { expect, it } from "vitest"

it("keeps expiry authorization strict and excludes the exact deadline", () => {
  const now = 10_000
  expect(isFutureFirestoreTimestamp(Timestamp.fromMillis(now + 1), now)).toBe(
    true,
  )
  expect(isFutureFirestoreTimestamp(Timestamp.fromMillis(now), now)).toBe(false)
  expect(isFutureFirestoreTimestamp(Timestamp.fromMillis(now - 1), now)).toBe(
    false,
  )
  for (const invalid of [
    null,
    undefined,
    now + 1,
    new Date(now + 1),
    { seconds: 100 },
    { toMillis: () => now + 1 },
    "2030-01-01T00:00:00Z",
  ]) {
    expect(isFutureFirestoreTimestamp(invalid, now)).toBe(false)
  }
})
it("separates millisecond display strings from precision-preserving export values", () => {
  const timestamp = new Timestamp(1, 123456789)
  expect(firestoreTimestampToIso(timestamp)).toBe("1970-01-01T00:00:01.123Z")
  expect(firestoreTimestampToIso({ seconds: 1 })).toBeNull()
  const value = {
    timestamp,
    nested: [null, "", 0, false, new Date(0), NaN, Infinity, -Infinity],
  }
  expect(serializeFirestoreValue(value)).toEqual({
    timestamp: { seconds: 1, nanoseconds: 123456789 },
    nested: [
      null,
      "",
      0,
      false,
      "1970-01-01T00:00:00.000Z",
      { firestoreNumber: "NaN" },
      { firestoreNumber: "Infinity" },
      { firestoreNumber: "-Infinity" },
    ],
  })
  expect(value.timestamp).toBe(timestamp)
  expect(serializeFirestoreValue({})).toEqual({})
})
