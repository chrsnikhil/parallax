import { NextResponse } from "next/server"

import {
  KeeperHubClient,
  SEPOLIA,
  KH_WALLET,
  KH_INTEGRATION_ID,
  txHashOf,
  executionIdOf,
} from "@/lib/keeperhub"
import { readBalances, readAllBalances, readPrice, doSwap, doBridge, dripCcipBnm, wrapEth } from "@/lib/defi"
import { mmRedeem, mmStatus } from "@/lib/metamask"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * Direct KeeperHub tool executor for the Gemini LIVE voice agent. The Live model
 * function-calls a specific tool by name; we run it straight against the MCP
 * client — NO nested LLM — so tool calls return in ~1-2s and the agent speaks
 * the result immediately. On-chain writes simulate then execute (cap is the
 * backstop). Defaults (chain, integration) are injected so the model needn't.
 */

const EXEC = new Set(["execute_transfer", "execute_protocol_action"])
const explorer = (h: string) => `https://sepolia.etherscan.io/tx/${h}`
const wfLink = (id: string) => `https://app.keeperhub.com/workflows/${id}`
const idOf = (d: unknown): string | undefined => {
  if (!d || typeof d !== "object") return undefined
  const o = d as Record<string, unknown>
  const v = o.id || o.workflowId || o.workflow_id || o.executionId || o.execution_id
  return typeof v === "string" ? v : undefined
}

// The Live model speaks whatever we return, so convert raw wei/lamports and
// verbose payloads into human units + a ready-to-say summary. Otherwise it
// mis-reads "20000000000000000" as "20 ETH".
function friendly(name: string, data: unknown): unknown {
  if (!data || typeof data !== "object") return data
  const d = data as Record<string, any>
  if (name === "get_spending_limits") {
    const capWei = Number(d.effectiveDailyCapWei ?? d.dailyCapWei ?? 0)
    const usedWei = Number(d.dailyUsedWei ?? 0)
    const cap = capWei / 1e18
    const used = usedWei / 1e18
    return {
      dailyCapEth: +cap.toFixed(4),
      dailyUsedEth: +used.toFixed(4),
      dailyRemainingEth: +(cap - used).toFixed(4),
      summary: `${(cap - used).toFixed(4)} ETH remaining of a ${cap.toFixed(2)} ETH daily cap`,
    }
  }
  if (name === "list_executions") {
    const runs: any[] = Array.isArray(d.runs) ? d.runs : Array.isArray(data) ? (data as any[]) : []
    return {
      count: runs.length,
      recent: runs.slice(0, 5).map((r) => ({ kind: r.source ?? r.type, status: r.status, when: r.startedAt })),
      summary: `${runs.length} recent execution${runs.length === 1 ? "" : "s"}`,
    }
  }
  if (name === "search_protocol_actions") {
    const actions: any[] = Array.isArray(d.actions) ? d.actions : []
    return {
      count: d.count ?? actions.length,
      top: actions.slice(0, 5).map((a) => ({ action: a.actionType, label: a.label })),
      summary: `found ${d.count ?? actions.length} matching protocol action${(d.count ?? actions.length) === 1 ? "" : "s"}`,
    }
  }
  if (name === "get_wallet_integration") {
    return { walletAddress: d.walletAddress, type: d.type, summary: `wallet ${String(d.walletAddress || "").slice(0, 8)}… on Sepolia` }
  }
  return data
}

