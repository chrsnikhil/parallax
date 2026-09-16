import { NextResponse } from "next/server"

import { KeeperHubClient, txHashOf, executionIdOf } from "@/lib/keeperhub"
import { routeToKeeperHub, summarizeResult } from "@/lib/gemini"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * The universal KeeperHub command surface. A natural-language command is routed
 * by Gemini (function-calling over the LIVE 44-tool catalog) to the single best
 * KeeperHub tool + args, then dispatched:
 *   - reads               → run and return the result
 *   - on-chain executors  → simulate first; broadcast only with execute:true
 *   - state/destructive   → preview; run only with execute:true
 *
 * POST { command, execute? }        GET ?command=...  (read/simulate only)
 * This is what makes LUMEN reach "literally anything on KeeperHub" by voice.
 */

const ON_CHAIN = new Set(["execute_transfer", "execute_contract_call", "execute_protocol_action", "execute_check_and_execute"])
const GATED = new Set([
  "execute_workflow", "call_workflow", "create_workflow", "update_workflow", "delete_workflow",
  "deploy_template", "list_workflow", "unlist_workflow", "update_workflow_listing", "create_project",
  "create_tag", "tempo_sign_and_hold", "tempo_release_hold", "tempo_cancel_hold",
])

const explorer = (h: string) => `https://sepolia.etherscan.io/tx/${h}`

async function act(kh: KeeperHubClient, command: string, execute: boolean) {
  const tools = await kh.listTools()
  const routed = await routeToKeeperHub(command, tools)
  if (!routed.ok) return { ok: false, error: routed.error }
  if (!routed.name) return { ok: true, mode: "answer", answer: routed.text }

  const name = routed.name
  const args = routed.args || {}

  // on-chain executors: simulate first, broadcast only when asked
  if (ON_CHAIN.has(name)) {
    const sim = await kh.callTool(name, { ...args, simulate: true })
    if (sim.isError) return { ok: false, mode: "simulate", tool: name, args, detail: sim.text }
    if (!execute) return { ok: true, mode: "simulate", tool: name, args, simulate: sim.data ?? sim.text }

    const exec = await kh.callTool(name, { ...args, simulate: false })
    if (exec.isError) return { ok: false, mode: "execute", tool: name, args, detail: exec.text }
    let hash = txHashOf(exec.data)
    let statusData: unknown = exec.data
    if (!hash) {
      const id = executionIdOf(exec.data)
      if (id) { const p = await kh.pollDirect(id); hash = txHashOf(p.data); statusData = p.data }
    }
    return {
      ok: !exec.isError,
      mode: "execute",
      tool: name,
      args,
      tx: hash ? { hash, explorer: explorer(hash), chain: "Sepolia" } : null,
      result: statusData,
    }
  }

  // state-changing / destructive: preview unless execute
  if (GATED.has(name)) {
    if (!execute) return { ok: true, mode: "preview", tool: name, args, note: `Would call ${name}. Re-send with execute:true to run it.` }
    const r = await kh.callTool(name, args)
    return { ok: !r.isError, mode: "execute", tool: name, args, result: r.data ?? r.text, detail: r.isError ? r.text : undefined }
  }

  // reads: run directly
  const r = await kh.callTool(name, args)
  return { ok: !r.isError, mode: "read", tool: name, args, result: r.data ?? r.text, detail: r.isError ? r.text : undefined }
}

// deterministic fallback so a read NEVER replies a bare "Done."
function fallbackSay(out: any): string {
  const r = out.result ?? out.simulate
  if (out.mode === "simulate" && r?.gasEstimate) {
    return `Simulated: it would run (~${r.gasEstimate} gas)${r.wouldRevert ? ", but it would revert" : ", no revert"}. Nothing was broadcast.`
  }
  if (out.tool === "get_spending_limits" && r) {
    const cap = Number(r.effectiveDailyCapWei || 0) / 1e18
    const used = Number(r.dailyUsedWei || 0) / 1e18
    return `You've used ${used} of your ${cap} ETH daily cap — ${(cap - used).toFixed(4)} ETH remaining today.`
  }
  if (Array.isArray(r)) return `Returned ${r.length} result${r.length === 1 ? "" : "s"}.`
  if (r && typeof r === "object") {
    if (typeof r.count === "number") return `Found ${r.count} result${r.count === 1 ? "" : "s"}.`
    if (Array.isArray(r.runs)) return `Found ${r.runs.length} recent execution${r.runs.length === 1 ? "" : "s"}.`
    if (typeof r.balance === "string") return `Balance is ${r.balance} ETH.`
    return `Done — ${Object.keys(r).slice(0, 4).join(", ")}.`
  }
  return "Done."
}

// attach a one-line spoken summary (`say`) — Gemini best-effort, deterministic fallback
async function withSay(out: any, command: string) {
  if (!out || !out.ok) return out
  if (out.mode === "answer") { out.say = out.answer; return out }
  if (out.mode === "execute") { out.say = out.tx ? "Done. Your transaction is on-chain and verifiable." : "Done."; return out }
  const payload = out.result ?? out.simulate ?? out.note
  const gemSay = await Promise.race([
    summarizeResult(command, out.tool, out.mode, payload),
    new Promise<null>((r) => setTimeout(() => r(null), 6000)),
  ])
  out.say = gemSay || fallbackSay(out)
  return out
}

export async function POST(req: Request) {
  const { command, execute } = await req.json().catch(() => ({ command: "" }))
  if (!command) return NextResponse.json({ ok: false, error: "command required" }, { status: 400 })
  try {
    const kh = new KeeperHubClient()
    await kh.init()
    return NextResponse.json(await withSay(await act(kh, command, !!execute), command))
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}

export async function GET(req: Request) {
  const command = new URL(req.url).searchParams.get("command")
  if (!command) return NextResponse.json({ ok: true, hint: "POST {command, execute?} or GET ?command=... (read/simulate only)" })
  try {
    const kh = new KeeperHubClient()
    await kh.init()
    return NextResponse.json(await withSay(await act(kh, command, false), command))
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
