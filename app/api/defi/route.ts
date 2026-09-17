import { NextResponse } from "next/server"

import { readAllBalances, readBalances, readPrice, doSwap, doBridge, dripCcipBnm } from "@/lib/defi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/*
 * Multichain DeFi endpoint for PARALLAX's UI + self-tests.
 *   GET                 → multichain portfolio (aggregated across chains)
 *   GET ?chain=8453     → balances on one chain
 *   POST {op:"price"}   → live Chainlink price (chain-independent)
 *   POST {op:"swap"}    → Uniswap V3 exact-input on {network} (simulate unless execute)
 *   POST {op:"bridge"}  → Chainlink CCIP from {fromChain} to {toChain}
 *   POST {op:"drip"}    → faucet CCIP-BnM to the wallet (to fund a real bridge)
 * The Gemini voice reaches the same logic through /api/tools.
 */

export async function GET(req: Request) {
  const chain = new URL(req.url).searchParams.get("chain")
  try {
    if (chain) {
      const data = await readBalances(undefined, chain)
      return NextResponse.json({ ok: true, ...data })
    }
    const data = await readAllBalances()
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const op = String(body.op || "")
  try {
    if (op === "price") {
      const r = await readPrice(String(body.symbol || "ETH"))
      return NextResponse.json({ ok: r.price != null, ...r })
    }
    if (op === "swap") {
      const r = await doSwap({
        fromToken: String(body.fromToken || body.from || ""),
        toToken: String(body.toToken || body.to || ""),
        amount: String(body.amount || "0"),
        network: body.network || body.chain ? String(body.network || body.chain) : undefined,
        fee: body.fee ? String(body.fee) : undefined,
        slippagePct: body.slippagePct != null ? Number(body.slippagePct) : undefined,
        execute: !!body.execute,
      })
      return NextResponse.json(r)
    }
    if (op === "bridge") {
      const r = await doBridge({
        token: String(body.token || ""),
        amount: String(body.amount || "0"),
        fromChain: body.fromChain ? String(body.fromChain) : undefined,
        toChain: String(body.toChain || body.to || ""),
        receiver: body.receiver ? String(body.receiver) : undefined,
        execute: !!body.execute,
      })
      return NextResponse.json(r)
    }
    if (op === "drip") {
      const r = await dripCcipBnm(body.network || body.chain ? String(body.network || body.chain) : undefined)
      return NextResponse.json(r)
    }
    return NextResponse.json({ ok: false, error: "unknown op (price|swap|bridge|drip, or GET for balances)" }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
