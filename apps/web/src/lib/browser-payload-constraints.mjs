// Bound JSON before encryption and leave room for AES padding, the seal envelope,
// action arguments and multipart framing. These are byte budgets, not token counts.
const MAX_ENVELOPE_BYTES = 1024 * 1024
export const BROWSER_PAYLOAD_CONSTRAINTS = {
  maxEnvelopeBytes: MAX_ENVELOPE_BYTES,
  maxSealedCharacters: Math.ceil(MAX_ENVELOPE_BYTES / 3) * 4 + 1024,
  maxActionBodyBytes: 2 * 1024 * 1024,
}
