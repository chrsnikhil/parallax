import { NextResponse } from "next/server"

import { mintLiveToken } from "@/lib/gemini"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * GET /api/gemini/token -> a short-lived ephemeral token for the browser Live
 * (voice) client, minted from the server-side key so the raw key never ships.
 */
export async function GET() {
  return NextResponse.json(await mintLiveToken())
}
