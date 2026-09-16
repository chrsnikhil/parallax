"use client"

/*
 * Push-to-talk voice, backed by Gemini multimodal. Click the mic to record,
 * click again to send: the clip goes to /api/gemini/voice, Gemini transcribes +
 * extracts the intent, and we hand the transcript back to drive the command run.
 * Degrades gracefully — if there's no mic/permission it just reports an error
 * state and the text box still works.
 */

import { useCallback, useEffect, useRef, useState } from "react"

export type VoicePhase = "idle" | "listening" | "thinking" | "error"

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => {
      const s = String(r.result)
      resolve(s.slice(s.indexOf(",") + 1))
    }
    r.onerror = reject
    r.readAsDataURL(b)
  })
}

export function useVoice(onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<VoicePhase>("idle")
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const cbRef = useRef(onTranscript)
  useEffect(() => { cbRef.current = onTranscript }, [onTranscript])

  const fail = () => { setPhase("error"); setTimeout(() => setPhase("idle"), 1600) }

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return fail()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunks.current = []
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setPhase("thinking")
        try {
          const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" })
          const audio = await blobToBase64(blob)
          const res = await fetch("/api/gemini/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio, mimeType: blob.type }),
          })
          const j = await res.json()
          const text: string | undefined = j?.intent?.transcript
          setPhase("idle")
          if (text && text.trim()) cbRef.current(text.trim())
        } catch {
          fail()
        }
      }
      rec.current = mr
      mr.start()
      setPhase("listening")
    } catch {
      fail()
    }
  }, [])

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop()
  }, [])

  const toggle = useCallback(() => {
    if (phase === "listening") stop()
    else if (phase === "idle") start()
  }, [phase, start, stop])

  return { phase, toggle }
}
