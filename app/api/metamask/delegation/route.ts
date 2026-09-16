import { NextResponse } from "next/server"

import { mmStatus, mmSetup, mmSignDelegation, mmRedeem } from "@/lib/metamask"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * REAL MetaMask Delegation Toolkit integration on Sepolia.
 *
 *   GET                          → status (deployed smart account, balances, agent)
 *   GET ?sign=1&cap=0.005        → status + a freshly owner-signed scoped delegation
 *   POST {action:"setup"}        → fund via KeeperHub + deploy the smart account
 *   POST {action:"redeem", amount, to, cap}  → agent redeems the delegation on-chain
 *   POST {action:"prove-cap"}    → deliberately redeem OVER the cap to show it reverts
 *
 * bigint-safe JSON via NextResponse.json + a replacer where needed.
 */

const jsonify = (obj: unknown) =>
  new NextResponse(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    headers: { "content-type": "application/json" },
  })

export async function GET(req: Request) {
  const url = new URL(req.url)
  try {
    const status = await mmStatus()
    if (!status.configured) return jsonify({ ok: false, ...status })
    if (url.searchParams.get("sign")) {
      const cap = url.searchParams.get("cap") || "0.005"
      const delegation = await mmSignDelegation({ capEth: cap })
      return jsonify({ ok: true, status, delegation })
    }
    return jsonify({ ok: true, ...status })
  } catch (e) {
    return jsonify({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action || "")
  try {
    if (action === "setup") {
      return jsonify(await mmSetup())
    }
    if (action === "redeem") {
      const r = await mmRedeem({
        to: body.to ? (String(body.to) as `0x${string}`) : undefined,
        amountEth: body.amount ? String(body.amount) : undefined,
        capEth: body.cap ? String(body.cap) : undefined,
      })
      return jsonify(r)
    }
    if (action === "prove-cap") {
      // sign a delegation with a tiny cap, then try to redeem MORE — must revert
      const r = await mmRedeem({ amountEth: body.amount ? String(body.amount) : "0.01", capEth: "0.001" })
      return jsonify({ ...r, enforcementProof: r.reverted === true })
    }
    if (action === "sign") {
      return jsonify(await mmSignDelegation({ capEth: body.cap ? String(body.cap) : undefined }))
    }
    return jsonify({ ok: false, error: "unknown action (setup|redeem|prove-cap|sign)" })
  } catch (e) {
    return jsonify({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
