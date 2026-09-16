import { NextResponse } from "next/server"

import {
  KeeperHubClient,
  SEPOLIA,
  KH_WALLET,
  KH_INTEGRATION_ID,
  txHashOf,
} from "@/lib/keeperhub"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * POST /api/automations  — the autonomous side of LUMEN.
 * Actions:
 *   { action: "deploy",   name, description }  -> create a REAL KeeperHub workflow, returns id + link
 *   { action: "run",      id }                 -> execute_workflow + poll get_execution
 *   { action: "generate", prompt }             -> ai_generate_workflow (natural language -> workflow)
 *
 * GET /api/automations?selftest=1 -> deploy a safe read-only workflow, run it,
 * return the execution result. Fully unattended + no spend (proves autonomy).
 *
 * The seeded template is a read-only web3/check-balance (same shape the org's
 * existing probes use), so nothing here moves funds. On-chain WRITES stay gated
 * behind the Ledger-signed delegation (Phase 3).
 */

// A minimal, valid KeeperHub graph: Manual trigger -> read-only balance check.
function checkBalanceGraph() {
  return {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: { type: "trigger", label: "Manual Trigger", config: { triggerType: "Manual" }, status: "idle" },
      },
      {
        id: "action-1",
        type: "action",
        position: { x: 320, y: 0 },
        data: {
          type: "action",
          label: "Check ETH Balance",
          config: {
            address: KH_WALLET,
            network: SEPOLIA,
            actionType: "web3/check-balance",
            integrationId: KH_INTEGRATION_ID,
          },
          status: "idle",
        },
      },
    ],
    edges: [{ id: "edge-1", source: "trigger-1", target: "action-1" }],
  }
}

function idOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined
  const d = data as Record<string, unknown>
  const v = d.id || d.workflowId || d.workflow_id || d.executionId || d.execution_id
  return typeof v === "string" ? v : undefined
}

const wfLink = (id: string) => `https://app.keeperhub.com/workflows/${id}`

async function deploy(kh: KeeperHubClient, name: string, description: string) {
  const { nodes, edges } = checkBalanceGraph()
  const validate = await kh.callTool("validate_workflow", { name, nodes, edges })
  const created = await kh.callTool("create_workflow", { name, description, nodes, edges })
  const id = idOf(created.data)
  return {
    ok: !created.isError && !!id,
    id,
    link: id ? wfLink(id) : undefined,
    validate: validate.data ?? validate.text,
    detail: created.isError ? created.text : undefined,
    raw: created.data,
  }
}

async function run(kh: KeeperHubClient, id: string) {
  const exec = await kh.callTool("execute_workflow", { workflowId: id })
  if (exec.isError) return { ok: false, detail: exec.text, raw: exec.data }
  const execId = idOf(exec.data)
  let status = exec.data
  if (execId) {
    for (let i = 0; i < 15; i++) {
      const s = await kh.callTool("get_execution", { executionId: execId })
      status = s.data
      const st = (s.data as Record<string, unknown> | undefined)?.status as string | undefined
      if (st && ["completed", "failed", "success", "error"].includes(st)) break
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  return { ok: true, executionId: execId, status, tx: txHashOf(status) }
}

export async function POST(req: Request) {
  let body: { action?: string; name?: string; description?: string; id?: string; prompt?: string } = {}
  try {
    body = await req.json()
  } catch {}
  try {
    const kh = new KeeperHubClient()
    await kh.init()

    if (body.action === "deploy") {
      const name = body.name || "LUMEN: automation"
      return NextResponse.json(await deploy(kh, name, body.description || ""))
    }
    if (body.action === "run") {
      if (!body.id) return NextResponse.json({ ok: false, detail: "id required" }, { status: 400 })
      return NextResponse.json(await run(kh, body.id))
    }
    if (body.action === "generate") {
      if (!body.prompt) return NextResponse.json({ ok: false, detail: "prompt required" }, { status: 400 })
      const gen = await kh.callTool("ai_generate_workflow", { prompt: body.prompt })
      return NextResponse.json({ ok: !gen.isError, workflow: gen.data ?? gen.text })
    }
    return NextResponse.json({ ok: false, detail: "unknown action" }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, detail: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get("selftest") !== "1") {
    return NextResponse.json({ ok: true, hint: "POST {action:deploy|run|generate} or GET ?selftest=1" })
  }
  try {
    const kh = new KeeperHubClient()
    await kh.init()
    const d = await deploy(kh, "LUMEN: yield watch (self-test)", "Read-only autonomy probe created by the LUMEN self-test")
    if (!d.ok || !d.id) return NextResponse.json({ step: "deploy", ...d })
    const r = await run(kh, d.id)
    return NextResponse.json({ ok: r.ok, deploy: { id: d.id, link: d.link }, run: r })
  } catch (e) {
    return NextResponse.json({ ok: false, detail: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
