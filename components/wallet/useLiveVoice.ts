"use client"

/*
 * LUMEN Live voice — ported from ITHACA (guardian/app/lib/useGuardianVoice.ts).
 * Real Gemini Live: native-audio in AND out (the natural voice, not browser TTS),
 * AudioWorklet capture (16k) + gapless jitter-buffered playback (24k) with a
 * ScriptProcessor fallback, push-to-talk, barge-in. The Live model's one tool,
 * run_keeperhub, is executed here against /api/keeperhub/act and the result is
 * spoken back. Session config (voice, tools, system instruction) is locked into
 * the ephemeral token server-side (/api/gemini-token).
 */

import { useCallback, useRef, useState } from "react"
import { GoogleGenAI } from "@google/genai"

import { openTxWindow, txUrlOf } from "@/components/wallet/txlink"

export type LiveState = "idle" | "connecting" | "ready" | "listening" | "thinking" | "talking"
export type LiveVoice = ReturnType<typeof useLiveVoice>

function b64FromBytes(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  return b
}

type LiveMessage = {
  data?: string
  toolCall?: { functionCalls?: { id: string; name: string; args?: Record<string, unknown> }[] }
  serverContent?: {
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
    interrupted?: boolean
    turnComplete?: boolean
  }
}

// Accurate "what's happening" labels while a tool runs, so the loader isn't a
// silent spinner. Shown in the center stage until the model speaks its result.
const WORK_LABELS: Record<string, string> = {
  swap_tokens: "Swapping…",
  bridge_tokens: "Bridging…",
  build_workflow: "Building your workflow…",
  execute_workflow: "Running the workflow…",
  execute_transfer: "Sending…",
  agent_pay: "Paying from your delegation…",
  drip_ccip_bnm: "Funding test tokens…",
  get_balances: "Checking your balances…",
  get_price: "Checking the price…",
  get_spending_limits: "Checking your limits…",
  list_executions: "Pulling recent activity…",
  search_protocol_actions: "Searching protocols…",
  run_keeperhub: "Working on it…",
}

