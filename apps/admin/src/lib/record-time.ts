import { z } from "zod"

const ISO_TIMESTAMP_SCHEMA = z.iso.datetime({ offset: true })

export function dateMillis(value: unknown): number | null {
  if (value instanceof Date) return dateMillis(value.getTime())
  if (typeof value === "number")
    return Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? value : null
  if (typeof value === "string")
    return ISO_TIMESTAMP_SCHEMA.safeParse(value).success
      ? dateMillis(Date.parse(value))
      : null
  if (value === null || typeof value !== "object") return null
  if ("seconds" in value) {
    const seconds = value.seconds
    const nanos = "nanoseconds" in value ? value.nanoseconds : 0
    if (
      typeof seconds !== "number" ||
      !Number.isInteger(seconds) ||
      seconds < -62135596800 ||
      seconds > 253402300799 ||
      typeof nanos !== "number" ||
      !Number.isInteger(nanos) ||
      nanos < 0 ||
      nanos > 999999999
    )
      return null
    // Match Firestore Timestamp.toDate(), used by Support for Web PDF dates.
    return seconds * 1000 + Math.round(nanos / 1e6)
  }
  if ("toDate" in value && typeof value.toDate === "function") {
    try {
      const date = value.toDate()
      return date instanceof Date ? dateMillis(date) : null
    } catch {
      return null
    }
  }
  return null
}
