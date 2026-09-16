import { NextResponse } from "next/server"

import {
  KeeperHubClient,
  SEPOLIA,
  KH_WALLET,
  txHashOf,
  executionIdOf,
} from "@/lib/keeperhub"
import { parseIntent, type Intent } from "@/lib/gemini"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * POST /api/command  { text, execute?, amountEth?, to? }
 *
 * Intent-gated. Gemini classifies the command; only ACTION intents
 * (transfer/invest/rebalance/protect/sweep) ever touch the chain. A query
 * ("what's my balance") is ANSWERED — it never broadcasts. Over the per-action
 * cap rejects at BOUND before execution.
 *
 * Execute path maps to a bounded native transfer on Sepolia through the
 * KeeperHub wallet (hard-capped at PROOF_MAX server-side); the real USDC/yield
 * semantics arrive with the protocol-action + delegation-redemption wiring.
 */

const PROOF_AMOUNT = "0.0001"
const PROOF_MAX = 0.001 // hard ceiling on any real broadcast
const CAP_USDC = 50 // the per-action delegation cap the UI shows
const EXECUTE_ACTIONS = ["transfer", "invest", "rebalance", "protect", "sweep"]

const explorer = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`

function parseAmount(text: string): number | null {
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)/)
  return m ? Number(m[1].replace(/,/g, "")) : null
}

// Fallback classifier for when Gemini is slow/unavailable — err toward NOT executing.
function heuristicAction(text: string): Intent["action"] {
  const t = text.toLowerCase()
  if (/\b(balance|status|how much|what'?s|whats|show|holdings|worth|portfolio|do i have|check)\b/.test(t)) return "query"
  if (/\b(move|send|invest|swap|transfer|rebalance|sweep|evacuate|deposit|withdraw|pay|stake|put)\b/.test(t)) return "invest"
  return "unknown"
}

async function sepoliaBalanceEth(addr: string): Promise<number | null> {
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

export async function POST(req: Request) {
  let body: { text?: string; execute?: boolean; amountEth?: string; to?: string } = {}
  try {
    body = await req.json()
  } catch {}
  const text = (body.text || "").trim()
  if (!text) return NextResponse.json({ ok: false, stage: "error", detail: "text required" }, { status: 400 })

  try {
    // PARSE (Gemini, time-boxed) then classify
    const understood = (await Promise.race([
      parseIntent(text).then((r) => (r.ok ? r.intent : null)).catch(() => null),
      new Promise<null>((res) => setTimeout(() => res(null), 4500)),
    ])) as Intent | null
    const action: Intent["action"] = understood?.action || heuristicAction(text)
    const isExecute = EXECUTE_ACTIONS.includes(action)

    const kh = new KeeperHubClient()
    await kh.init()

    const limits = await kh.callTool("get_spending_limits")
    const lim = (limits.data ?? {}) as Record<string, string | null>
    const capEth = lim.effectiveDailyCapWei ? Number(lim.effectiveDailyCapWei) / 1e18 : null
    const usedEth = lim.dailyUsedWei ? Number(lim.dailyUsedWei) / 1e18 : 0

    // ---------- ANSWER (read-only, never broadcasts) ----------
    if (!isExecute) {
      const balanceEth = await sepoliaBalanceEth(KH_WALLET)
      const bal = balanceEth != null ? balanceEth.toFixed(4) : "—"
      const answer =
        action === "query"
          ? `You're holding ${bal} ETH on Sepolia. Your agent can move up to ${CAP_USDC} USDC per action inside your Ledger-signed bounds (${usedEth} of ${capEth ?? "—"} ETH used today). Nothing was moved — this was a read-only check.`
          : `I didn't catch an action I can run safely. Try "move 40 USDC into the best yield", or ask me for your balance.`
      return NextResponse.json({
        ok: true,
        mode: "answer",
        action,
        understood,
        answer,
        balanceEth,
        bound: { capEth, usedEth },
      })
    }

    // ---------- BOUND: delegation per-action cap ----------
    const amtUsd = understood?.amount ?? parseAmount(text)
    if (amtUsd != null && amtUsd > CAP_USDC) {
      return NextResponse.json({
        ok: false,
        mode: "bound",
        action,
        understood,
        detail: `${amtUsd} USDC exceeds your ${CAP_USDC} USDC per-action cap. Approve on your Ledger to go beyond it.`,
        bound: { capUsdc: CAP_USDC, requested: amtUsd },
      })
    }

    // ---------- EXECUTE ----------
    const to = (body.to || KH_WALLET).trim()
    const requested = body.amountEth ? Number(body.amountEth) : Number(PROOF_AMOUNT)
    const amountEth = Math.min(isFinite(requested) && requested > 0 ? requested : Number(PROOF_AMOUNT), PROOF_MAX)
    const amount = String(amountEth)

    const sim = await kh.callTool("execute_transfer", { chain_id: SEPOLIA, to_address: to, amount, simulate: true })
    const simData = sim.data as Record<string, unknown> | undefined
    const wouldRevert = !!(simData && simData.wouldRevert)
    const withinCap = capEth == null || usedEth + amountEth <= capEth

    const base = {
      mode: "execute" as const,
      action,
      understood,
      intent: { text, amount: amtUsd, token: understood?.token ?? "USDC" },
      compose: { chain: "Sepolia", chainId: SEPOLIA, action: "web3/transfer", to, amountEth: amount, wallet: KH_WALLET },
      simulate: simData ?? sim.text,
      bound: { capEth, usedEth, amountEth, withinBounds: withinCap },
    }

    if (sim.isError || wouldRevert) return NextResponse.json({ ok: false, stage: "dryrun", ...base, detail: sim.text || "would revert" })
    if (!withinCap) return NextResponse.json({ ok: false, stage: "bound", ...base, detail: `exceeds daily cap (${capEth} ETH)` })
    if (!body.execute) return NextResponse.json({ ok: true, stage: "dryrun", ...base })

    const exec = await kh.callTool("execute_transfer", { chain_id: SEPOLIA, to_address: to, amount, simulate: false })
    if (exec.isError) return NextResponse.json({ ok: false, stage: "execute", ...base, detail: exec.text })

    let hash = txHashOf(exec.data)
    let statusData = exec.data
    if (!hash) {
      const execId = executionIdOf(exec.data)
      if (execId) {
        const polled = await kh.pollDirect(execId)
        hash = txHashOf(polled.data)
        statusData = polled.data
      }
    }

    return NextResponse.json({
      ok: !!hash,
      stage: "done",
      ...base,
      tx: hash ? { hash, explorer: explorer(hash), chain: "Sepolia" } : null,
      result: statusData,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, stage: "error", detail: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
