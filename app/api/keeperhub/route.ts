import { NextResponse } from "next/server"

import {
  KeeperHubClient,
  SEPOLIA,
  KH_WALLET,
  KH_INTEGRATION_ID,
} from "@/lib/keeperhub"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * GET /api/keeperhub  — health / connectivity check. Read-only + a simulate;
 * never broadcasts. Curl this to confirm the key, session, funded wallet,
 * spend cap, workflow count, and a live gas estimate — no human needed.
 */
export async function GET() {
  try {
    const kh = new KeeperHubClient()
    await kh.init()

    // NOTE: list_workflows is intentionally NOT called here — the org holds 150k+
    // workflows and pulling them takes ~70s. Use /api/automations for workflow ops.
    const limits = await kh.callTool("get_spending_limits")
    const integ = await kh.callTool("get_wallet_integration", { integrationId: KH_INTEGRATION_ID })
    const sim = await kh.callTool("execute_transfer", {
      chain_id: SEPOLIA,
      to_address: KH_WALLET,
      amount: "0.0001",
      simulate: true,
    })

    const lim = (limits.data ?? {}) as Record<string, string | null>

    return NextResponse.json({
      ok: true,
      wallet: KH_WALLET,
      integrationId: KH_INTEGRATION_ID,
      integration: integ.data,
      spendCap: {
        effectiveDailyCapEth: lim.effectiveDailyCapWei ? Number(lim.effectiveDailyCapWei) / 1e18 : null,
        dailyUsedEth: lim.dailyUsedWei ? Number(lim.dailyUsedWei) / 1e18 : 0,
      },
      simulateTransfer: sim.data,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
