"use client"

import { agoFrom, type DashData } from "@/components/wallet/useDashboard"

export default function ActivityView({ data }: { data?: DashData | null }) {
  const execs = data?.executions ?? []
  return (
    <div className="kh-view">
      <div className="kh-panel">
        <div className="kh-sec-head">
          <span className="kh-sec-title">Audit trail</span>
          <span className="kh-sec-hint">real KeeperHub executions · verifiable on-chain</span>
        </div>

        <div className="kh-activity">
          {execs.map((row) => (
            <div className="kh-act-row" key={row.id}>
              <span
                className="kh-act-act"
                style={row.status !== "success" ? { color: "var(--kh-danger)" } : undefined}
              >
                {String(row.kind).toUpperCase()}
              </span>
              <span className="kh-act-desc">{row.workflow || (row.tx ? "direct execution" : "read")}</span>
              <span className="kh-act-amt">
                <b>{row.status}</b> · {row.network === "11155111" ? "Sepolia" : row.network || "—"}
              </span>
              {row.tx ? (
                <a className="kh-tx kh-mono" href={`https://sepolia.etherscan.io/tx/${row.tx}`} target="_blank" rel="noreferrer">
                  {row.txShort}
                </a>
              ) : (
                <span className="kh-act-when kh-mono">—</span>
              )}
              <span className="kh-act-when">{agoFrom(row.when)}</span>
            </div>
          ))}
          {!execs.length && <div className="kh-act-row"><span className="kh-act-desc">Loading executions…</span></div>}
        </div>
      </div>
    </div>
  )
}
