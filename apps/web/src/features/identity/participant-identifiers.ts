import "server-only"

import { env } from "@aerpp/config/server/web"
import {
  deriveParticipantDocumentId,
  deriveParticipantPseudonym,
} from "@aerpp/participant-api-contracts/identifiers"
import { z } from "zod"
import { ID_CONSTRAINTS } from "@/features/identity/id-constraints"
import { generateRandomIdSuffix } from "@/features/identity/random-id"
import type { AppSession } from "@/lib/session"

const clientIdSessionSchema = z
  .string()
  .regex(new RegExp(`^${ID_CONSTRAINTS.clientIdPrefix}[A-Za-z0-9]+$`))
const pseudonymSessionSchema = z
  .string()
  .regex(new RegExp(`^${ID_CONSTRAINTS.pseudonymPrefix}[A-Za-z0-9]+$`))

export async function readClientIdFromSession(
  session: AppSession,
): Promise<string | null> {
  const parsedClientId = clientIdSessionSchema.safeParse(session.clientId)
  return parsedClientId.success ? parsedClientId.data : null
}

export function createClientId(): string | null {
  const id = generateRandomIdSuffix(ID_CONSTRAINTS.suffixLength)
  if (!id) {
    return null
  }
  return ID_CONSTRAINTS.clientIdPrefix + id
}

export function createPseudonym(email: string): string | null {
  if (!email || email.trim() === "") {
    return null
  }

  try {
    return deriveParticipantPseudonym(email, env.identifierHashSecret)
  } catch {
    return null
  }
}

export async function readPseudonymFromSession(
  session: AppSession,
): Promise<string | null> {
  const parsedPseudonym = pseudonymSessionSchema.safeParse(session.pseudonym)
  return parsedPseudonym.success ? parsedPseudonym.data : null
}

export function createParticipantDocumentId(
  email: string,
  date: string,
  purpose: string,
  documentSetSha256: string,
): string | null {
  if (
    !email ||
    email.trim() === "" ||
    !date ||
    (purpose !== "consent" && purpose !== "withdrawal")
  ) {
    return null
  }

  try {
    return deriveParticipantDocumentId(
      email,
      date,
      purpose,
      env.identifierHashSecret,
      documentSetSha256,
    )
  } catch {
    return null
  }
}
