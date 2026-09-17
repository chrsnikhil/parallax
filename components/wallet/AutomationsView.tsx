"use client"

import { useState } from "react"
import { AUTOMATIONS, type Automation } from "@/components/wallet/data"

type Live = { workflowId?: string; link?: string; busy?: boolean; ran?: string; balance?: string; err?: string }

export default function AutomationsView() {
  const [live, setLive] = useState<Record<string, Live>>({})
  const patch = (id: string, p: Live) => setLive((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))

  const deploy = async (a: Automation) => {
    patch(a.id, { busy: true, err: undefined })
    try {
      const r = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy", name: `PARALLAX: ${a.title}`, description: a.trigger }),
      })
      const j = await r.json()
      if (j.ok && j.id) patch(a.id, { busy: false, workflowId: j.id, link: j.link })
      else patch(a.id, { busy: false, err: j.detail || "deploy failed" })
    } catch {
      patch(a.id, { busy: false, err: "network error" })
    }
  }

  const run = async (a: Automation) => {
    const wf = live[a.id]?.workflowId
    if (!wf) return
    patch(a.id, { busy: true, err: undefined })
    try {
      const r = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", id: wf }),
      })
      const j = await r.json()
      const status = j.status as any
      const out = status?.logs?.execution?.output ?? status?.output
      const st = status?.status?.status ?? (j.ok ? "success" : "failed")
      patch(a.id, { busy: false, ran: st, balance: out?.balance })
    } catch {
      patch(a.id, { busy: false, err: "network error" })
    }
  }

  return (
    <div className="kh-view">
      <div className="kh-sec-head">
        <span className="kh-sec-title">KeeperHub workflows</span>
        <span className="kh-sec-hint">deploy to KeeperHub · run on-chain</span>
      </div>

      <div className="kh-autos">
        {AUTOMATIONS.map((a) => {
          const l = live[a.id] || {}
          return (
            <article className="kh-auto" key={a.id}>
              <div className="kh-auto-top">
                <span className="kh-auto-title">{a.title}</span>
                <span className={`kh-status ${l.workflowId ? "ok" : a.status}`}>
                  <i />
                  {l.workflowId ? "Deployed" : a.statusLabel}
                </span>
              </div>

              <p className="kh-auto-trigger">
                <b>Trigger · </b>
                {a.trigger}
              </p>

              <div className="kh-auto-meta">
                <div className="kh-auto-actions">
                  <button className="kh-mini-btn" onClick={() => deploy(a)} disabled={l.busy}>
                    {l.busy && !l.workflowId ? "Deploying…" : l.workflowId ? "Redeploy" : "Deploy"}
                  </button>
                  <button className="kh-mini-btn accent" onClick={() => run(a)} disabled={l.busy || !l.workflowId}>
                    {l.busy && l.workflowId ? "Running…" : "Run"}
                  </button>
                </div>
                {l.link && (
                  <a className="kh-auto-link kh-mono" href={l.link} target="_blank" rel="noreferrer">
                    {l.workflowId?.slice(0, 10)}…
                  </a>
                )}
              </div>

              {(l.ran || l.err) && (
                <p className="kh-auto-out">
                  {l.err ? (
                    <span style={{ color: "var(--kh-danger)" }}>{l.err}</span>
                  ) : (
                    <>
                      Ran on KeeperHub · <b style={{ color: "var(--kh-primary)" }}>{l.ran}</b>
                      {l.balance && <> · wallet balance {Number(l.balance).toFixed(4)} ETH</>}
                    </>
                  )}
                </p>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
