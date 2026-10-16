import { defaults, unseal } from "iron-webcrypto"
import { z } from "zod"

export const EMAIL_DECRYPTION_FAILURE = "復号できません"

// Only for retained contact exports and document reissue, never participant authentication.
export async function decryptExportEmail(
  encryptedEmail: string,
  password: string,
): Promise<string> {
  try {
    // iron-session's suffix is outside the MAC and must not select a decoder.
    const sealed = encryptedEmail.split("~")[0]
    const value = await unseal(
      sealed,
      { 1: password },
      {
        ...defaults,
        // Read historical records after reception ends, retaining MAC validation.
        // The epoch clock bypasses seal expiry without changing the signed bytes.
        localtimeOffsetMsec: -Date.now(),
      },
    )
    const email = z.email().safeParse(value)
    if (email.success) return email.data
  } catch {
    // Do not propagate library errors containing contact values or secrets.
  }
  throw new Error("Cannot decrypt export email")
}
