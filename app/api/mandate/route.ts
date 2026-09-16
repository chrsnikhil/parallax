import { NextResponse } from "next/server"

import { mmMandateCatalog, mmGetMandate, mmSetMandate, mmMandateProve, mmMandateContext, mmSetMandateLedger } from "@/lib/metamask"
import type { SignedDelegation } from "@/lib/metamask"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
 * Custom mandate = a Ledger-signed, on-chain-enforced allowlist (a MetaMask
 * functionCall-scoped delegation): the agent may only call the chosen protocol
 * contracts with the chosen methods, until expiry.
 *   GET                        → catalog (protocol/action choices) + active mandate
 *   POST {action:"set", protocols, actions, days}  → build + owner-sign the mandate
 *   POST {action:"prove"}      → on-chain proof (allowed succeeds, off-mandate reverts)
 */

const jsonify = (obj: unknown) =>
  new NextResponse(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    headers: { "content-type": "application/json" },
  })

export async function GET() {
  try {
    return jsonify({ ok: true, catalog: mmMandateCatalog(), context: mmMandateContext(), mandate: mmGetMandate() })
  } catch (e) {
    return jsonify({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action || "")
  try {
    if (action === "set") {
      const protocols = Array.isArray(body.protocols) ? body.protocols.map(String) : []
      const actions = Array.isArray(body.actions) ? body.actions.map(String) : []
      const days = body.days != null ? Number(body.days) : undefined
      return jsonify(await mmSetMandate({ protocols, actions, days }))
    }
    if (action === "prove") {
      return jsonify(await mmMandateProve())
    }
    if (action === "set-ledger") {
      return jsonify(await mmSetMandateLedger({
        owner: String(body.owner) as `0x${string}`,
        signedDelegation: body.signedDelegation as SignedDelegation,
        protocols: Array.isArray(body.protocols) ? body.protocols.map(String) : [],
        actions: Array.isArray(body.actions) ? body.actions.map(String) : [],
        days: body.days != null ? Number(body.days) : undefined,
      }))
    }
    return jsonify({ ok: false, error: "unknown action (set|prove|set-ledger)" })
  } catch (e) {
    return jsonify({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
