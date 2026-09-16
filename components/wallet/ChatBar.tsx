"use client"

/*
 * Bottom of the bento: the always-present command bar.
 *   - text box → the KeeperHub router (run.runWith), answer shown in the center
 *   - mic → Gemini LIVE (native-audio) voice: tap to connect, then hold to talk.
 *     The Live model calls run_keeperhub and speaks the result back naturally.
 */

import { useRef, useState, type FormEvent } from "react"
import { Mic, ArrowUp } from "lucide-react"

import { VoiceButton, type VoiceButtonState } from "@/components/ui/voice-button"
import type { CommandRun } from "@/components/wallet/useCommandRun"
import type { LiveVoice } from "@/components/wallet/useLiveVoice"

export default function ChatBar({
  run,
  live,
  onFocusCommand,
}: {
  run: CommandRun
  live: LiveVoice
  onFocusCommand: () => void
}) {
  const [cmd, setCmd] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const micDown = () => {
    onFocusCommand()
    live.press() // hold-to-talk: connects if needed, then starts your turn
  }
  const micUp = () => {
    live.release() // release → send
  }

  const voiceState: VoiceButtonState =
    live.state === "listening" ? "recording"
      : live.state === "talking" ? "recording"
      : live.state === "connecting" || live.state === "thinking" ? "processing"
      : "idle"

  const micLabel =
    live.state === "idle" ? "Tap to start voice"
      : live.state === "ready" ? "Hold to talk"
      : live.state === "listening" ? "Release to send"
      : live.state === "talking" ? "Speaking…"
      : "Working…"

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = cmd.trim()
    if (!t || run.running) return
    onFocusCommand()
    run.runWith(t)
    setCmd("")
  }

  return (
    <form className="kh-chatbar" onSubmit={submit}>
      <span
        className="kh-mic-hold"
        // Capture the pointer on press so holding survives small cursor moves and
        // the button re-rendering into its "recording" state. Release ONLY on
        // pointerup/cancel — never on pointerleave, which was cutting the mic off.
        onPointerDown={(e) => {
          e.preventDefault()
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
          micDown()
        }}
        onPointerUp={(e) => {
          try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
          micUp()
        }}
        onPointerCancel={micUp}
        style={{ display: "inline-flex", touchAction: "none" }}
        title={micLabel}
      >
        <VoiceButton
          size="icon"
          variant="ghost"
          state={voiceState}
          icon={<Mic className="size-4" />}
          onPress={() => {}}
          aria-label={micLabel}
        />
      </span>
      <input
        ref={inputRef}
        className="kh-chatbar-input"
        value={cmd}
        onChange={(e) => setCmd(e.target.value)}
        placeholder="Hold the mic or press J to talk, or type — check limits, search Aave, send ETH…"
        spellCheck={false}
        aria-label="Command"
      />
      <button
        type="submit"
        className="kh-chatbar-send"
        disabled={run.running || !cmd.trim()}
        aria-label="Send command"
      >
        {run.running ? <span className="kh-chatbar-dots" aria-hidden="true">···</span> : <ArrowUp className="size-4" />}
      </button>
    </form>
  )
}
