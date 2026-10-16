import "server-only"
import { deriveParticipantPseudonym } from "@aerpp/participant-api-contracts/identifiers"

// Match the shared Web derivation, including normalization and literal key bytes.
export function deriveRecoveryPseudonym(email: string, secret: string): string {
  return deriveParticipantPseudonym(email, secret)
}
