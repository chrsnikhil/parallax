import { NextResponse } from "next/server"

import { parseVoice } from "@/lib/gemini"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * POST /api/gemini/voice  { audio: <base64>, mimeType }  -> { transcript, intent }
 * Real Gemini multimodal: the spoken clip is understood directly by Gemini.
 * Push-to-talk records a clip in the browser and posts it here.
 */
export async function POST(req: Request) {
  const { audio, mimeType } = await req.json().catch(() => ({ audio: "" }))
  if (!audio) return NextResponse.json({ ok: false, error: "audio (base64) required" }, { status: 400 })
  return NextResponse.json(await parseVoice(audio, mimeType || "audio/webm"))
}
