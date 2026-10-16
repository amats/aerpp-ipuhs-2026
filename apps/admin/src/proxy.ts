import { env } from "@aerpp/config/server/admin"
import type { NextFetchEvent, NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { type NextRequestWithAuth, withAuth } from "next-auth/middleware"
import { isAllowedAdminEmail } from "@/lib/admin-access"

const authProxy = withAuth({
  callbacks: {
    authorized: ({ token }) => isAllowedAdminEmail(token?.email) === true,
  },
})

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (env.adminAuthBypassEnabled === true) {
    return NextResponse.next()
  }

  return authProxy(request as NextRequestWithAuth, event)
}

export const config = {
  matcher: [
    "/((?!(?:icon\\.svg|apple-icon\\.png|manifest\\.json|robots\\.txt|android-chrome-(?:192x192|512x512)\\.png)$).*)",
  ],
}
