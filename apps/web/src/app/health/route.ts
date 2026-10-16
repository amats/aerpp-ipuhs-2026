import { NextResponse } from "next/server"

// Returns a minimal health response for uptime checks.
export async function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 })
}