export function useLiveVoice(opts?: {
  onTool?: (name: string, args: Record<string, unknown>, result: unknown) => void
  character?: string
}) {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const [state, setState] = useState<LiveState>("idle")
  const [userText, setUserText] = useState("")
  const [reply, setReply] = useState("")
  // last on-chain link a tool produced (swap/bridge/transfer) — auto-opened, and
  // shown as a click-to-open card in case the browser blocked the pop-up.
  const [lastLink, setLastLink] = useState<{ url: string; label: string } | null>(null)
  const uTurnRef = useRef("")
  const gTurnRef = useRef("")
  const sessionRef = useRef<Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null>(null)
  const micCtxRef = useRef<AudioContext | null>(null)
  const outCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const captureNodeRef = useRef<AudioWorkletNode | null>(null)
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null)
  const nextStartRef = useRef(0)
  const talkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdingRef = useRef(false)
  const wdRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const speakingRef = useRef(false)
  const wantTalkRef = useRef(false) // push-to-talk: user is holding while we connect
  const thinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // stall watchdog
  const toolBusyRef = useRef(0) // >0 while tool calls are in flight (hold "thinking")

  const playChunk = useCallback((b64: string) => {
    const out = outCtxRef.current
    if (!out) return
    const pcm = new Int16Array(bytesFromB64(b64).buffer)
    const buf = out.createBuffer(1, pcm.length, 24000)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768
    const src = out.createBufferSource()
    src.buffer = buf
    src.connect(out.destination)
    const start = Math.max(out.currentTime, nextStartRef.current)
    src.start(start)
    nextStartRef.current = start + buf.duration
    speakingRef.current = true
    setState("talking")
    src.onended = () => {
      if (nextStartRef.current <= (outCtxRef.current?.currentTime ?? 0) + 0.06) { speakingRef.current = false; setState("ready") }
    }
  }, [])

  const enqueueChunk = useCallback((b64: string) => {
    const node = playbackNodeRef.current
    if (!node) return
    const bytes = bytesFromB64(b64)
    try { node.port.postMessage(bytes.buffer, [bytes.buffer]) } catch { return }
    speakingRef.current = true
    setState("talking")
    if (talkTimerRef.current) clearTimeout(talkTimerRef.current)
    talkTimerRef.current = setTimeout(() => {
      talkTimerRef.current = null
      speakingRef.current = false
      setState((s) => (s === "talking" ? "ready" : s))
    }, 600)
  }, [])

  const handleTool = useCallback(async (fc: { id: string; name: string; args?: Record<string, unknown> }) => {
    console.log("[voice] tool call:", fc.name, fc.args)
    // Hold "thinking" for the REAL tool duration (swaps/bridges take 20-40s) with
    // an accurate label — never flip to "ready" mid-run. A long safety net only
    // recovers a genuinely hung request.
    toolBusyRef.current += 1
    setReply(WORK_LABELS[fc.name] || "Working…")
    setState("thinking")
    if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current)
    thinkTimerRef.current = setTimeout(() => {
      thinkTimerRef.current = null
      toolBusyRef.current = 0
      setState((s) => (s === "thinking" ? "ready" : s))
    }, 90000)
    let response: unknown
    try {
      if (fc.name === "run_keeperhub") {
        // catch-all → the NL router (slower, does its own reasoning)
        const r = await fetch("/api/keeperhub/act", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: String(fc.args?.command || ""), execute: !!fc.args?.execute }),
        })
        response = await r.json()
      } else {
        // specific tool → direct executor (fast, no nested LLM)
        const r = await fetch("/api/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: fc.name, args: fc.args || {} }),
        })
        response = await r.json()
      }
    } catch (e) {
      response = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    console.log("[voice] tool result:", fc.name, response)
    // if the tool moved funds (swap/bridge/transfer), open the tx link in a window
    const url = txUrlOf(response)
    if (url) {
      const label = fc.name === "swap_tokens" ? "Swap transaction" : fc.name === "bridge_tokens" ? "Bridge transaction" : "Transaction"
      openTxWindow(url)
      setLastLink({ url, label })
    }
    try { optsRef.current?.onTool?.(fc.name, fc.args || {}, response) } catch {}
    sessionRef.current?.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: response as Record<string, unknown> }] })
    // tool done → once none remain, wait a short bounded window for the model to
    // speak its result before recovering to "ready".
    toolBusyRef.current = Math.max(0, toolBusyRef.current - 1)
    if (toolBusyRef.current === 0) {
      if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current)
      thinkTimerRef.current = setTimeout(() => {
        thinkTimerRef.current = null
        setState((s) => (s === "thinking" ? "ready" : s))
      }, 15000)
    }
  }, [])

  const ensureAudio = useCallback(() => {
    if (!outCtxRef.current || outCtxRef.current.state === "closed")
      outCtxRef.current = new AudioContext({ sampleRate: 24000, latencyHint: "interactive" })
    if (!micCtxRef.current || micCtxRef.current.state === "closed")
      micCtxRef.current = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" })
    return { out: outCtxRef.current, mic: micCtxRef.current }
  }, [])

  const prime = useCallback(() => {
    const { out, mic } = ensureAudio()
    try { out.resume() } catch {}
    try { mic.resume() } catch {}
  }, [ensureAudio])

  const connect = useCallback(async () => {
    setState("connecting")
    setUserText("")
    setReply("")
    uTurnRef.current = ""
    gTurnRef.current = ""
    try {
      const tr = await fetch("/api/gemini-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character: optsRef.current?.character || "tv" }) })
      const { token, model, error } = await tr.json()
      console.log("[voice] token:", error ? "ERROR " + error : "ok", "· model:", model)
      if (error || !token) { setReply("Auth error: " + (error || "no token")); setState("idle"); return }

      ensureAudio()
      try { await outCtxRef.current!.resume(); await micCtxRef.current!.resume() } catch {}
      nextStartRef.current = 0
      playbackNodeRef.current = null

      let useWorklets = false
      try {
        if (micCtxRef.current!.audioWorklet && outCtxRef.current!.audioWorklet) {
          await Promise.all([
            micCtxRef.current!.audioWorklet.addModule("/worklets/capture-worklet.js"),
            outCtxRef.current!.audioWorklet.addModule("/worklets/playback-worklet.js"),
          ])
          const playbackNode = new AudioWorkletNode(outCtxRef.current!, "playback")
          playbackNode.connect(outCtxRef.current!.destination)
          playbackNodeRef.current = playbackNode
          useWorklets = true
        }
      } catch {
        useWorklets = false
        playbackNodeRef.current = null
      }

      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } })
      const session = await ai.live.connect({
        model,
        config: {},
        callbacks: {
          onopen: () => {
            console.log("[voice] session OPEN — ready")
            setState("ready")
            // note: the held-turn auto-start happens AFTER the mic is wired below,
            // using the resolved `session` — starting here would race (sessionRef
            // + mic not ready yet → empty turn → stuck on "thinking").
          },
          onmessage: (msg: unknown) => {
            const m = msg as LiveMessage
            if (m.toolCall?.functionCalls?.length) {
              // handleTool owns the working-state timing (holds "thinking" for the
              // real tool duration + an accurate label), so don't set a watchdog here.
              setState("thinking")
              m.toolCall.functionCalls.forEach(handleTool)
            }
            if (m.data) {
              // model is speaking → tools are done, clear the working watchdog
              if (thinkTimerRef.current) { clearTimeout(thinkTimerRef.current); thinkTimerRef.current = null }
              toolBusyRef.current = 0
              if (playbackNodeRef.current) enqueueChunk(m.data)
              else playChunk(m.data)
            }
            const it = m.serverContent?.inputTranscription?.text
            if (it) { uTurnRef.current += it; setUserText(uTurnRef.current) }
            const ot = m.serverContent?.outputTranscription?.text
            if (ot) { gTurnRef.current += ot; setReply(gTurnRef.current) }
            if (m.serverContent?.interrupted) {
              try { playbackNodeRef.current?.port.postMessage({ cmd: "flush" }) } catch {}
              if (talkTimerRef.current) { clearTimeout(talkTimerRef.current); talkTimerRef.current = null }
              if (thinkTimerRef.current) { clearTimeout(thinkTimerRef.current); thinkTimerRef.current = null }
              toolBusyRef.current = 0
              nextStartRef.current = 0
              speakingRef.current = false
              setState(holdingRef.current ? "listening" : "ready")
            }
            if (m.serverContent?.turnComplete) {
              console.log("[voice] turnComplete")
              uTurnRef.current = ""; gTurnRef.current = ""
              toolBusyRef.current = 0
              if (talkTimerRef.current) { clearTimeout(talkTimerRef.current); talkTimerRef.current = null }
              if (thinkTimerRef.current) { clearTimeout(thinkTimerRef.current); thinkTimerRef.current = null }
              setState((s) => (s === "talking" ? s : "ready"))
              setTimeout(() => setState((s) => (s === "talking" ? s : "ready")), 400)
              try { micCtxRef.current?.resume() } catch {}
            }
          },
          onerror: (e: unknown) => { console.warn("[voice] session ERROR:", e); setReply("Error: " + (e instanceof Error ? e.message : String(e))) },
          onclose: (e: unknown) => { console.log("[voice] session CLOSED:", e); setState("idle") },
        },
      })
      sessionRef.current = session

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      const micCtx = micCtxRef.current!
      const source = micCtx.createMediaStreamSource(stream)
      if (useWorklets) {
        const captureNode = new AudioWorkletNode(micCtx, "capture")
        captureNodeRef.current = captureNode
        let sent = 0
        captureNode.port.onmessage = (ev: MessageEvent) => {
          if (!holdingRef.current) return
          const buf = ev.data as ArrayBuffer
          try {
            sessionRef.current?.sendRealtimeInput({ audio: { data: b64FromBytes(new Uint8Array(buf)), mimeType: "audio/pcm;rate=16000" } })
            if (++sent % 40 === 0) console.log("[voice] mic chunks sent:", sent)
          } catch (e) { console.warn("[voice] sendRealtimeInput failed:", e) }
        }
        source.connect(captureNode)
        const sink = micCtx.createGain(); sink.gain.value = 0
        captureNode.connect(sink); sink.connect(micCtx.destination)
        console.log("[voice] mic capture wired (worklet)")
      } else {
        const proc = micCtx.createScriptProcessor(4096, 1, 1)
        procRef.current = proc
        proc.onaudioprocess = (ev) => {
          if (!holdingRef.current) return
          const f32 = ev.inputBuffer.getChannelData(0)
          const i16 = new Int16Array(f32.length)
          for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 32768 : s * 32767 }
          try { sessionRef.current?.sendRealtimeInput({ audio: { data: b64FromBytes(new Uint8Array(i16.buffer)), mimeType: "audio/pcm;rate=16000" } }) } catch {}
        }
        source.connect(proc)
        const sink = micCtx.createGain(); sink.gain.value = 0
        proc.connect(sink); sink.connect(micCtx.destination)
      }

      if (wdRef.current) clearInterval(wdRef.current)
      wdRef.current = setInterval(() => {
        const mc = micCtxRef.current
        if (mc && mc.state !== "running") mc.resume().catch(() => {})
      }, 2000)

      // held-turn auto-start: session + mic are ready now, so begin the turn
      // (use the resolved `session`, not sessionRef, to avoid the null race)
      if (wantTalkRef.current) {
        holdingRef.current = true
        nextStartRef.current = 0
        uTurnRef.current = ""
        setUserText("")
        try { session.sendRealtimeInput({ activityStart: {} }) } catch {}
        setState("listening")
        console.log("[voice] held-turn started (mic ready)")
      }
    } catch (e) {
      setReply("Failed to start: " + (e instanceof Error ? e.message : String(e)))
      setState("idle")
    }
  }, [handleTool, playChunk, enqueueChunk, ensureAudio])

  const startTalk = useCallback(() => {
    if (holdingRef.current) return
    holdingRef.current = true
    speakingRef.current = false
    nextStartRef.current = 0
    try { playbackNodeRef.current?.port.postMessage({ cmd: "flush" }) } catch {}
    if (talkTimerRef.current) { clearTimeout(talkTimerRef.current); talkTimerRef.current = null }
    uTurnRef.current = ""
    setUserText("")
    try { sessionRef.current?.sendRealtimeInput({ activityStart: {} }) } catch {}
    setState("listening")
  }, [])

  const stopTalk = useCallback(() => {
    if (!holdingRef.current) return
    holdingRef.current = false
    try { sessionRef.current?.sendRealtimeInput({ activityEnd: {} }) } catch {}
    setState("thinking")
    // watchdog: never hang on "thinking" — recover if the model doesn't respond
    if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current)
    thinkTimerRef.current = setTimeout(() => {
      thinkTimerRef.current = null
      console.warn("[voice] no response within 12s — recovering to ready")
      setState((s) => (s === "thinking" ? "ready" : s))
      setReply("I didn't catch that. Hold the mic (or J) and speak again.")
    }, 12000)
  }, [])

  // Push-to-talk: one gesture. Press → connect if needed, then start the turn as
  // soon as the session is ready (via wantTalkRef in onopen). Release → send.
  const press = useCallback(() => {
    prime()
    if (!sessionRef.current) { wantTalkRef.current = true; connect() }
    else startTalk()
  }, [prime, connect, startTalk])
  const release = useCallback(() => {
    wantTalkRef.current = false
    stopTalk()
  }, [stopTalk])

  const disconnect = useCallback(() => {
    holdingRef.current = false
    speakingRef.current = false
    if (talkTimerRef.current) { clearTimeout(talkTimerRef.current); talkTimerRef.current = null }
    if (thinkTimerRef.current) { clearTimeout(thinkTimerRef.current); thinkTimerRef.current = null }
    if (wdRef.current) { clearInterval(wdRef.current); wdRef.current = null }
    try { procRef.current?.disconnect() } catch {}
    try { captureNodeRef.current?.disconnect() } catch {}
    try { playbackNodeRef.current?.disconnect() } catch {}
    procRef.current = null
    captureNodeRef.current = null
    playbackNodeRef.current = null
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch {}
    try { sessionRef.current?.close() } catch {}
    try { micCtxRef.current?.close() } catch {}
    try { outCtxRef.current?.close() } catch {}
    micCtxRef.current = null
    outCtxRef.current = null
    setState("idle")
  }, [])

  return { state, userText, reply, lastLink, clearLink: () => setLastLink(null), connect, disconnect, startTalk, stopTalk, press, release, prime }
}
