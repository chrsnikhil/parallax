import { NextResponse } from "next/server"

import { parseIntent } from "@/lib/gemini"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * POST /api/gemini/intent  { text }  -> structured intent
 * GET  /api/gemini/intent?text=...   -> self-test (defaults to a sample command)
 * The voice channel and the text box both resolve a command through this.
 */
export async function POST(req: Request) {
  const { text } = await req.json().catch(() => ({ text: "" }))
  if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 })
  return NextResponse.json(await parseIntent(text))
}

export async function GET(req: Request) {
  const text = new URL(req.url).searchParams.get("text") || "Move 40 USDC into the best yield on Aave"
  return NextResponse.json({ sample: text, ...(await parseIntent(text)) })
}
