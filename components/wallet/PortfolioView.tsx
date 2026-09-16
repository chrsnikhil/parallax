"use client"

/*
 * Portfolio — REAL multichain holdings from /api/defi (readAllBalances): native +
 * priced ERC20 balances on each chain, valued with live Chainlink prices. The
 * total sums every chain; balances are grouped per chain. No sample data.
 */

import { useEffect, useState } from "react"

import { fmtUsd } from "@/components/wallet/data"

type Holding = { symbol: string; amount: number; usd: number | null; price: number | null; kind: "native" | "erc20"; chain: string }
type ChainBal = { chainId: string; network: string; short: string; totalUsd: number; holdings: Holding[] }
type All = { ok: boolean; wallet: string; chains: ChainBal[]; holdings: Holding[]; totalUsd: number }

const COLORS = ["#86efac", "#38bdf8", "#f0abfc", "#fbbf24", "#fb7185", "#a3a3a3", "#5eead4"]

export default function PortfolioView() {
  const [data, setData] = useState<All | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch("/api/defi", { cache: "no-store" })
        const j = await r.json()
        if (!alive) return
        if (j.ok) setData(j)
        else setErr(j.error || "Couldn't load balances")
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { alive = false }
  }, [])

  const total = data?.totalUsd ?? 0
  const chains = data?.chains ?? []
  const valuedChains = chains.filter((c) => c.totalUsd > 0)

  return (
    <div className="kh-view">
      <div className="kh-panel">
        <div className="kh-total">
          <div>
            <div className="kh-total-k">Total value</div>
            <div className="kh-total-v">
              {data ? <>${fmtUsd(total)} <em>live</em></> : err ? <em>{err}</em> : <em>reading chains…</em>}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="kh-sec-hint">Chainlink priced</div>
            <div className="kh-sec-hint" style={{ marginTop: 4 }}>
              {chains.length} chain{chains.length === 1 ? "" : "s"} scanned
            </div>
          </div>
        </div>

        {/* allocation by chain (real USD) */}
        {valuedChains.length > 0 && (
          <>
            <div className="kh-alloc" role="img" aria-label="Allocation by chain">
              {valuedChains.map((c, i) => (
                <i key={c.chainId} style={{ width: `${(c.totalUsd / total) * 100}%`, background: COLORS[i % COLORS.length] }} />
              ))}
            </div>
            <div className="kh-legend">
              {valuedChains.map((c, i) => (
                <span key={c.chainId}>
                  <i style={{ background: COLORS[i % COLORS.length] }} />
                  {c.short} · <span className="kh-num">{((c.totalUsd / total) * 100).toFixed(1)}%</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* per-chain balances */}
      {chains.map((c) => (
        <div className="kh-panel" style={{ marginTop: "clamp(16px,2.4vw,22px)" }} key={c.chainId}>
          <div className="kh-sec-head">
            <span className="kh-sec-title">{c.short}</span>
            <span className="kh-sec-hint">${fmtUsd(c.totalUsd)}</span>
          </div>
          <div className="kh-rows">
            {c.holdings.map((h) => (
              <div className="kh-token" key={`${c.chainId}-${h.symbol}`}>
                <span className="kh-coin">{h.symbol.slice(0, 3)}</span>
                <span className="kh-tk-name">
                  <b>{h.symbol}</b>
                  <span className="kh-tk-chain">
                    <i className="kh-chain-dot" style={{ background: h.kind === "native" ? "#86efac" : "#38bdf8" }} />
                    {h.price != null ? `$${fmtUsd(h.price)} / ${h.symbol}` : "unpriced"}
                  </span>
                </span>
                <span className="kh-tk-amt">
                  {h.amount}
                  <span>{h.symbol}</span>
                </span>
                <span className="kh-tk-val">{h.usd != null ? `$${fmtUsd(h.usd)}` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {!data && !err && <div className="kh-sec-hint" style={{ padding: "12px 2px" }}>Reading balances across chains…</div>}
    </div>
  )
}
