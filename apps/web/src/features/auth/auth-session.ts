import "server-only"

import { headers } from "next/headers"
import { z } from "zod"
import { readEmailFromSession } from "@/features/auth/email"
import { EMAIL_REGEXP } from "@/features/auth/email-regexp"
import {
  createPseudonym,
  readClientIdFromSession,
  readPseudonymFromSession,
} from "@/features/identity/participant-identifiers"
import { createLogger, getRequestContextFromHeaders } from "@/lib/logger"
import type { AppSession } from "@/lib/session"

type LocalAuthenticationSession = {
  authVerifiedAt: string | null
  clientId: string | null
  email: string | null
  pseudonym: string | null
}

const authVerifiedAtSessionSchema = z.string().datetime()

export async function createAuthLogger(operation: string) {
  const headerStore = await headers()
  return createLogger({
    ...getRequestContextFromHeaders(headerStore),
    component: "auth",
    operation,
  })
}

export function matchesSessionEmail(
  storedEmail: string | null,
  email: string,
): boolean {
  return storedEmail?.trim().toLowerCase() === email.trim().toLowerCase()
}

export function isLocallyAuthenticated(
  values: LocalAuthenticationSession,
): boolean {
  if (!values.authVerifiedAt || !values.clientId) {
    return false
  }

  const email = values.email?.trim().toLowerCase()
  if (!email || !EMAIL_REGEXP.test(email)) {
    return false
  }

  const expectedPseudonym = createPseudonym(email)
  return expectedPseudonym !== null && values.pseudonym === expectedPseudonym
}

export async function readLocalAuthenticationFromSession(
  session: AppSession,
): Promise<LocalAuthenticationSession> {
  const parsedAuthVerifiedAt = authVerifiedAtSessionSchema.safeParse(
    session.authVerifiedAt,
  )

  return {
    authVerifiedAt: parsedAuthVerifiedAt.success
      ? parsedAuthVerifiedAt.data
      : null,
    clientId: await readClientIdFromSession(session),
    email: await readEmailFromSession(session),
    pseudonym: await readPseudonymFromSession(session),
  }
}
