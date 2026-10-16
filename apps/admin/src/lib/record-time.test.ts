import { firestoreTimestampToIso } from "@aerpp/firestore/values"
import { Timestamp } from "@google-cloud/firestore"
import { expect, it } from "vitest"
import { dateMillis } from "./record-time"

it.each([
  [0, 0],
  [new Date(0), 0],
  [{ seconds: 0, nanoseconds: 0 }, 0],
  [{ seconds: 1 }, 1000],
  [{ toDate: () => new Date(1234) }, 1234],
  ["2024-02-29T09:00:00+09:00", Date.parse("2024-02-29T00:00:00Z")],
  ["2024-02-29T00:00:00.123Z", Date.parse("2024-02-29T00:00:00.123Z")],
])("reads explicit timestamps including epoch zero: %j", (value, expected) => {
  expect(dateMillis(value)).toBe(expected)
})

it.each([
  undefined,
  null,
  false,
  "",
  "1",
  "2026-02-30T12:00:00Z",
  "2026-09-28T12:00:00",
  "2026-09-28",
  Number.NaN,
  Infinity,
  8.64e15 + 1,
  new Date(Number.NaN),
  { seconds: 1.5 },
  { seconds: 253402300800 },
  { seconds: -62135596801 },
  { seconds: 1, nanoseconds: -1 },
  { seconds: 1, nanoseconds: 1000000000 },
  { seconds: 1, nanoseconds: "123" },
  { seconds: 1, nanoseconds: null },
  { toDate: () => "2026-09-28T12:00:00Z" },
  {
    toDate: () => {
      throw new Error("Invalid timestamp")
    },
  },
])("does not invent a timestamp for malformed input: %j", (value) => {
  expect(dateMillis(value)).toBeNull()
})

it.each([999499999, 999500000, 999999999])(
  "matches Support's Firestore conversion at the Japan date boundary: %s ns",
  (nanoseconds) => {
    const seconds = Date.parse("2026-09-28T14:59:59Z") / 1000
    const timestamp = new Timestamp(seconds, nanoseconds)
    const expected = firestoreTimestampToIso(timestamp)
    for (const value of [timestamp, { seconds, nanoseconds }]) {
      const milliseconds = dateMillis(value)
      expect(milliseconds).not.toBeNull()
      expect(new Date(milliseconds as number).toISOString()).toBe(expected)
    }
  },
)
