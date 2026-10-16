import { createHash } from "node:crypto"
import { throwApiError } from "./api-errors.js"
import type { Transaction } from "./storage.js"
import { getFirestore, Timestamp } from "./storage.js"

export async function readLimit(
  tx: Transaction,
  key: string,
  maximum: number,
  windowMs: number,
  now = Date.now(),
  minimumIntervalMs = 0,
) {
  const ref = getFirestore()
    .collection("supportRateLimits")
    .doc(createHash("sha256").update(key).digest("hex"))
  const data = (await tx.get(ref)).data()
  if (
    minimumIntervalMs > 0 &&
    data?.lastAttemptAtMs !== undefined &&
    (!Number.isFinite(data.lastAttemptAtMs) ||
      now < data.lastAttemptAtMs + minimumIntervalMs)
  )
    throwApiError(429, "RATE_LIMITED", "request limit reached; retry later")
  const windowStart = Math.floor(now / windowMs) * windowMs
  const count = data?.windowStart === windowStart ? data.count : 0
  if (!Number.isInteger(count) || count < 0 || count >= maximum)
    throwApiError(429, "RATE_LIMITED", "request limit reached; retry later")
  return {
    ref,
    data: {
      windowStart,
      ...(minimumIntervalMs > 0 ? { lastAttemptAtMs: now } : {}),
      count: count + 1,
      expireAt: Timestamp.fromMillis(windowStart + 2 * windowMs),
    },
  }
}
export async function limitCaller(credentialId: string) {
  await getFirestore().runTransaction(async (tx) => {
    const limit = await readLimit(tx, `api:${credentialId}`, 120, 60_000)
    tx.set(limit.ref, limit.data)
  })
}
