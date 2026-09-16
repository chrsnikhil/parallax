"use client"

/*
 * Shared command run-state (chat bar + center stage). Intent-gated + REAL:
 *   - a query is ANSWERED (balance etc.), never broadcasts
 *   - an action runs parse → compose → dry-run → bound → execute → tx via
 *     /api/command (KeeperHub on Sepolia), returning a genuine tx hash
 *   - over the per-action cap it rejects at BOUND before touching the chain
 * If the command came from voice, the reply is spoken back (browser TTS).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { AgentState as VizState } from "@/components/ui/bar-visualizer"
import { parseAmount } from "@/components/wallet/data"
import { openTxWindow } from "@/components/wallet/txlink"

export const STEPS = ["PARSE", "COMPOSE", "DRY-RUN", "BOUND", "EXECUTE"] as const

export type Phase =
  | "idle" | "parse" | "compose" | "dryrun" | "bound" | "execute" | "done" | "rejected" | "answered"

const PHASE_TO_STEP: Record<Phase, number> = {
  idle: -1, parse: 0, compose: 1, dryrun: 2, bound: 3, execute: 4, done: 5, rejected: 3, answered: -1,
}

export type Exchange = { cmd: string; reply: string }
export type TxInfo = { hash: string; explorer: string; chain: string }
export type CommandRun = ReturnType<typeof useCommandRun>

function speak(text: string) {
  try {
    const s = typeof window !== "undefined" ? window.speechSynthesis : undefined
    if (!s || !text) return
    s.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.03
    u.pitch = 1
    s.speak(u)
  } catch {
    /* TTS unsupported — text reply still shows */
  }
}

export function useCommandRun() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [tx, setTx] = useState<TxInfo | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [exchange, setExchange] = useState<Exchange | null>(null)
  const timers = useRef<number[]>([])
  const runId = useRef(0)
  const viaVoice = useRef(false)

  const running = phase !== "idle" && phase !== "done" && phase !== "rejected" && phase !== "answered"
  const activeStep = PHASE_TO_STEP[phase]
  const isAnswer = phase === "answered"

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const vizState: VizState | undefined =
    phase === "execute" ? "speaking"
      : phase === "done" || phase === "answered" ? "listening"
      : running ? "thinking"
      : undefined

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }

  const runWith = useCallback((raw: string, opts?: { voice?: boolean }) => {
    const text = raw.trim()
    if (!text || running) return
    clearTimers()
    setTx(null)
    viaVoice.current = !!opts?.voice
    const amt = parseAmount(text)
    setAmount(amt)
    setPhase("parse")
    setExchange({ cmd: text, reply: "Understanding your command…" })
    const myRun = ++runId.current
    at(450, () => { if (runId.current === myRun) { setPhase("compose"); setExchange({ cmd: text, reply: "Composing on KeeperHub…" }) } })

    const finish = (p: Phase, reply: string, txInfo?: TxInfo) => {
      if (runId.current !== myRun) return
      clearTimers()
      if (txInfo) { setTx(txInfo); openTxWindow(txInfo.explorer) } // open the tx in a window
      setPhase(p)
      setExchange({ cmd: text, reply })
      if (viaVoice.current) speak(reply)
    }

    ;(async () => {
      try {
        const res = await fetch("/api/keeperhub/act", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: text, execute: true }),
        })
        const data = await res.json()
        if (runId.current !== myRun) return

        if (!data.ok) {
          finish("rejected", data.detail || data.error || "Nothing ran.")
        } else if (data.mode === "execute" && data.tx?.hash) {
          // quick execution flourish, then confirm (server already did the work)
          clearTimers()
          setPhase("dryrun")
          at(180, () => runId.current === myRun && setPhase("bound"))
          at(380, () => runId.current === myRun && setPhase("execute"))
          at(650, () => finish("done", data.say || "Executed. Verifiable on-chain.", { hash: data.tx.hash, explorer: data.tx.explorer, chain: data.tx.chain || "Sepolia" }))
        } else if (data.mode === "execute") {
          finish("done", data.say || "Done.")
        } else {
          finish("answered", data.say || data.answer || data.note || "Done.")
        }
      } catch {
        finish("rejected", "Couldn't reach the executor. Check the connection and try again.")
      }
    })()
  }, [running])

  const reset = useCallback(() => {
    runId.current++
    clearTimers()
    setPhase("idle"); setTx(null); setAmount(null); setExchange(null)
  }, [])

  const statusLine = useMemo(() => exchange?.reply ?? "Ready. Tell it what to do.", [exchange])

  return { phase, tx, amount, exchange, running, activeStep, vizState, statusLine, isAnswer, runWith, reset }
}
