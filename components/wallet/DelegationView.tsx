"use client"

/*
 * Delegation — the REAL MetaMask Delegation Toolkit flow, live on Sepolia:
 *   1. a deployed MetaMask Smart Account (owned by the Ledger stand-in key),
 *   2. funded through KeeperHub,
 *   3. a scoped delegation (cap + allowlist + expiry) signed by the owner,
 *   4. the agent REDEEMS it on-chain to move funds within the caveats,
 *   5. exceeding the cap reverts on-chain — the limit is real, not UI.
 * Every hash links to Etherscan; nothing here is mocked.
 */

import { useCallback, useEffect, useState } from "react"

import { openTxWindow } from "@/components/wallet/txlink"
import MandateWizard from "@/components/wallet/MandateWizard"

type Status = {
  configured: boolean
  smartAccount?: string
  smartAccountUrl?: string
  owner?: string
  agent?: string
  deployed?: boolean
  balances?: { smartAccountEth: string; agentEth: string }
  delegationManager?: string
  error?: string
}
type Bounds = { spendCapEth: string; allowlist: string[]; expiresAt: string }
type Redeem = { ok: boolean; broadcast?: boolean; tx?: { hash: string; explorer: string }; openUrl?: string; summary: string; detail?: string; reverted?: boolean; enforcementProof?: boolean }

const short = (a?: string) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "—")
const TX = "https://sepolia.etherscan.io/tx/"

