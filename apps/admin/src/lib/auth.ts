import "server-only"

import { env } from "@aerpp/config/server/admin"
import { redirect } from "next/navigation"
import { getServerSession, type NextAuthOptions, type Session } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { isAllowedAdminEmail } from "@/lib/admin-access"
import {
  logAuthenticationFailure,
  logAuthenticationWarning,
} from "@/lib/logger"

const localBypassSession: Session = {
  user: {
    email: "local-auth-bypass@example.com",
    name: "Local Auth Bypass",
  },
  expires: "9999-12-31T23:59:59.999Z",
}

export const authOptions: NextAuthOptions = {
  secret: env.nextAuthSessionSecret,
  // NextAuth's default logger includes raw OAuth errors and metadata.
  logger: {
    error: () => logAuthenticationFailure(),
    warn: () => logAuthenticationWarning(),
    debug: () => {},
  },
  providers:
    env.adminAuthBypassEnabled === true
      ? []
      : [
          GoogleProvider({
            httpOptions: { timeout: 15_000 },
            clientId: env.adminGoogleOAuthClientId ?? "",
            clientSecret: env.adminGoogleOAuthClientSecret ?? "",
          }),
        ],
  callbacks:
    env.adminAuthBypassEnabled === true
      ? undefined
      : {
          async signIn({ user, account, profile }) {
            return (
              account?.provider === "google" &&
              profile !== undefined &&
              "email_verified" in profile &&
              profile.email_verified === true &&
              isAllowedAdminEmail(user.email) === true
            )
          },
        },
}

export async function requireAdminSession(callbackUrl = "/dashboard") {
  if (env.adminAuthBypassEnabled === true) {
    return localBypassSession
  }

  const session = await getServerSession(authOptions)
  if (!session || isAllowedAdminEmail(session.user?.email) !== true) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }
  return session
}
