"use client"

/*
 * The Command section of the bento. Returns a FRAGMENT so its pieces are direct
 * grid children of .kh-main (the CSS grid places them): four corner tiles frame
 * the centered voice visualizer. The center is adaptive — at rest it invites a
 * command; during a run it shows the live status + the bounded execution flow.
 */

import { BarVisualizer, type AgentState as BarState } from "@/components/ui/bar-visualizer"
import ClayAvatar, { CLAY_CHARS, clayHero, type ClayChar, type ClayState } from "@/components/wallet/ClayAvatar"
import { STEPS, type CommandRun } from "@/components/wallet/useCommandRun"
import type { LiveVoice } from "@/components/wallet/useLiveVoice"
import { agoFrom, type DashData } from "@/components/wallet/useDashboard"

export default function CommandStage({
  run,
  live,
  char,
  onPickChar,
  dash,
}: {
  run: CommandRun
  live: LiveVoice
  char: ClayChar
  onPickChar: (c: ClayChar) => void
  dash?: DashData | null
}) {
  const { phase, exchange, statusLine, activeStep, tx, running, isAnswer, reset } = run
  const idle = phase === "idle"
  const execs = dash?.executions ?? []
  const last = execs[0]

  // clay avatar state — when the Live voice is active it leads; otherwise the
  // avatar follows the typed-command run phase.
  const liveActive = live.state !== "idle" && live.state !== "ready"
  const clayState: ClayState = liveActive
    ? live.state === "listening" ? "listening"
      : live.state === "talking" ? "talking"
      : "thinking"
    : phase === "execute" ? "protecting"
      : phase === "done" ? "happy"
      : phase === "rejected" ? "alert"
      : phase === "answered" ? "talking"
      : running ? "thinking"
      : "idle"

  // audio bar (voice-activity) state
  const barState: BarState | undefined =
    live.state === "listening" ? "listening"
      : live.state === "talking" ? "speaking"
      : liveActive ? "thinking"
      : phase === "execute" ? "speaking"
      : running ? "thinking"
      : phase === "done" || phase === "answered" ? "listening"
      : undefined

  // voice feedback in the center (so a spoken command isn't a silent spinner):
  // show what you said + a live status that stays accurate for the whole action.
  const voiceEngaged = liveActive || !!live.reply || !!live.userText
  const voiceStatus =
    live.reply ||
    (live.state === "listening" ? "Listening…"
      : live.state === "connecting" ? "Connecting…"
      : live.state === "thinking" ? "Working…"
      : live.state === "talking" ? "Speaking…"
      : "…")

  return (
    <>
      {/* balance — real on-chain */}
      <div className="kh-tile kh-a-tl">
        <span className="kh-tile-k">Balance</span>
        <span className="kh-tile-v kh-mono">{dash?.balanceEth != null ? dash.balanceEth.toFixed(4) : "—"}</span>
        <span className="kh-tile-sub">
          Sepolia ETH{dash?.wallet ? ` · ${dash.wallet.slice(0, 6)}…${dash.wallet.slice(-4)}` : ""}
        </span>
      </div>

      {/* daily spend cap — real from KeeperHub */}
      <div className="kh-tile kh-a-tr">
        <span className="kh-tile-k">Daily cap</span>
        <span className="kh-tile-v">
          {dash?.spendCap?.capEth ?? "—"} <em className="kh-tile-unit">ETH / day</em>
        </span>
        <span className="kh-tile-sub">
          {dash?.spendCap ? `${dash.spendCap.usedEth} used today` : "—"} · Ledger-rooted
        </span>
      </div>

      {/* center voice stage */}
      <section className="kh-center" aria-live="polite">
        <div className="kh-hero">
          <ClayAvatar character={char} state={clayState} />
          <div className="kh-hero-bar" aria-hidden="true">
            <BarVisualizer
              demo
              state={barState}
              barCount={15}
              centerAlign
              minHeight={8}
              maxHeight={100}
              className="kh-viz-bars bg-transparent p-0 rounded-none overflow-visible h-full"
            />
          </div>
        </div>

        <div className="kh-charpick" role="tablist" aria-label="Voice avatar">
          {CLAY_CHARS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`kh-charchip ${char === c.id ? "is-active" : ""}`}
              onClick={() => onPickChar(c.id)}
              title={`${c.name} · ${c.role}`}
              aria-label={c.name}
              aria-pressed={char === c.id}
            >
              <img src={clayHero(c.id)} alt={c.name} />
            </button>
          ))}
        </div>

        {idle && voiceEngaged ? (
          <>
            {live.userText && <p className="kh-center-cmd">“{live.userText}”</p>}
            <p className="kh-center-status">{voiceStatus}</p>
            {live.lastLink && (
              <a className="kh-tx kh-mono kh-center-tx" href={live.lastLink.url} target="_blank" rel="noreferrer">
                {live.lastLink.label} ↗
              </a>
            )}
          </>
        ) : idle ? (
          <>
            <h2 className="kh-center-h">Speak your intent.</h2>
            <p className="kh-center-sub">
              One command. It composes the exact workflow, you approve the bounds once on
              your Ledger, and it executes.
            </p>
          </>
        ) : (
          <>
            <p className="kh-center-cmd">“{exchange?.cmd}”</p>
            <p className={`kh-center-status ${phase === "rejected" ? "is-rejected" : ""}`}>
              {statusLine}
            </p>

            {isAnswer ? (
              <span className="kh-tag">READ-ONLY · NOTHING MOVED</span>
            ) : (
              <ol className="kh-steps kh-steps--inline">
                {STEPS.map((s, i) => {
                  const done = activeStep > i || phase === "done"
                  const active = activeStep === i && running
                  const failed = phase === "rejected" && s === "BOUND"
                  return (
                    <li
                      key={s}
                      className={`kh-step ${done ? "is-done" : ""} ${active ? "is-active" : ""} ${failed ? "is-failed" : ""}`}
                    >
                      <span className="kh-step-mark">{failed ? "✕" : done ? "✓" : i + 1}</span>
                      <span className="kh-step-label">{s}</span>
                    </li>
                  )
                })}
              </ol>
            )}

            {tx && (
              <a
                className="kh-tx kh-mono kh-center-tx"
                href={tx.explorer}
                target="_blank"
                rel="noreferrer"
              >
                {tx.hash.slice(0, 16)}…{tx.hash.slice(-6)} · within bounds ✓
              </a>
            )}

            {(phase === "done" || phase === "rejected" || phase === "answered") && (
              <button type="button" className="kh-ghost-btn" onClick={reset}>
                New command
              </button>
            )}
          </>
        )}
      </section>

      {/* last execution — real from KeeperHub */}
      <div className="kh-tile kh-a-bl">
        <span className="kh-tile-k">Last execution</span>
        {last ? (
          <>
            <span className="kh-tile-v-sm">
              {String(last.kind).toUpperCase()} · {last.status}
            </span>
            <span className="kh-tile-sub">
              {last.tx ? (
                <a className="kh-tx kh-mono" href={`https://sepolia.etherscan.io/tx/${last.tx}`} target="_blank" rel="noreferrer">{last.txShort}</a>
              ) : (
                last.workflow || "workflow"
              )}{" "}
              · {agoFrom(last.when)}
            </span>
          </>
        ) : (
          <span className="kh-tile-sub">No executions yet</span>
        )}
      </div>

      {/* recent activity — real from KeeperHub */}
      <div className="kh-tile kh-a-br kh-tile--list">
        <span className="kh-tile-k">Recent</span>
        <ul className="kh-mini">
          {execs.slice(0, 3).map((e) => (
            <li key={e.id} className="kh-mini-row">
              <span className={`kh-mini-dot ${e.status === "success" ? "ok" : "bad"}`} aria-hidden="true" />
              <span className="kh-mini-act">{e.kind}</span>
              <span className="kh-mini-amt kh-mono">{e.txShort || e.status}</span>
              <span className="kh-mini-when">{agoFrom(e.when)}</span>
            </li>
          ))}
          {!execs.length && (
            <li className="kh-mini-row"><span className="kh-mini-when">Loading…</span></li>
          )}
        </ul>
      </div>
    </>
  )
}
