import { env } from "@aerpp/config/server/web"
import { type NextRequest, NextResponse } from "next/server"

import {
  createRequestId,
  normalizeRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/request-id"

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  const requestId =
    normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ??
    createRequestId()
  requestHeaders.set(REQUEST_ID_HEADER, requestId)

  const path = new URL(request.url).pathname
  // Reject disabled inspection routes before rendering can commit a streamed 200.
  const response =
    env.debugPagesEnabled !== true &&
    (path === "/debug" || path.startsWith("/debug/") || path === "/reset")
      ? new Response(null, {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        })
      : NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.json|apple-icon.png|icon.svg).*)",
  ],
}
