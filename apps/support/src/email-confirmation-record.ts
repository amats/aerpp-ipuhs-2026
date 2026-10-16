// Consent history owns contact ciphertext; completed proof retains exact-retry
// verifiers without the pending-link TTL, duplicate email or nonce.
export function completedConfirmationProof(record: Record<string, unknown>) {
  const {
    expireAt: _deadline,
    encryptedEmail: _email,
    tokenNonce: _nonce,
    ...proof
  } = record
  return proof
}
