import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// This route fans out to the other API routes; on serverless give it room and
// run the checks concurrently so the whole sweep finishes well inside the limit.
export const maxDuration = 60

/*
 * GET /api/selftest — one call that exercises the whole PARALLAX stack and returns a
 * green/red summary. Everything here is READ-ONLY (previews + status + a token
 * mint), so it never spends from the daily cap and never needs the Ledger. The
 * live-execution items (real broadcasts + the Flex tap) are the demo steps and
 * are listed under `liveSteps`, with the already-proven real tx hashes for the record.
 *
 * Curl this to confirm the whole thing is wired, with zero human interaction.
 */

// Real, mined transactions already proven on Sepolia (the 4 KeeperHub demo reqs + mandate).
const PROVEN = {
  swap: "0xde4731840319b8f7b57fce6dc4b6fbc8d3abcdb8dce35cd15a4f1578aa1408c3",
  send: "0xf269b0b8d92f3bd767d268159797d28f3b1c46dbd0ff32bc9a2a9259529dd841",
  protocol_wrap: "0x2825612fd4b2374dc73ceace8cd6c10e085dd7702899f5836f69f12dc8cdc20e",
  bridge_ccip: "0xdcd642c80585abf282777f6d6f3d665c5bd1b1af9e429a789645dad765ef9355",
  mandate_allowed: "0xeecafcc67c8ea26002962fdb65bd67311dfa4999b0282cfa64bfd5db7f7da345",
  tx: (h: string) => `https://sepolia.etherscan.io/tx/${h}`,
}

type Check = { ok: boolean; ms: number; summary?: string; error?: string }

export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const checks: Record<string, Check> = {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function check(name: string, path: string, opts?: { init?: RequestInit; ok?: (j: any) => boolean; summary?: (j: any) => string }) {
    const t0 = Date.now()
    try {
      // Hard per-check cap: a single slow route (e.g. multichain RPCs or a cold
      // serverless start) must never hang the whole sweep past the function limit.
      // Checks run in parallel, so this stays well under maxDuration (60s).
      const r = await fetch(origin + path, { cache: "no-store", signal: AbortSignal.timeout(30000), ...(opts?.init || {}) })
      const j = await r.json()
      const ok = opts?.ok ? opts.ok(j) : r.ok && j.ok !== false
      checks[name] = { ok, ms: Date.now() - t0, summary: opts?.summary ? opts.summary(j) : undefined, error: ok ? undefined : j.error || j.detail || `HTTP ${r.status}` }
    } catch (e) {
      checks[name] = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
    }
  }
  const post = (_label?: string): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" } })
  const body = (o: unknown) => JSON.stringify(o)

  // Run the checks with a small concurrency cap. Firing all 10 at once cold-starts
  // 10 serverless functions that then hammer KeeperHub simultaneously — that
  // contention was the flakiness. Batches of 3 keep it fast but reliable.
  async function runPool(jobs: Array<() => Promise<void>>, limit: number) {
    let idx = 0
    const worker = async () => {
      while (idx < jobs.length) {
        const j = jobs[idx++]
        await j()
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
  }

  await runPool([
    // 1. KeeperHub + chain: real dashboard data
    () => check("dashboard", "/api/dashboard", {
      summary: (j) => `balance ${j.balanceEth?.toFixed?.(4)} ETH · cap ${j.spendCap?.capEth} ETH/day · ${j.executions?.length ?? 0} execs`,
    }),

    // 2. Multichain portfolio (native + priced ERC20s)
    () => check("portfolio", "/api/defi", {
      summary: (j) => `$${j.totalUsd} across ${j.chains?.length ?? 0} chains · ${j.holdings?.length ?? 0} holdings`,
    }),

    // 3. Live Chainlink price
    () => check("price_oracle", "/api/tools", {
      init: { ...post("p"), body: body({ name: "get_price", args: { symbol: "ETH" } }) },
      ok: (j) => j.ok && j.price != null,
      summary: (j) => j.summary,
    }),

    // 4. Swap — read-only preview (Uniswap quote)
    () => check("swap_preview", "/api/tools", {
      init: { ...post("s"), body: body({ name: "swap_tokens", args: { fromToken: "ETH", toToken: "USDC", amount: "0.001", execute: false } }) },
      ok: (j) => j.ok && j.broadcast === false,
      summary: (j) => j.summary,
    }),

    // 5. Bridge — read-only preview (CCIP fee quote)
    () => check("bridge_preview", "/api/tools", {
      init: { ...post("b"), body: body({ name: "bridge_tokens", args: { token: "BnM", amount: "0.01", toChain: "base sepolia" } }) },
      ok: (j) => j.ok && j.broadcast === false,
      summary: (j) => j.summary,
    }),

    // 6. Protocol — read-only wrap preview (WETH)
    () => check("protocol_wrap_preview", "/api/tools", {
      init: { ...post("w"), body: body({ name: "wrap_eth", args: { amount: "0.001", execute: false } }) },
      ok: (j) => j.ok && j.broadcast === false,
      summary: (j) => j.summary,
    }),

    // 7. MetaMask smart account (delegation base)
    () => check("metamask_account", "/api/metamask/delegation", {
      ok: (j) => j.ok && j.configured,
      summary: (j) => `SA ${j.smartAccount?.slice(0, 8)}… · deployed ${j.deployed} · ${j.balances?.smartAccountEth} ETH`,
    }),

    // 8. Mandate catalog + Ledger context (Flex owner)
    () => check("mandate", "/api/mandate", {
      ok: (j) => j.ok && (j.catalog?.protocols?.length ?? 0) > 0 && !!j.context?.flexOwner,
      summary: (j) => `${j.catalog?.protocols?.length} protocols · ${j.catalog?.actions?.length} actions · Flex ${j.context?.flexOwner?.slice(0, 8)}…`,
    }),

    // 9. Gemini Live voice token (native-audio agent)
    () => check("gemini_voice_token", "/api/gemini-token", {
      init: { ...post("g"), body: body({ character: "tv" }) },
      ok: (j) => !!j.token,
      summary: (j) => `minted ${j.model} · voice ${j.voice}`,
    }),

    // 10. Autonomous yield — read-only invest preview (Aave routing + live APY)
    () => check("invest_preview", "/api/tools", {
      init: { ...post("i"), body: body({ name: "invest_yield", args: { amount: "50", execute: false } }) },
      ok: (j) => j.ok && j.broadcast === false && j.apyPct != null,
      summary: (j) => j.summary,
    }),
  ], 3)

  const allOk = Object.values(checks).every((c) => c.ok)
  return NextResponse.json(
    {
      ok: allOk,
      passed: Object.values(checks).filter((c) => c.ok).length,
      total: Object.keys(checks).length,
      checks,
      provenRealTx: {
        swap: PROVEN.tx(PROVEN.swap),
        send: PROVEN.tx(PROVEN.send),
        protocol_wrap: PROVEN.tx(PROVEN.protocol_wrap),
        bridge_ccip: PROVEN.tx(PROVEN.bridge_ccip),
        mandate_allowed: PROVEN.tx(PROVEN.mandate_allowed),
      },
      liveSteps: {
        note: "These need a human at demo time — not covered by the read-only self-test.",
        broadcasts: "Real swap/send/wrap/bridge broadcasts spend ETH → raise the KeeperHub daily cap (0.02→1 ETH) in the app.keeperhub.com dashboard first.",
        ledgerTap: "Signing a mandate on the Flex needs the physical device (Chrome/Edge + USB + Ethereum app).",
      },
    },
    { status: allOk ? 200 : 207 },
  )
}