export default function DelegationView() {
  const [status, setStatus] = useState<Status | null>(null)
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [sig, setSig] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [deployTx, setDeployTx] = useState<string | null>(null)
  const [redeem, setRedeem] = useState<Redeem | null>(null)
  const [proof, setProof] = useState<Redeem | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/metamask/delegation", { cache: "no-store" })
      setStatus(await r.json())
    } catch {
      setStatus({ configured: false, error: "Couldn't reach the delegation service." })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/metamask/delegation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return r.json()
  }

  const doSetup = async () => {
    setBusy("setup")
    try { const r = await post({ action: "setup" }); if (r.deployTx) setDeployTx(r.deployTx); await refresh() } finally { setBusy(null) }
  }
  const doSign = async () => {
    setBusy("sign")
    try {
      const r = await fetch("/api/metamask/delegation?sign=1&cap=1", { cache: "no-store" }).then((x) => x.json())
      if (r.delegation) { setBounds(r.delegation.bounds); setSig(r.delegation.signed?.signature || null) }
    } finally { setBusy(null) }
  }
  const doRedeem = async () => {
    setBusy("redeem")
    try {
      const r: Redeem = await post({ action: "redeem", amount: "0.0005" })
      setRedeem(r)
      if (r.openUrl) openTxWindow(r.openUrl)
      await refresh()
    } finally { setBusy(null) }
  }
  const doProve = async () => {
    setBusy("prove")
    try { setProof(await post({ action: "prove-cap" })) } finally { setBusy(null) }
  }

  const deployed = !!status?.deployed
  const configured = !!status?.configured

  return (
    <div className="kh-view">
      <div className="kh-sec-head">
        <span className="kh-sec-title">MetaMask delegation · live on Sepolia</span>
        <span className="kh-sec-hint">real smart account · signed once · enforced on-chain</span>
      </div>

      <div className="kh-deleg">
        {/* left: the account + actions */}
        <div className="kh-panel">
          <div className="kh-ledger">
            <span className="kh-ledger-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M9 6v12M13 10h4M13 14h4" />
              </svg>
            </span>
            <div className="kh-ledger-meta">
              <b>MetaMask Smart Account</b>
              <span>
                {status?.smartAccount ? (
                  <a className="kh-mono" href={status.smartAccountUrl} target="_blank" rel="noopener noreferrer">{short(status.smartAccount)}</a>
                ) : "loading…"}
              </span>
            </div>
            <span className={`kh-status ${deployed ? "ok" : "paused"}`}><i />{deployed ? "Deployed" : "Not deployed"}</span>
          </div>

          <div className="kh-kv"><span>owner (Ledger stand-in)</span><b className="kh-mono">{short(status?.owner)}</b></div>
          <div className="kh-kv"><span>agent / delegate</span><b className="kh-mono">{short(status?.agent)}</b></div>
          <div className="kh-kv"><span>delegation manager</span><b className="kh-mono">{short(status?.delegationManager)}</b></div>
          <div className="kh-kv"><span>smart-account balance</span><b>{status?.balances?.smartAccountEth ?? "—"} ETH</b></div>
          <div className="kh-kv"><span>agent gas balance</span><b>{status?.balances?.agentEth ?? "—"} ETH</b></div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {!deployed && (
              <button className="kh-btn" onClick={doSetup} disabled={!configured || !!busy}>
                {busy === "setup" ? "Funding + deploying…" : "Deploy & fund via KeeperHub"}
              </button>
            )}
            <button className={`kh-btn ${deployed ? "" : "kh-btn-ghost"}`} onClick={doSign} disabled={!configured || !!busy}>
              {busy === "sign" ? "Signing…" : "Sign scoped delegation"}
            </button>
          </div>

          {deployTx && (
            <p className="kh-deleg-note">Account deployed · <a href={TX + deployTx} target="_blank" rel="noopener noreferrer" className="kh-mono">{short(deployTx)}</a></p>
          )}
          {sig && (
            <div className="kh-deleg-signed">
              <div className="kh-kv"><span>signature</span><b className="kh-mono">{short(sig)}</b></div>
              {bounds && <div className="kh-kv"><span>cap · expiry</span><b>{bounds.spendCapEth} ETH · {new Date(bounds.expiresAt).toLocaleDateString()}</b></div>}
              <p className="kh-deleg-note">Owner-signed EIP-712 delegation to the agent. Swap the owner key for a Ledger DMK device-signer and this exact flow signs on hardware.</p>
            </div>
          )}
        </div>

        {/* right: the agent acting within bounds + enforcement proof */}
        <div className="kh-panel">
          <div className="kh-deleg-summary">
            The agent holds a <b>scoped delegation</b>, never the keys. It redeems the delegation on-chain to
            act — and the on-chain <b>Delegation Manager</b> enforces every caveat.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="kh-btn" onClick={doRedeem} disabled={!deployed || !!busy}>
              {busy === "redeem" ? "Redeeming…" : "Agent acts · send 0.0005 ETH"}
            </button>
            <button className="kh-btn kh-btn-ghost" onClick={doProve} disabled={!deployed || !!busy}>
              {busy === "prove" ? "Testing…" : "Prove the cap (must revert)"}
            </button>
          </div>

          {redeem && (
            <div className="kh-deleg-signed">
              {redeem.ok && redeem.tx ? (
                <>
                  <div className="kh-kv"><span>redemption tx</span><a className="kh-mono" href={redeem.tx.explorer} target="_blank" rel="noopener noreferrer">{short(redeem.tx.hash)}</a></div>
                  <p className="kh-deleg-note">{redeem.summary}</p>
                </>
              ) : (
                <p className="kh-deleg-note" style={{ color: "var(--kh-danger)" }}>{redeem.summary}</p>
              )}
            </div>
          )}

          {proof && (
            <div className="kh-deleg-signed">
              <div className="kh-kv"><span>over-cap redemption</span><b className={proof.reverted ? "" : ""} style={{ color: proof.reverted ? "var(--kh-primary)" : "var(--kh-danger)" }}>{proof.reverted ? "reverted ✓" : "did not revert ✗"}</b></div>
              <p className="kh-deleg-note kh-mono" style={{ fontSize: 11 }}>{(proof.detail || proof.summary).slice(0, 160)}</p>
            </div>
          )}
        </div>
      </div>

      <MandateWizard />
    </div>
  )
}
