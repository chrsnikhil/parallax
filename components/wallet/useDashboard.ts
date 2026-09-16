"use client"

/*
 * Live dashboard data from /api/dashboard (KeeperHub spend cap + executions +
 * on-chain balance). Polls, and exposes refresh() to pull immediately after an
 * action so the tiles/activity update right away.
 */

import { useCallback, useEffect, useState } from "react"

export type DashExecution = {
  id: string
  kind: string
  status: string
  when: string
  workflow: string | null
  network: string | null
  tx: string | null
  txShort: string | null
}
export type DashData = {
  ok: boolean
  wallet?: string
  balanceEth?: number | null
  spendCap?: { capEth: number | null; usedEth: number; remainingEth: number | null }
  executions?: DashExecution[]
}

export function useDashboard(pollMs = 20000) {
  const [data, setData] = useState<DashData | null>(null)
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard", { cache: "no-store" })
      const j = await r.json()
      if (j && j.ok) setData(j)
    } catch {
      /* keep last good data */
    }
  }, [])
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, pollMs)
    return () => clearInterval(id)
  }, [refresh, pollMs])
  return { data, refresh }
}

export function agoFrom(iso?: string | null): string {
  if (!iso) return "—"
  const t = Date.parse(iso)
  if (isNaN(t)) return "—"
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return s + "s ago"
  if (s < 3600) return Math.floor(s / 60) + "m ago"
  if (s < 86400) return Math.floor(s / 3600) + "h ago"
  return Math.floor(s / 86400) + "d ago"
}
