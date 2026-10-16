import { createHash, timingSafeEqual } from "node:crypto"
import type { Credential } from "@aerpp/config/support"
import type { TokenPayload } from "google-auth-library"
import { throwApiError } from "./api-errors.js"

export function authenticateCaller(
  header: unknown,
  credentials: readonly Credential[],
  environment: string,
  operation: string,
  now = Date.now(),
): Credential {
  const match =
    typeof header === "string" &&
    /^Bearer ([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{43,128})$/.exec(header)
  if (!match) return throwApiError(401, "UNAUTHORIZED", "unauthorized")
  const credential = credentials.find((entry) => entry.id === match[1])
  const hash = createHash("sha256").update(match[2]).digest()
  const expected = Buffer.from(
    credential?.verifierHash ?? "0".repeat(64),
    "hex",
  )
  if (
    !timingSafeEqual(hash, expected) ||
    !credential ||
    credential.revoked ||
    credential.environment !== environment ||
    now < credential.notBeforeMs ||
    now >= credential.expiresAtMs
  )
    return throwApiError(401, "UNAUTHORIZED", "unauthorized")
  if (!credential.operations.includes(operation))
    return throwApiError(403, "OPERATION_FORBIDDEN", "operation not permitted")
  return credential
}

export function assertSchedulerClaims(
  payload: TokenPayload | undefined,
  audience: string,
  identity: string,
  now = Date.now(),
) {
  if (
    !payload ||
    !["https://accounts.google.com", "accounts.google.com"].includes(
      payload.iss,
    ) ||
    payload.aud !== audience ||
    payload.email !== identity ||
    payload.email_verified !== true ||
    !payload.sub ||
    !Number.isFinite(payload.exp) ||
    payload.exp * 1000 <= now ||
    !Number.isFinite(payload.iat) ||
    payload.iat * 1000 > now + 30_000
  )
    throwApiError(401, "UNAUTHORIZED", "unauthorized")
}
