import "server-only"

import { z } from "zod"
import { createPseudonym } from "@/features/identity/participant-identifiers"
import type { AppSession } from "@/lib/session"
import { sealSessionData, unsealSessionData } from "@/lib/session-seal"

const sessionEmailSchema = z.email().transform((email) => email.toLowerCase())

// Reads a normalized email from session and treats missing or invalid values as absent.
export async function readEmailFromSession(
  session: AppSession,
): Promise<string | null> {
  const parsedEmail = sessionEmailSchema.safeParse(session.email)
  return parsedEmail.success ? parsedEmail.data : null
}

// Writes a validated email and its derived pseudonym to the provided session.
export async function writeEmailToSession(
  session: AppSession,
  email: string,
): Promise<string | null> {
  try {
    const parsedEmail = sessionEmailSchema.safeParse(email.trim())
    if (!parsedEmail.success) {
      return null
    }
    const pseudonym = createPseudonym(parsedEmail.data)
    if (!pseudonym) {
      return null
    }
    session.email = parsedEmail.data
    session.pseudonym = pseudonym
    return pseudonym
  } catch {
    return null
  }
}

// Seals an email for client transport without exposing the raw address.
export async function encryptEmail(email: string): Promise<string | null> {
  try {
    const encryptedEmail = await sealSessionData(email)
    if (!encryptedEmail) {
      return null
    }
    return encryptedEmail
  } catch {
    return null
  }
}

// Unseals an email and revalidates it before returning it to callers.
export async function decryptEmail(
  encryptedEmail: string,
): Promise<string | null> {
  try {
    const email = await unsealSessionData<string>(encryptedEmail)
    const parsedEmail = sessionEmailSchema.safeParse(email)
    if (!parsedEmail.success) {
      return null
    }
    return parsedEmail.data
  } catch {
    return null
  }
}