export async function POST(req: Request) {
  const { name, args } = await req.json().catch(() => ({ name: "" }))
  if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 })
  try {
    // ---- composite DeFi tools (portfolio, prices, swap, bridge) via lib/defi ----
    const a0: Record<string, unknown> = { ...(args || {}) }
    if (name === "get_balances") {
      // single chain if asked, otherwise the multichain portfolio
      if (a0.chain || a0.network) {
        const b = await readBalances(undefined, String(a0.chain || a0.network))
        const top = b.holdings.map((h) => `${h.amount} ${h.symbol}`).join(", ")
        return NextResponse.json({ ok: true, ...b, summary: `${b.network}: $${b.totalUsd.toLocaleString()} — ${top}.` })
      }
      const b = await readAllBalances()
      const withValue = b.chains.filter((c) => c.totalUsd > 0).map((c) => `${c.short} $${c.totalUsd.toLocaleString()}`)
      return NextResponse.json({ ok: true, ...b, summary: `Portfolio ≈ $${b.totalUsd.toLocaleString()} across ${b.chains.length} chains${withValue.length ? ` (${withValue.join(", ")})` : ""}.` })
    }
    if (name === "get_price") {
      const r = await readPrice(String(a0.symbol || a0.token || "ETH"))
      return NextResponse.json({ ok: r.price != null, ...r, summary: r.price != null ? `${r.pair} is $${r.price.toLocaleString()} (Chainlink).` : `No live feed for ${r.pair}.` })
    }
    if (name === "swap_tokens") {
      const r = await doSwap({
        fromToken: String(a0.fromToken || a0.from || ""),
        toToken: String(a0.toToken || a0.to || ""),
        amount: String(a0.amount || "0"),
        network: a0.network || a0.chain ? String(a0.network || a0.chain) : undefined,
        fee: a0.fee ? String(a0.fee) : undefined,
        slippagePct: a0.slippagePct != null ? Number(a0.slippagePct) : undefined,
        execute: a0.execute !== false, // swaps default to broadcasting (capped)
      })
      return NextResponse.json(r)
    }
    if (name === "bridge_tokens") {
      // One-shot bridge. The whole demo runs on testnet, so map mainnet
      // destination names to their CCIP-BnM testnet lanes, and always transport
      // via CCIP-BnM — the requested token (even native ETH) is abstracted away,
      // so the owner never has to wrap or swap first. Broadcasts by default.
      const TESTNET_DEST: Record<string, string> = {
        base: "base sepolia", "base sepolia": "base sepolia",
        arbitrum: "arb sepolia", "arbitrum one": "arb sepolia", arb: "arb sepolia", "arb sepolia": "arb sepolia",
        optimism: "op sepolia", op: "op sepolia", "op sepolia": "op sepolia",
        ethereum: "sepolia", sepolia: "sepolia",
      }
      const rawTo = String(a0.toChain || a0.to || "").toLowerCase().trim()
      const r = await doBridge({
        token: a0.token ? String(a0.token) : undefined,
        amount: String(a0.amount || "0.01"),
        fromChain: a0.fromChain || a0.network ? String(a0.fromChain || a0.network) : undefined,
        toChain: TESTNET_DEST[rawTo] || String(a0.toChain || a0.to || ""),
        receiver: a0.receiver ? String(a0.receiver) : undefined,
        execute: a0.execute !== false, // one-shot: bridge for real unless a preview is explicitly asked
      })
      return NextResponse.json(r)
    }
    if (name === "drip_ccip_bnm") {
      const r = await dripCcipBnm(a0.network || a0.chain ? String(a0.network || a0.chain) : undefined)
      return NextResponse.json(r)
    }
    if (name === "wrap_eth") {
      const r = await wrapEth({
        amountEth: String(a0.amount || a0.amountEth || "0.001"),
        network: a0.network || a0.chain ? String(a0.network || a0.chain) : undefined,
        execute: a0.execute !== false, // wrapping is a straightforward protocol op; default to doing it
      })
      return NextResponse.json(r)
    }
    if (name === "agent_pay") {
      // the agent acts through its MetaMask delegation: redeem on-chain to send
      // ETH within the owner-signed caveats (cap + allowlist + expiry).
      const r = await mmRedeem({
        to: a0.to ? (String(a0.to) as `0x${string}`) : undefined,
        amountEth: String(a0.amount || "0.0005"),
      })
      return NextResponse.json(r)
    }
    if (name === "delegation_status") {
      const s = await mmStatus()
      return NextResponse.json({ ok: s.configured, ...s, summary: s.configured ? `MetaMask smart account ${String(s.smartAccount).slice(0, 8)}… on Sepolia, ${s.deployed ? "deployed" : "not deployed"}, holding ${s.balances?.smartAccountEth} ETH.` : "MetaMask delegation not configured." })
    }

    const kh = new KeeperHubClient()
    await kh.init()
    const a: Record<string, unknown> = { ...(args || {}) }
    if (EXEC.has(name) && !a.chain_id) a.chain_id = SEPOLIA
    if (name === "get_wallet_integration" && !a.integrationId) a.integrationId = KH_INTEGRATION_ID
    if (name === "execute_transfer" && !a.to_address) a.to_address = KH_WALLET // safe default target

    // build a workflow from natural language: ai_generate_workflow -> create_workflow
    if (name === "build_workflow") {
      const desc = String(a.description || a.prompt || "")
      if (!desc) return NextResponse.json({ ok: false, detail: "description required" })
      const nm = String(a.name || `LUMEN: ${desc.slice(0, 44)}`)

      // best path: let KeeperHub's generator turn NL → a full workflow graph.
      // one shot only (retryColdStart:false) — if it's warming up we fall back to
      // a real code-built workflow below rather than make the agent hang ~24s.
      const gen = await kh.callTool("ai_generate_workflow", { prompt: desc }, { retryColdStart: false })
      const g = (gen.data ?? {}) as Record<string, any>
      let id = idOf(g)
      if (!gen.isError && !id) {
        const wf = g.workflow || g
        if (Array.isArray(wf?.nodes)) {
          const created = await kh.callTool("create_workflow", { name: String(wf.name || nm), description: desc, nodes: wf.nodes, edges: wf.edges ?? [], enabled: !!a.enable })
          id = idOf(created.data)
        }
      }
      if (id) return NextResponse.json({ ok: true, id, link: wfLink(id), summary: `Built workflow ${id}${a.enable ? " (armed)" : ""}.` })

      // fallback (generator cold/unavailable): create a real monitor workflow so
      // voice still produces a genuine workflow on KeeperHub.
      const nodes = [
        { id: "trigger-1", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", label: "Manual Trigger", config: { triggerType: "Manual" }, status: "idle" } },
        { id: "action-1", type: "action", position: { x: 320, y: 0 }, data: { type: "action", label: "Check Balance", config: { address: KH_WALLET, network: SEPOLIA, actionType: "web3/check-balance", integrationId: KH_INTEGRATION_ID }, status: "idle" } },
      ]
      const edges = [{ id: "edge-1", source: "trigger-1", target: "action-1" }]
      const created = await kh.callTool("create_workflow", { name: nm, description: desc, nodes, edges, enabled: !!a.enable })
      id = idOf(created.data)
      if (created.isError || !id) return NextResponse.json({ ok: false, detail: created.text || gen.text || "could not build workflow" })
      return NextResponse.json({ ok: true, id, link: wfLink(id), summary: `Built a monitor workflow (${id}); the full generator was warming up.` })
    }

    // run a workflow by id
    if (name === "execute_workflow") {
      const wid = String(a.workflowId || a.id || "")
      if (!wid) return NextResponse.json({ ok: false, detail: "workflowId required" })
      const exec = await kh.callTool("execute_workflow", { workflowId: wid })
      if (exec.isError) return NextResponse.json({ ok: false, detail: exec.text })
      const execId = idOf(exec.data)
      let status: unknown = exec.data
      if (execId) {
        for (let i = 0; i < 12; i++) {
          const s = await kh.callTool("get_execution", { executionId: execId })
          status = s.data
          const st = (s.data as Record<string, unknown> | undefined)?.status as string | undefined
          if (st && ["success", "completed", "failed", "error"].includes(st)) break
          await new Promise((r) => setTimeout(r, 1500))
        }
      }
      return NextResponse.json({ ok: true, executionId: execId, tx: txHashOf(status) || null, result: status, summary: "Ran the workflow." })
    }

    if (EXEC.has(name)) {
      const sim = await kh.callTool(name, { ...a, simulate: true })
      if (sim.isError) return NextResponse.json({ ok: false, detail: sim.text })
      const exec = await kh.callTool(name, { ...a, simulate: false })
      let hash = txHashOf(exec.data)
      let status: unknown = exec.data
      if (!hash) {
        const id = executionIdOf(exec.data)
        if (id) { const p = await kh.pollDirect(id); hash = txHashOf(p.data); status = p.data }
      }
      return NextResponse.json({ ok: !exec.isError, tx: hash ? { hash, explorer: explorer(hash) } : null, result: status, detail: exec.isError ? exec.text : undefined })
    }

    const r = await kh.callTool(name, a)
    return NextResponse.json({ ok: !r.isError, result: friendly(name, r.data ?? r.text), detail: r.isError ? r.text : undefined })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
