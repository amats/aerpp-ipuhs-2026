import { createHmac } from "node:crypto"

function identifierSuffix(secret: string, input: readonly string[]) {
  if (secret.length === 0) throw new Error("Identifier secret required")
  return createHmac("sha256", secret)
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 32)
}

function normalizedEmail(email: string) {
  const normalized = email.trim().toLowerCase().normalize("NFKC")
  if (normalized.length === 0) throw new Error("Identifier email required")
  return normalized
}

// Server-only derivation. Freeze version, normalization and literal key bytes
// for the study. DID dates use the same Japan-calendar representation in both apps.
export function deriveParticipantPseudonym(email: string, secret: string) {
  return `aerpp:pid-${identifierSuffix(secret, ["aerpp:pid:v1", normalizedEmail(email)])}`
}

export function deriveParticipantDocumentId(
  email: string,
  date: string,
  purpose: "consent" | "withdrawal",
  secret: string,
  documentSetSha256: string,
) {
  if (/^[a-f0-9]{64}$/.test(documentSetSha256) !== true)
    throw new Error("Document set digest required")
  if (date.trim().length === 0) throw new Error("Document date required")
  return `aerpp:did-${identifierSuffix(secret, ["aerpp:did:v2", normalizedEmail(email), purpose, date.trim(), documentSetSha256])}`
}

export function formatParticipantDocumentDate(date: Date): string {
  const japan = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  if (!Number.isFinite(japan.getTime()))
    throw new Error("Valid document date required")
  return `${japan.getUTCFullYear()}年${japan.getUTCMonth() + 1}月${japan.getUTCDate()}日`
}
