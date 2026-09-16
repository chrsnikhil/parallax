import { NextResponse } from "next/server"

import { KeeperHubClient, KH_WALLET } from "@/lib/keeperhub"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * GET /api/dashboard — real data for the cockpit tiles + Activity view, pulled
 * live from KeeperHub (spending cap, executions) and the chain (native balance).
 */

async function balanceEth(addr: string): Promise<number | null> {
  try {
    const r = await fetch(process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }),
      cache: "no-store",
    })
    const j = await r.json()
    return j?.result ? Number(BigInt(j.result)) / 1e18 : null
  } catch {
    return null
  }
}

const short = (h?: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : null)

export async function GET() {
  try {
    const kh = new KeeperHubClient()
    await kh.init()

    const limits = (await kh.callTool("get_spending_limits")).data as Record<string, string | null> | undefined
    const execData = (await kh.callTool("list_executions", { limit: 8 })).data as { runs?: any[] } | undefined
    const bal = await balanceEth(KH_WALLET)

    const capWei = limits?.effectiveDailyCapWei ? Number(limits.effectiveDailyCapWei) : null
    const usedWei = limits?.dailyUsedWei ? Number(limits.dailyUsedWei) : 0
    const capEth = capWei != null ? capWei / 1e18 : null

    const runs = Array.isArray(execData?.runs) ? execData!.runs : []
    const executions = runs.map((r) => ({
      id: r.id,
      kind: r.directType || r.source || "run",
      status: r.status,
      when: r.startedAt,
      workflow: r.workflowName || null,
      network: r.network || (Array.isArray(r.networks) ? r.networks[0] : null),
      tx: r.transactionHashes?.[0]?.hash || null,
      txShort: short(r.transactionHashes?.[0]?.hash),
    }))

    return NextResponse.json({
      ok: true,
      wallet: KH_WALLET,
      balanceEth: bal,
      spendCap: {
        capEth,
        usedEth: usedWei / 1e18,
        remainingEth: capEth != null ? +(capEth - usedWei / 1e18).toFixed(4) : null,
      },
      executions,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
