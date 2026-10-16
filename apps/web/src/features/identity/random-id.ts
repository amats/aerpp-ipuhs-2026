import "server-only"

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

export function generateRandomIdSuffix(length: number): string | null {
  if (!Number.isSafeInteger(length) || length < 1 || length > 256) return null
  const webCrypto = globalThis.crypto
  if (!webCrypto?.getRandomValues) {
    return null
  }

  try {
    let suffix = ""
    // Reject the last eight byte values so every character has equal probability.
    // Bound retries rather than accepting a short ID if the random source fails.
    for (let round = 0; round < 32 && suffix.length < length; round++) {
      const bytes = webCrypto.getRandomValues(new Uint8Array(length))
      for (const byte of bytes) {
        if (byte < 248) suffix += ALPHABET[byte % ALPHABET.length]
        if (suffix.length === length) return suffix
      }
    }
    return null
  } catch {
    return null
  }
}
