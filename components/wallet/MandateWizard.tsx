"use client"

/*
 * Custom mandate wizard: click "Set mandate" → pick protocols → pick actions →
 * sign with the Ledger root. The result is a MetaMask functionCall-scoped
 * delegation enforced on-chain — the agent can ONLY touch the allowlisted
 * protocols with the allowlisted methods. "Prove on-chain" runs an allowed
 * action (succeeds) and an off-mandate one (reverts) to show it's real.
 */

import { useCallback, useEffect, useState } from "react"

import { openTxWindow } from "@/components/wallet/txlink"
import { signMandateWithLedger, type LedgerContext } from "@/lib/ledgerMandate"

type Catalog = {
  protocols: { id: string; label: string; address: string }[]
  actions: { id: string; label: string; selector: string }[]
}
type Active = { active: boolean; protocols?: string[]; actions?: string[]; expiresAt?: string; signature?: string }
type Redeem = { ok: boolean; broadcast?: boolean; reverted?: boolean; tx?: { explorer: string; hash: string }; openUrl?: string; summary: string; detail?: string }
type Proof = { ok: boolean; error?: string; allowed?: Redeem; blocked?: Redeem }

const short = (s?: string) => (s ? `${s.slice(0, 8)}…${s.slice(-6)}` : "—")

export default function MandateWizard() {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [ctx, setCtx] = useState<LedgerContext | null>(null)
  const [active, setActive] = useState<Active | null>(null)
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [protos, setProtos] = useState<string[]>([])
  const [acts, setActs] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [sigStatus, setSigStatus] = useState<string | null>(null)
  const [proof, setProof] = useState<Proof | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/mandate", { cache: "no-store" }).then((x) => x.json())
      if (r.ok) { setCat(r.catalog); setCtx(r.context); setActive(r.mandate) }
    } catch { /* offline */ }
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const sign = async () => {
    if (!cat || !ctx) return
    setBusy("sign")
    setSigStatus(null)
    try {
      // sign on the physical Ledger (browser → WebHID → the Flex tap)
      const { owner, signedDelegation } = await signMandateWithLedger({ protocols: protos, actions: acts, catalog: cat, context: ctx, onStatus: setSigStatus })
      setSigStatus("Deploying your Ledger-owned account…")
      const r = await fetch("/api/mandate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set-ledger", owner, signedDelegation, protocols: protos, actions: acts }) }).then((x) => x.json())
      if (r.ok) { setSigStatus(null); setStep(0); setProof(null); await load() }
      else setSigStatus(r.error || "Couldn't store the mandate.")
    } catch (e) {
      setSigStatus(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }
  const prove = async () => {
    setBusy("prove")
    try {
      const r: Proof = await fetch("/api/mandate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prove" }) }).then((x) => x.json())
      setProof(r)
      if (r.allowed?.openUrl) openTxWindow(r.allowed.openUrl)
    } finally { setBusy(null) }
  }

  const startNew = () => { setProtos(active?.active ? [] : protos); setActs([]); setStep(1) }

  return (
    <div className="kh-panel" style={{ marginTop: "clamp(16px,2.4vw,22px)" }}>
      <div className="kh-sec-head">
        <span className="kh-sec-title">Custom mandate · on-chain enforced</span>
        <span className="kh-sec-hint">allowlist protocols + actions · signed on your Ledger</span>
      </div>

      {/* IDLE: show active mandate or invite to set one */}
      {step === 0 && (
        <>
          {active?.active ? (
            <>
              <div className="kh-mandate-grid">
                <div className="kh-kv"><span>protocols</span><span className="kh-chips">{active.protocols?.map((p) => <i className="kh-chip" key={p}>{p}</i>)}</span></div>
                <div className="kh-kv"><span>actions</span><span className="kh-chips">{active.actions?.map((a) => <i className="kh-chip" key={a}>{a}</i>)}</span></div>
                <div className="kh-kv"><span>expires</span><b>{active.expiresAt ? new Date(active.expiresAt).toLocaleDateString() : "—"}</b></div>
                <div className="kh-kv"><span>Ledger signature</span><b className="kh-mono">{short(active.signature)}</b></div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button className="kh-btn" onClick={prove} disabled={!!busy}>{busy === "prove" ? "Testing on-chain…" : "Prove on-chain"}</button>
                <button className="kh-btn kh-btn-ghost" onClick={startNew} disabled={!!busy}>New mandate</button>
              </div>
            </>
          ) : (
            <>
              <p className="kh-deleg-summary">No mandate set — the agent is bounded only by the base delegation. Set a mandate to restrict it to specific protocols and actions.</p>
              <button className="kh-btn" onClick={startNew} disabled={!cat}>Set mandate</button>
            </>
          )}
        </>
      )}

      {/* STEP 1: protocols */}
      {step === 1 && (
        <>
          <p className="kh-deleg-summary"><b>Step 1 — Allow these protocols</b> (the only contracts the agent may touch)</p>
          <div className="kh-chip-pick">
            {cat?.protocols.map((p) => (
              <button key={p.id} type="button" className={`kh-pick ${protos.includes(p.id) ? "is-on" : ""}`} onClick={() => toggle(protos, setProtos, p.id)}>{p.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="kh-btn" onClick={() => setStep(2)} disabled={!protos.length}>Next: actions →</button>
            <button className="kh-btn kh-btn-ghost" onClick={() => setStep(0)}>Cancel</button>
          </div>
        </>
      )}

      {/* STEP 2: actions */}
      {step === 2 && (
        <>
          <p className="kh-deleg-summary"><b>Step 2 — Allow these actions</b> (the only methods the agent may call)</p>
          <div className="kh-chip-pick">
            {cat?.actions.map((a) => (
              <button key={a.id} type="button" className={`kh-pick ${acts.includes(a.id) ? "is-on" : ""}`} onClick={() => toggle(acts, setActs, a.id)}>{a.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="kh-btn" onClick={sign} disabled={!acts.length || !!busy}>{busy === "sign" ? "Waiting for your Flex…" : "Sign mandate on Ledger Flex"}</button>
            <button className="kh-btn kh-btn-ghost" onClick={() => setStep(1)} disabled={!!busy}>← Back</button>
          </div>
          {sigStatus && <p className="kh-deleg-note" style={{ marginTop: 10 }}>{sigStatus}</p>}
          <p className="kh-sec-hint" style={{ marginTop: 8 }}>Chrome/Edge · plug in your Ledger Flex + open the Ethereum app.</p>
        </>
      )}

      {/* PROOF */}
      {proof && (
        <div className="kh-deleg-signed" style={{ marginTop: 12 }}>
          <div className="kh-kv">
            <span>allowed action</span>
            {proof.allowed?.ok && proof.allowed.tx ? (
              <a className="kh-tx kh-mono" href={proof.allowed.tx.explorer} target="_blank" rel="noreferrer">{short(proof.allowed.tx.hash)} · executed ✓</a>
            ) : (
              <b style={{ color: "var(--kh-faint)" }}>{proof.allowed?.summary}</b>
            )}
          </div>
          <div className="kh-kv">
            <span>off-mandate action</span>
            <b style={{ color: proof.blocked?.reverted ? "var(--kh-primary)" : "var(--kh-danger)" }}>{proof.blocked?.reverted ? "reverted on-chain ✓" : "not blocked ✗"}</b>
          </div>
          {proof.blocked?.detail && <p className="kh-deleg-note kh-mono" style={{ fontSize: 11 }}>{proof.blocked.detail.split("\n").find((l) => /Enforcer/.test(l)) || proof.blocked.detail.slice(0, 120)}</p>}
        </div>
      )}
    </div>
  )
}
