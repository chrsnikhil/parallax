"use client"

/*
 * Top of the bento: the live state of the wallet — network, root of trust, a
 * status light (Live / Working), and the REAL on-chain balance from /api/dashboard.
 */

import { memo } from "react"
import { ShieldCheck } from "lucide-react"

import type { DashData } from "@/components/wallet/useDashboard"

// Memoized: `busy` is a primitive and `data` keeps a stable reference between
// dashboard polls, so this bar stays put through a burst of voice-state ticks.
function StateBar({ busy, data }: { busy: boolean; data?: DashData | null }) {
  const bal = data?.balanceEth

  return (
    <header className="kh-statebar">
      <div className="kh-statebar-l">
        <span className="kh-pill">Sepolia</span>
        <span className="kh-chip">
          <ShieldCheck className="kh-chip-ic" />
          Ledger-rooted
        </span>
      </div>

      <div className="kh-statebar-r">
        <span className={`kh-status ${busy ? "busy" : "ok"}`}>
          <i />
          {busy ? "Working" : "Live"}
        </span>
        <span className="kh-bal">
          <span className="kh-bal-n kh-mono">{bal != null ? bal.toFixed(4) : "—"}</span> <em>ETH</em>
        </span>
      </div>
    </header>
  )
}

export default memo(StateBar)
