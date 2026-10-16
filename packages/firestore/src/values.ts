import { Timestamp } from "@google-cloud/firestore"

// Authorization accepts actual SDK timestamps only; display/export coercion is separate.
export function isFutureFirestoreTimestamp(
  value: unknown,
  now = Date.now(),
): boolean {
  return value instanceof Timestamp && value.toMillis() > now
}

export function firestoreTimestampToIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null
}

// Preserve nanoseconds and invalid numeric observations in raw research exports.
export function serializeFirestoreValue(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value))
    return { firestoreNumber: String(value) }
  if (value instanceof Timestamp)
    return { seconds: value.seconds, nanoseconds: value.nanoseconds }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeFirestoreValue)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        serializeFirestoreValue(item),
      ]),
    )
  return value
}
