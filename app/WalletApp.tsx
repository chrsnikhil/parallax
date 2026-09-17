"use client"

/*
 * PARALLAX — the wallet, as a minimal tiled bento. Lives at the dark landing where
 * the hero scroll ends (a fixed overlay that fades in near the bottom, so the
 * hero's 500vh pacing is untouched).
 *
 * Layout: a left rail (Sidebar) + a bento main grid —
 *   state bar on top · voice visualizer centered and framed by four live tiles ·
 *   command bar pinned to the bottom.
 * The chat bar and the center stage share ONE run (useCommandRun), so a command
 * typed anywhere plays out in the middle. Sidebar sections swap the center.
 *
 * Built on the real ElevenLabs UI kit; Tailwind v4 is hero-safe (no preflight,
 * tokens scoped to .kh-app, source scanning pinned to the wallet — see wallet.css).
 */

import { useEffect, useRef, useState } from "react"
import "./wallet.css"

import Sidebar, { type ViewKey } from "@/components/wallet/Sidebar"
import StateBar from "@/components/wallet/StateBar"
import ChatBar from "@/components/wallet/ChatBar"
import CommandStage from "@/components/wallet/CommandStage"
import PortfolioView from "@/components/wallet/PortfolioView"
import AutomationsView from "@/components/wallet/AutomationsView"
import DelegationView from "@/components/wallet/DelegationView"
import ActivityView from "@/components/wallet/ActivityView"
import { useCommandRun } from "@/components/wallet/useCommandRun"
import { useLiveVoice } from "@/components/wallet/useLiveVoice"
import { useDashboard } from "@/components/wallet/useDashboard"
import { CLAY_CHARS, type ClayChar } from "@/components/wallet/ClayAvatar"

export default function WalletApp() {
  const [view, setView] = useState<ViewKey>("command")
  const run = useCommandRun()

  // clay character (drives both the avatar and the Gemini Live voice) — persisted
  const [char, setChar] = useState<ClayChar>("tv")
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("kh.char") : null
    if (saved && CLAY_CHARS.some((c) => c.id === saved)) setChar(saved as ClayChar)
  }, [])
  const pickChar = (c: ClayChar) => {
    setChar(c)
    try { window.localStorage.setItem("kh.char", c) } catch {}
  }

  // real KeeperHub data (spend cap, executions) + on-chain balance
  const dash = useDashboard()

  // Gemini Live (native-audio) voice — shared by the mic (ChatBar) and the
  // clay avatar (CommandStage reacts to its state). Refresh the dashboard after
  // any tool the voice runs so tiles/activity update live.
  const live = useLiveVoice({ character: char, onTool: () => dash.refresh() })
  const liveBusy = live.state !== "idle" && live.state !== "ready"

  // Fade the cockpit in only once the hero scroll reaches the very end (the dark
  // landing). 0.985 = the last sliver of the 500vh runway.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const progress = max > 0 ? window.scrollY / max : 0
      setShown(progress >= 0.985)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // Keyboard push-to-talk: hold "J" to talk, release to send. Ignored while
  // typing in a field, and only while the cockpit is on screen.
  const pressRef = useRef(live.press)
  pressRef.current = live.press
  const releaseRef = useRef(live.release)
  releaseRef.current = live.release
  const shownRef = useRef(shown)
  shownRef.current = shown
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if ((e.key === "j" || e.key === "J") && !e.repeat && shownRef.current && !typing() && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setView("command")
        pressRef.current()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === "j" || e.key === "J") releaseRef.current()
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  return (
    <section className={`kh-app ${shown ? "kh-shown" : ""}`} id="app">
      <div className="kh-ambient" aria-hidden="true" />

      <Sidebar view={view} onSelect={setView} />

      <main className={`kh-main ${view === "command" ? "is-command" : "is-panel"}`}>
        <StateBar busy={run.running || liveBusy} data={dash.data} />

        {view === "command" ? (
          <CommandStage run={run} live={live} char={char} onPickChar={pickChar} dash={dash.data} />
        ) : (
          <div className="kh-viewport">
            {view === "portfolio" && <PortfolioView />}
            {view === "automations" && <AutomationsView />}
            {view === "delegation" && <DelegationView />}
            {view === "activity" && <ActivityView data={dash.data} />}
          </div>
        )}

        <ChatBar run={run} live={live} onFocusCommand={() => setView("command")} />
      </main>

      {live.lastLink && (
        <div className="kh-txcard" role="status">
          <span className="kh-txcard-dot" aria-hidden="true" />
          <div className="kh-txcard-body">
            <b>{live.lastLink.label}</b>
            <span>Opened in a new tab</span>
          </div>
          <a className="kh-txcard-open" href={live.lastLink.url} target="_blank" rel="noopener noreferrer">
            Open ↗
          </a>
          <button className="kh-txcard-x" onClick={live.clearLink} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </section>
  )
}
