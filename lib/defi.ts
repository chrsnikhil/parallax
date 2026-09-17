/*
 * DeFi layer — SERVER ONLY. Multichain reads + writes on top of KeeperHub.
 * Pinned providers: swaps = Uniswap V3, bridges = Chainlink CCIP (most chains +
 * arbitrary tokens + a testnet faucet). KeeperHub resolves the on-chain routers
 * per `network`, so we only keep a small per-chain registry (wrapped-native for
 * native swaps, CCIP selector + LINK for bridging, explorer + RPC for reads).
 *
 *   readPrice()      live Chainlink USD price (asset price is chain-independent)
 *   readBalances()   real holdings on one chain (native + priced ERC20s)
 *   readAllBalances() the multichain portfolio, aggregated across chains
 *   doSwap()         Uniswap V3 exact-input on any supported chain
 *   doBridge()       Chainlink CCIP send from any chain to any CCIP chain
 *
 * SAFETY: on KeeperHub, execute_protocol_action with simulate:true STILL
 * broadcasts (verified). So previews use READ-ONLY quotes and the action fires
 * exactly ONCE, only on execute. NOTIONAL_CAP_USD bounds every write.
 */

import { KeeperHubClient, SEPOLIA, KH_WALLET, txHashOf, executionIdOf } from "@/lib/keeperhub"

export type TokenDef = { symbol: string; address: string; decimals: number; priceKey?: string }

type ChainCfg = {
  id: string
  name: string
  short: string
  explorer: string // base URL, tx appended as /tx/<hash>
  rpc: string
  native: string // native symbol
  nativePriceKey?: string // Chainlink price key for the native asset (if we have a feed)
  wrapped?: string // wrapped-native address (native swaps route through this)
  ccipSelector?: string // Chainlink CCIP destination chain selector
  ccipRouter?: string // Chainlink CCIP router (approve the bridged token + LINK to it)
  bnm?: string // CCIP-BnM test token address (testnet bridging token)
  link?: string // LINK token (CCIP fee token) on this chain
  tokens: TokenDef[] // ERC20s surfaced in balances
}

// Chainlink CCIP chain selectors are stable published constants; a wrong one
// fails safe (the tx reverts, no funds move). LINK/wrapped are the canonical
// token addresses per chain. Explorer + RPC mirror KeeperHub's chains registry.
export const CHAINS: Record<string, ChainCfg> = {
  // ---- testnets (demo lanes) ----
  "11155111": {
    id: "11155111", name: "Ethereum Sepolia", short: "Sepolia",
    explorer: "https://sepolia.etherscan.io", rpc: process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com",
    native: "ETH", nativePriceKey: "ETH", wrapped: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    ccipSelector: "16015286601757825753", link: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
    ccipRouter: "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59", bnm: "0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05",
    tokens: [
      { symbol: "WETH", address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18, priceKey: "ETH" },
      { symbol: "LINK", address: "0x779877A7B0D9E8603169DdbD7836e478b4624789", decimals: 18, priceKey: "LINK" },
      { symbol: "USDC", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6, priceKey: "USDC" },
    ],
  },
  "84532": {
    id: "84532", name: "Base Sepolia", short: "Base Sepolia",
    explorer: "https://sepolia.basescan.org", rpc: "https://base-sepolia-rpc.publicnode.com",
    native: "ETH", nativePriceKey: "ETH", wrapped: "0x4200000000000000000000000000000000000006",
    ccipSelector: "10344971235874465080", link: "0xE4aB69C077896252FAFBD49EFD26B5D171A32410",
    ccipRouter: "0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93", bnm: "0x88A2d74F47a237a62e7A51cdDa67270CE381555e",
    tokens: [],
  },
  "421614": {
    id: "421614", name: "Arbitrum Sepolia", short: "Arb Sepolia",
    explorer: "https://sepolia.arbiscan.io", rpc: "https://arbitrum-sepolia-rpc.publicnode.com",
    native: "ETH", nativePriceKey: "ETH", wrapped: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
    ccipSelector: "3478487238524512106", link: "0xb1D4538B4571d411F07960EF2838Ce337FE1E80E",
    ccipRouter: "0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165", bnm: "0xA8C0c11bf64AF62CDCA6f93D3769B88BdD7cb93D",
    tokens: [],
  },
  "11155420": {
    id: "11155420", name: "Optimism Sepolia", short: "OP Sepolia",
    explorer: "https://sepolia-optimism.etherscan.io", rpc: "https://optimism-sepolia-rpc.publicnode.com",
    native: "ETH", nativePriceKey: "ETH", wrapped: "0x4200000000000000000000000000000000000006",
    ccipSelector: "5224473277236331295", link: "0xE4aB69C077896252FAFBD49EFD26B5D171A32410",
    ccipRouter: "0x114A20A10b43D4115e5aeef7345a1A71d2a60C57", bnm: "0x8aF4204e30565DF93352fE8E1De78925F6664dA7",
    tokens: [],
  },
  // ---- mainnets ----
  "1": {
    id: "1", name: "Ethereum", short: "Ethereum",
    explorer: "https://etherscan.io", rpc: "https://ethereum-rpc.publicnode.com",
    native: "ETH", nativePriceKey: "ETH", wrapped: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    ccipSelector: "5009297550715157269", link: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    tokens: [
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, priceKey: "USDC" },
      { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, priceKey: "ETH" },
    ],
  },
  "8453": {
    id: "8453", name: "Base", short: "Base",
    explorer: "https://basescan.org", rpc: "https://base-rpc.publicnode.com",
    native: "ETH", nativePriceKey: "ETH", wrapped: "0x4200000000000000000000000000000000000006",
    ccipSelector: "15971525489660198786", link: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196",
    tokens: [{ symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, priceKey: "USDC" }],
  },
  "42161": {
    id: "42161", name: "Arbitrum One", short: "Arbitrum",
    explorer: "https://arbiscan.io", rpc: "https://arbitrum-one-rpc.publicnode.com",
    native: "ETH", nativePriceKey: "ETH", wrapped: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    ccipSelector: "4949039107694359620", link: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    tokens: [{ symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, priceKey: "USDC" }],
  },
  "10": {
    id: "10", name: "Optimism", short: "Optimism",
    explorer: "https://optimistic.etherscan.io", rpc: "https://optimism-rpc.publicnode.com",
    native: "ETH", nativePriceKey: "ETH", wrapped: "0x4200000000000000000000000000000000000006",
    ccipSelector: "3734403246176062136", link: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6",
    tokens: [{ symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, priceKey: "USDC" }],
  },
  "137": {
    id: "137", name: "Polygon", short: "Polygon",
    explorer: "https://polygonscan.com", rpc: "https://polygon-bor-rpc.publicnode.com",
    native: "MATIC", wrapped: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    ccipSelector: "4051577828743386545", link: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
    tokens: [{ symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, priceKey: "USDC" }],
  },
  "43114": {
    id: "43114", name: "Avalanche", short: "Avalanche",
    explorer: "https://snowtrace.io", rpc: "https://avalanche-c-chain-rpc.publicnode.com",
    native: "AVAX", wrapped: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    ccipSelector: "6433500567565415381", link: "0x5947BB275c521040051D82396192181b413227A3",
    tokens: [{ symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, priceKey: "USDC" }],
  },
  "56": {
    id: "56", name: "BNB Chain", short: "BNB",
    explorer: "https://bscscan.com", rpc: "https://bsc-rpc.publicnode.com",
    native: "BNB", wrapped: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    ccipSelector: "11344663589394136015", link: "0x404460C6A5EdE2D891e8297795264fDe62ADBB75",
    tokens: [],
  },
}

const DEFAULT_CHAIN = SEPOLIA
const explorerTx = (chainId: string, hash: string) => `${(CHAINS[chainId]?.explorer || "https://sepolia.etherscan.io")}/tx/${hash}`

// Common names → chain id. Keeps "sepolia" meaning Ethereum Sepolia (not Base
// Sepolia) and disambiguates aliases before any fuzzy matching.
const CHAIN_ALIASES: Record<string, string> = {
  ethereum: "1", eth: "1", mainnet: "1", sepolia: "11155111", "ethereum sepolia": "11155111",
  base: "8453", "base sepolia": "84532",
  arbitrum: "42161", "arbitrum one": "42161", arb: "42161", "arbitrum sepolia": "421614", "arb sepolia": "421614",
  optimism: "10", op: "10", "optimism sepolia": "11155420", "op sepolia": "11155420",
  polygon: "137", matic: "137", avalanche: "43114", avax: "43114",
  bnb: "56", bsc: "56", "bnb chain": "56",
}

/** Resolve a chain from an id or a name ("base", "arbitrum", "sepolia"). */
export function resolveChain(input?: string): ChainCfg {
  if (!input) return CHAINS[DEFAULT_CHAIN]
  const s = String(input).trim().toLowerCase()
  if (CHAINS[s]) return CHAINS[s] // exact chain id
  if (CHAIN_ALIASES[s] && CHAINS[CHAIN_ALIASES[s]]) return CHAINS[CHAIN_ALIASES[s]]
  const exact = Object.values(CHAINS).find((c) => c.name.toLowerCase() === s || c.short.toLowerCase() === s)
  if (exact) return exact
  const fuzzy = Object.values(CHAINS).find((c) => c.name.toLowerCase().includes(s) || c.short.toLowerCase().includes(s))
  return fuzzy || CHAINS[DEFAULT_CHAIN]
}

// Chainlink price feeds on Sepolia (USD, 8 decimals). Asset price is the same on
// every chain, so we read these once regardless of the target chain.
export const PRICE_FEEDS: Record<string, string> = {
  ETH: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  BTC: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  LINK: "0xc59E3633BAAC79493d908e63626716e204A45EdF",
  DAI: "0x14866185B1962B63C3Ea9E03Bc1da838bab34C19",
  USDC: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
}

const norm = (s: string) => s.trim().toUpperCase()

/** Resolve a token on a given chain from a symbol or an address. */
function tokenFor(chain: ChainCfg, s: string): TokenDef | undefined {
  const u = norm(s)
  if (u === chain.native || u === "NATIVE") return { symbol: chain.native, address: "native", decimals: 18, priceKey: chain.nativePriceKey }
  return chain.tokens.find((t) => t.symbol === u) || (/^0x[0-9a-fA-F]{40}$/.test(s) ? { symbol: s.slice(0, 6), address: s, decimals: 18 } : undefined)
}

/** Pull the first numeric scalar out of an execute_contract_call view result. */
function scalarOf(data: unknown): string | undefined {
  if (data == null) return undefined
  if (typeof data === "string" || typeof data === "number") return String(data)
  const d = data as Record<string, any>
  const r = d.result ?? d.value ?? d.answer ?? d
  if (typeof r === "string" || typeof r === "number") return String(r)
  if (r && typeof r === "object") {
    const first = r.answer ?? r["1"] ?? r["0"] ?? Object.values(r)[0]
    if (typeof first === "string" || typeof first === "number") return String(first)
  }
  return undefined
}

async function nativeBalance(rpc: string, addr: string): Promise<number | null> {
  // hard timeout so one slow public RPC can't hang the whole multichain read
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }),
      cache: "no-store",
      signal: ctrl.signal,
    })
    const j = await r.json()
    return j?.result ? Number(BigInt(j.result)) / 1e18 : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Live USD price from a Chainlink feed (8-decimal answer). Chain-independent. */
export async function readPrice(symbol: string, kh?: KeeperHubClient): Promise<{ pair: string; price: number | null; source: string }> {
  const sym = norm(symbol)
  const feed = PRICE_FEEDS[sym]
  const pair = `${sym}/USD`
  if (!feed) return { pair, price: null, source: "no Chainlink feed" }
  const client = kh || (await new KeeperHubClient().init())
  const r = await client.callTool("execute_contract_call", {
    chain_id: SEPOLIA,
    contract_address: feed,
    function_name: "latestRoundData",
    function_args: "[]",
  })
  const raw = scalarOf(r.data)
  const price = raw != null ? Number(raw) / 1e8 : null
  return { pair, price: price != null ? +price.toFixed(2) : null, source: "Chainlink" }
}

async function erc20Balance(kh: KeeperHubClient, chainId: string, token: TokenDef, owner: string): Promise<number> {
  try {
    const r = await kh.callTool("execute_contract_call", {
      chain_id: chainId,
      contract_address: token.address,
      function_name: "balanceOf",
      function_args: JSON.stringify([owner]),
    })
    const raw = scalarOf(r.data)
    return raw != null ? Number(BigInt(raw)) / 10 ** token.decimals : 0
  } catch {
    return 0
  }
}

export type Holding = { symbol: string; amount: number; usd: number | null; price: number | null; kind: "native" | "erc20"; chain: string }

/** Real holdings on ONE chain: native + priced ERC20 balances. */
export async function readBalances(owner = KH_WALLET, network?: string): Promise<{
  wallet: string
  chainId: string
  network: string
  holdings: Holding[]
  totalUsd: number
}> {
  const chain = resolveChain(network)
  const kh = await new KeeperHubClient().init()

  const [nat, natPx] = await Promise.all([
    nativeBalance(chain.rpc, owner),
    chain.nativePriceKey ? readPrice(chain.nativePriceKey, kh) : Promise.resolve({ pair: "", price: null, source: "" }),
  ])
  const holdings: Holding[] = []
  const natUsd = nat != null && natPx.price != null ? +(nat * natPx.price).toFixed(2) : null
  holdings.push({ symbol: chain.native, amount: nat != null ? +nat.toFixed(5) : 0, usd: natUsd, price: natPx.price, kind: "native", chain: chain.short })

  // Read every ERC20 (balance + price) concurrently. Serial awaits here were the
  // portfolio bottleneck on serverless — one MCP round-trip per token in series.
  const tokenHoldings = await Promise.all(
    chain.tokens.map(async (t) => {
      const amount = await erc20Balance(kh, chain.id, t, owner)
      if (amount <= 0) return null
      const px = t.priceKey ? (await readPrice(t.priceKey, kh)).price : null
      return {
        symbol: t.symbol,
        amount: +amount.toFixed(t.decimals === 6 ? 2 : 5),
        price: px,
        usd: px != null ? +(amount * px).toFixed(2) : null,
        kind: "erc20" as const,
        chain: chain.short,
      }
    }),
  )
  for (const h of tokenHoldings) if (h) holdings.push(h)

  const totalUsd = +holdings.reduce((s, h) => s + (h.usd || 0), 0).toFixed(2)
  return { wallet: owner, chainId: chain.id, network: chain.name, holdings, totalUsd }
}

/** The multichain portfolio: holdings aggregated across several chains. */
export async function readAllBalances(owner = KH_WALLET, chainIds?: string[]): Promise<{
  wallet: string
  chains: Array<{ chainId: string; network: string; short: string; totalUsd: number; holdings: Holding[] }>
  holdings: Holding[]
  totalUsd: number
}> {
  const ids = chainIds && chainIds.length ? chainIds : ["11155111", "84532", "421614", "11155420"]
  // A chain read that never resolves (a testnet KeeperHub read can hang) must not
  // stall the whole portfolio — race each against a hard cap and drop the laggards.
  const perChain = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("chain timeout")), ms))])
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const b = await perChain(readBalances(owner, id), 9000)
        return { chainId: b.chainId, network: b.network, short: CHAINS[id]?.short || b.network, totalUsd: b.totalUsd, holdings: b.holdings }
      } catch {
        return null
      }
    }),
  )
  const chains = results.filter(Boolean) as Array<{ chainId: string; network: string; short: string; totalUsd: number; holdings: Holding[] }>
  const holdings = chains.flatMap((c) => c.holdings)
  const totalUsd = +chains.reduce((s, c) => s + c.totalUsd, 0).toFixed(2)
  return { wallet: owner, chains, holdings, totalUsd }
}

// ---- gas awareness ---------------------------------------------------------

async function rpcCall(rpc: string, method: string, params: unknown[]): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: ctrl.signal,
    })
    const j = await r.json()
    return j?.result
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export type GasInfo = { gasEth: number; gwei: number; usd: number | null; gasUsed: number }

/** What a mined tx actually cost: gasUsed × effectiveGasPrice, in ETH + USD.
 *  Polls briefly since the tx may still be confirming when we get the hash. */
export async function gasForTx(hash: string, network?: string): Promise<GasInfo | null> {
  const chain = resolveChain(network)
  let receipt: any
  for (let i = 0; i < 5; i++) {
    receipt = await rpcCall(chain.rpc, "eth_getTransactionReceipt", [hash])
    if (receipt && receipt.gasUsed) break
    await new Promise((r) => setTimeout(r, 1200))
  }
  if (!receipt || !receipt.gasUsed) return null
  const gasUsed = BigInt(receipt.gasUsed)
  let priceWei: bigint | null = receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice) : null
  if (priceWei == null) {
    const tx = await rpcCall(chain.rpc, "eth_getTransactionByHash", [hash])
    priceWei = tx?.gasPrice ? BigInt(tx.gasPrice) : null
  }
  if (priceWei == null) return null
  const gasEth = Number(gasUsed * priceWei) / 1e18
  const gwei = Number(priceWei) / 1e9
  let usd: number | null = null
  try {
    const px = (await readPrice(chain.nativePriceKey || chain.native || "ETH")).price
    if (px != null) usd = +(gasEth * px).toFixed(2)
  } catch {
    /* price feed optional */
  }
  return { gasEth: +gasEth.toFixed(6), gwei: +gwei.toFixed(2), usd, gasUsed: Number(gasUsed) }
}

/** A ready-to-speak phrase for a gas cost, e.g. " Gas: 0.00012 ETH (~$0.29)." */
export function gasPhrase(g: GasInfo | null | undefined): string {
  if (!g) return ""
  return ` Gas: ${g.gasEth} ETH${g.usd != null ? ` (~$${g.usd})` : ""}.`
}

// ---- writes: swap (Uniswap V3) + bridge (Chainlink CCIP) -------------------

export type ActionResult = {
  ok: boolean
  broadcast: boolean
  chain?: string
  tx?: { hash: string; explorer: string }
  openUrl?: string
  summary: string
  detail?: string
  gas?: GasInfo
}

const NOTIONAL_CAP_USD = 3000 // ~1 ETH+ per action; the KeeperHub daily cap is the per-day limit

async function usdValue(kh: KeeperHubClient, priceKey: string | undefined, symbol: string, amount: string): Promise<number | null> {
  const key = priceKey || symbol
  if (!PRICE_FEEDS[norm(key)]) return null
  const px = (await readPrice(key, kh)).price
  return px != null ? Number(amount) * px : null
}

/** A direct-execution result can be MCP-ok yet still have reverted; surface that. */
function simFailure(res: { isError: boolean; text?: string; data?: unknown }): string | undefined {
  if (res.isError) return res.text
  const d = res.data as Record<string, any> | undefined
  if (d && typeof d === "object") {
    if (d.status === "failed" || d.status === "reverted" || d.status === "error") return String(d.error || d.status)
    if (d.error && !d.transactionHash && !d.txHash && !d.hash) return String(d.error)
  }
  return undefined
}

/** Uniswap V3 exact-input swap on any supported chain. Preview = read-only quote. */
export async function doSwap(input: {
  fromToken: string
  toToken: string
  amount: string
  network?: string
  fee?: string
  slippagePct?: number
  execute?: boolean
}): Promise<ActionResult> {
  const chain = resolveChain(input.network)
  const kh = await new KeeperHubClient().init()
  const tin = tokenFor(chain, input.fromToken)
  const tout = tokenFor(chain, input.toToken)
  if (!tin || !tout) return { ok: false, broadcast: false, chain: chain.short, summary: `Unknown token on ${chain.short}`, detail: `couldn't resolve ${input.fromToken} or ${input.toToken}` }
  if (tin.address === "native" && !chain.wrapped) return { ok: false, broadcast: false, chain: chain.short, summary: `Native swaps aren't configured on ${chain.short} yet.` }
  const fee = input.fee || "3000"
  const isNative = tin.address === "native"
  const tokenInAddr = isNative ? chain.wrapped! : tin.address
  const toutAddr = tout.address === "native" ? chain.wrapped! : tout.address
  const amountIn = BigInt(Math.round(Number(input.amount) * 10 ** tin.decimals)).toString()

  // safety: bound the USD notional
  const notional = await usdValue(kh, tin.priceKey, tin.symbol, input.amount)
  if (notional != null && notional > NOTIONAL_CAP_USD)
    return { ok: false, broadcast: false, chain: chain.short, summary: `That swap is about $${notional.toFixed(0)}, over PARALLAX's $${NOTIONAL_CAP_USD} safety cap.`, detail: "raise NOTIONAL_CAP_USD in lib/defi.ts" }

  // read-only quote → expected output + slippage floor
  let amountOutMinimum = "0"
  let expectedOut: string | undefined
  try {
    const q = await kh.callTool("execute_protocol_action", {
      actionType: "uniswap/quote-exact-input",
      params: { network: chain.id, tokenIn: tokenInAddr, tokenOut: toutAddr, fee, amountIn },
    })
    expectedOut = scalarOf(q.data)
    if (expectedOut) {
      const slip = 1 - (input.slippagePct ?? 1) / 100
      amountOutMinimum = ((BigInt(expectedOut) * BigInt(Math.round(slip * 1000))) / BigInt(1000)).toString()
    }
  } catch {
    /* no quote on this chain — accept any output */
  }
  const outHuman = expectedOut ? Number(expectedOut) / 10 ** tout.decimals : null
  const outStr = outHuman != null ? `~${outHuman.toFixed(tout.decimals === 6 ? 2 : 5)} ${tout.symbol}` : tout.symbol

  if (!input.execute) {
    return { ok: true, broadcast: false, chain: chain.short, summary: `Swap preview on ${chain.short}: ${input.amount} ${tin.symbol} → ${outStr}. Say "execute" to broadcast.` }
  }

  const params: Record<string, unknown> = {
    network: chain.id,
    tokenIn: tokenInAddr,
    tokenOut: toutAddr,
    fee,
    recipient: KH_WALLET,
    amountIn,
    amountOutMinimum,
  }
  if (isNative) params.ethValue = input.amount

  const exec = await kh.callTool("execute_protocol_action", { actionType: "uniswap/swap-exact-input", params })
  const execErr = simFailure(exec)
  let hash = txHashOf(exec.data)
  if (!hash && !execErr) {
    const id = executionIdOf(exec.data)
    if (id) hash = txHashOf((await kh.pollDirect(id)).data)
  }
  if (execErr || !hash) return { ok: false, broadcast: false, chain: chain.short, summary: `Couldn't route ${input.amount} ${tin.symbol} → ${tout.symbol} on ${chain.short}.`, detail: execErr || exec.text }
  const gas = await gasForTx(hash, chain.id)
  return { ok: true, broadcast: true, chain: chain.short, tx: { hash, explorer: explorerTx(chain.id, hash) }, openUrl: explorerTx(chain.id, hash), gas: gas || undefined, summary: `Swapped ${input.amount} ${tin.symbol} → ${outStr} on ${chain.short}.${gasPhrase(gas)}` }
}

// CCIP requires receiver as abi.encode(address) (32 bytes), fee paid in LINK (the
// action can't attach native msg.value), and the token + LINK approved to the
// router. Testnet lanes move the CCIP-BnM test token (drippable). All verified.
const pad32 = (addr: string) => "0x" + addr.replace(/^0x/, "").toLowerCase().padStart(64, "0")
const BNM_DECIMALS = 18

async function approveRouter(kh: KeeperHubClient, chainId: string, token: string, router: string) {
  const MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  try {
    await kh.callTool("execute_contract_call", {
      chain_id: chainId,
      contract_address: token,
      function_name: "approve",
      function_args: JSON.stringify([router, MAX]),
    })
  } catch {
    /* an existing allowance is fine; ccip-send would surface a real allowance issue */
  }
}

function feeWeiOf(data: unknown): string | undefined {
  if (data == null) return undefined
  const d = data as Record<string, any>
  const f = d?.result?.fee ?? d?.fee ?? scalarOf(d)
  return f != null ? String(f) : undefined
}

/** Chainlink CCIP bridge (testnet BnM lanes). Preview = fee quote; execute drips
 *  the token if needed, approves the router, and sends. Fee is paid in LINK. */
export async function doBridge(input: {
  token?: string
  amount: string
  toChain: string
  fromChain?: string
  receiver?: string
  execute?: boolean
}): Promise<ActionResult> {
  const src = resolveChain(input.fromChain)
  const dst = resolveChain(input.toChain)
  const kh = await new KeeperHubClient().init()

  if (!src.ccipRouter || !src.bnm || !src.link)
    return { ok: false, broadcast: false, chain: src.short, summary: `CCIP bridging runs on the testnet BnM lanes. Source must be Sepolia, Base Sepolia, Arb Sepolia, or OP Sepolia — not ${src.short}.` }
  if (!dst.ccipSelector || !dst.bnm)
    return { ok: false, broadcast: false, chain: src.short, summary: `No CCIP-BnM lane to ${input.toChain}.`, detail: `destinations: ${Object.values(CHAINS).filter((c) => c.bnm && c.ccipSelector).map((c) => c.short).join(", ")}` }
  if (dst.id === src.id)
    return { ok: false, broadcast: false, chain: src.short, summary: `Source and destination are the same chain (${src.short}).` }

  const amtHuman = input.amount && Number(input.amount) > 0 ? input.amount : "0.01"
  const amount = BigInt(Math.round(Number(amtHuman) * 10 ** BNM_DECIMALS)).toString()
  const receiver = pad32(input.receiver || KH_WALLET)
  const tokenAmounts = JSON.stringify([{ token: src.bnm, amount }])
  const feeParams = { network: src.id, destinationChainSelector: dst.ccipSelector, receiver, tokenAmounts, feeToken: src.link }

  // read-only fee quote (works without holding the token)
  let feeWei: string | undefined
  try {
    const f = await kh.callTool("execute_protocol_action", { actionType: "chainlink/ccip-get-fee", params: feeParams })
    feeWei = feeWeiOf(f.data)
  } catch {
    /* quote unavailable — still allow execute to try */
  }
  const feeLink = feeWei ? (Number(feeWei) / 1e18).toFixed(3) : undefined

  if (!input.execute) {
    return { ok: true, broadcast: false, chain: src.short, summary: `Bridge preview: ${amtHuman} CCIP-BnM from ${src.short} → ${dst.short} via Chainlink CCIP${feeLink ? ` (fee ~${feeLink} LINK)` : ""}. Say "execute" to broadcast.` }
  }

  // 1) ensure the wallet holds enough CCIP-BnM (the faucet mints 1 BnM)
  const bnmBal = await erc20Balance(kh, src.id, { symbol: "BnM", address: src.bnm, decimals: BNM_DECIMALS }, KH_WALLET)
  if (bnmBal < Number(amtHuman)) {
    await kh.callTool("execute_protocol_action", { actionType: "chainlink/ccip-bnm-drip", params: { network: src.id, contractAddress: src.bnm, to: KH_WALLET } })
  }

  // 2) ensure LINK for the fee (LINK can't be faucet-minted via the API)
  const linkBal = await erc20Balance(kh, src.id, { symbol: "LINK", address: src.link, decimals: 18 }, KH_WALLET)
  const needLink = feeWei ? Number(feeWei) / 1e18 : 0.06
  if (linkBal < needLink)
    return { ok: false, broadcast: false, chain: src.short, summary: `Bridge is ready — it just needs ~${needLink.toFixed(3)} testnet LINK for the CCIP fee. Fund LINK to ${KH_WALLET.slice(0, 6)}…${KH_WALLET.slice(-4)} at faucets.chain.link, then run it again.`, detail: `LINK balance: ${linkBal}` }

  // 3) approve the router to pull the bridged token + the LINK fee
  await approveRouter(kh, src.id, src.bnm, src.ccipRouter)
  await approveRouter(kh, src.id, src.link, src.ccipRouter)

  // 4) send
  const exec = await kh.callTool("execute_protocol_action", { actionType: "chainlink/ccip-send", params: feeParams })
  const execErr = simFailure(exec)
  let hash = txHashOf(exec.data)
  if (!hash && !execErr) {
    const id = executionIdOf(exec.data)
    if (id) hash = txHashOf((await kh.pollDirect(id)).data)
  }
  if (execErr || !hash) return { ok: false, broadcast: false, chain: src.short, summary: `CCIP send didn't go through from ${src.short} → ${dst.short}.`, detail: execErr || exec.text }
  const gas = await gasForTx(hash, src.id)
  return { ok: true, broadcast: true, chain: src.short, tx: { hash, explorer: explorerTx(src.id, hash) }, openUrl: explorerTx(src.id, hash), gas: gas || undefined, summary: `Bridged ${amtHuman} CCIP-BnM from ${src.short} → ${dst.short} via Chainlink CCIP — track delivery at ccip.chain.link.${gasPhrase(gas)}` }
}

/** Protocol interaction: wrap native ETH into WETH via the canonical WETH9
 *  contract (verified working on Sepolia). A clean, reliable on-chain protocol op. */
export async function wrapEth(input: { amountEth: string; network?: string; execute?: boolean }): Promise<ActionResult> {
  const chain = resolveChain(input.network)
  const kh = await new KeeperHubClient().init()
  const amt = input.amountEth && Number(input.amountEth) > 0 ? input.amountEth : "0.001"
  if (!input.execute) {
    return { ok: true, broadcast: false, chain: chain.short, summary: `Wrap preview: ${amt} ETH → WETH on ${chain.short}. Say "execute" to wrap.` }
  }
  const exec = await kh.callTool("execute_protocol_action", { actionType: "wrapped/wrap", params: { network: chain.id, ethValue: amt } })
  const err = simFailure(exec)
  let hash = txHashOf(exec.data)
  if (!hash && !err) {
    const id = executionIdOf(exec.data)
    if (id) hash = txHashOf((await kh.pollDirect(id)).data)
  }
  if (err || !hash) return { ok: false, broadcast: false, chain: chain.short, summary: `Couldn't wrap ${amt} ETH on ${chain.short}.`, detail: err || exec.text }
  const gas = await gasForTx(hash, chain.id)
  return { ok: true, broadcast: true, chain: chain.short, tx: { hash, explorer: explorerTx(chain.id, hash) }, openUrl: explorerTx(chain.id, hash), gas: gas || undefined, summary: `Wrapped ${amt} ETH into WETH on ${chain.short} — a real interaction with the WETH protocol.${gasPhrase(gas)}` }
}

/** Fund the managed wallet with CCIP-BnM (the CCIP test token) so a real bridge
 * can broadcast on testnet. Uses KeeperHub's built-in faucet action. */
export async function dripCcipBnm(network?: string): Promise<ActionResult> {
  const chain = resolveChain(network)
  const kh = await new KeeperHubClient().init()
  const exec = await kh.callTool("execute_protocol_action", { actionType: "chainlink/ccip-bnm-drip", params: { network: chain.id } })
  const err = simFailure(exec)
  const hash = txHashOf(exec.data)
  if (err || !hash) return { ok: false, broadcast: false, chain: chain.short, summary: `Couldn't drip CCIP-BnM on ${chain.short}.`, detail: err || exec.text }
  return { ok: true, broadcast: true, chain: chain.short, tx: { hash, explorer: explorerTx(chain.id, hash) }, openUrl: explorerTx(chain.id, hash), summary: `Dripped CCIP-BnM test tokens to the wallet on ${chain.short}.` }
}

// ---- yield: supply into Aave V3 (a real, interest-earning position) ---------
// Reality on Sepolia (verified on-chain): the stablecoin lending markets (USDC,
// DAI) are supply-capped and FULL, so a supply of them reverts with Aave error
// 51 (SUPPLY_CAP_EXCEEDED). LINK's market is uncapped + active and reliably
// accepts supplies. So "invest my dollars" routes the deposit to the LINK market
// (sized to the requested USD notional) — a genuinely smart, cap-aware move that
// also fits "keep the yield good". execute_contract_call broadcasts writes (same
// path the CCIP bridge uses), so mint→approve→supply is fully real on-chain.
const AAVE_V3_SEPOLIA = {
  pool: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
  faucet: "0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D",
  usdc: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
  link: "0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5", // uncapped + active reserve
}
const MAX_UINT = "115792089237316195423570985008687907853269984665640564039457584007913129639935"

async function aaveApy(kh: KeeperHubClient, asset: string): Promise<number | undefined> {
  try {
    const rd = await kh.callTool("execute_contract_call", { chain_id: SEPOLIA, contract_address: AAVE_V3_SEPOLIA.pool, function_name: "getReserveData", function_args: JSON.stringify([asset]) })
    const rate = (rd.data as any)?.result?.currentLiquidityRate ?? (rd.data as any)?.currentLiquidityRate
    if (rate) return +((Number(BigInt(String(rate))) / 1e27) * 100).toFixed(2) // ray (1e27) → %
  } catch {
    /* apy is a nice-to-have */
  }
  return undefined
}

async function erc20Allowance(kh: KeeperHubClient, chainId: string, token: string, owner: string, spender: string): Promise<number> {
  try {
    const r = await kh.callTool("execute_contract_call", { chain_id: chainId, contract_address: token, function_name: "allowance", function_args: JSON.stringify([owner, spender]) })
    const raw = scalarOf(r.data)
    return raw != null ? Number(BigInt(raw)) : 0
  } catch {
    return 0
  }
}

export type InvestResult = ActionResult & { apyPct?: number; asset?: string; usd?: number; qty?: number }

/** Real yield deposit into Aave V3. The requested USD amount is supplied into the
 *  uncapped LINK market (Sepolia stable markets are at capacity). Preview = quote. */
export async function investYield(input: { amountUsdc?: string; execute?: boolean }): Promise<InvestResult> {
  const chain = resolveChain("sepolia")
  const kh = await new KeeperHubClient().init()
  const usd = input.amountUsdc && Number(input.amountUsdc) > 0 ? Number(input.amountUsdc) : 50
  const symbol = "LINK"
  const asset = AAVE_V3_SEPOLIA.link
  const decimals = 18

  const [apyPct, linkPx] = await Promise.all([aaveApy(kh, asset), readPrice("LINK", kh).then((p) => p.price)])
  const qty = linkPx && linkPx > 0 ? +(usd / linkPx).toFixed(4) : usd // ~USD worth of LINK
  const amount = BigInt(Math.round(qty * 10 ** decimals)).toString()

  if (!input.execute) {
    return { ok: true, broadcast: false, chain: chain.short, apyPct, asset: symbol, usd, qty, summary: `Invest preview: USDC's Aave market is at capacity on ${chain.short}, so I'd put your ~$${usd} (about ${qty} LINK) into Aave's uncapped LINK market${apyPct != null ? ` at ~${apyPct}% APY` : ""}. Say "invest" to deposit.` }
  }

  // ensure the wallet holds enough of the asset (mint from the Aave faucet if short)
  let bal = await erc20Balance(kh, chain.id, { symbol, address: asset, decimals }, KH_WALLET)
  if (bal < qty) {
    await kh.callTool("execute_contract_call", { chain_id: chain.id, contract_address: AAVE_V3_SEPOLIA.faucet, function_name: "mint", function_args: JSON.stringify([asset, KH_WALLET, amount]) })
    bal = await erc20Balance(kh, chain.id, { symbol, address: asset, decimals }, KH_WALLET)
    if (bal < qty) return { ok: false, broadcast: false, chain: chain.short, apyPct, asset: symbol, summary: `Couldn't obtain enough ${symbol} to invest ~$${usd}.` }
  }

  // approve the pool once (MAX so any later top-up needs no re-approve), then supply
  const allowance = await erc20Allowance(kh, chain.id, asset, KH_WALLET, AAVE_V3_SEPOLIA.pool)
  if (allowance < qty * 10 ** decimals) {
    await kh.callTool("execute_contract_call", { chain_id: chain.id, contract_address: asset, function_name: "approve", function_args: JSON.stringify([AAVE_V3_SEPOLIA.pool, MAX_UINT]) })
  }
  const sup = await kh.callTool("execute_protocol_action", { actionType: "aave-v3/supply", params: { network: chain.id, asset, amount, onBehalfOf: KH_WALLET } })
  const execErr = simFailure(sup)
  let hash = txHashOf(sup.data)
  if (!hash && !execErr) {
    const id = executionIdOf(sup.data)
    if (id) hash = txHashOf((await kh.pollDirect(id)).data)
  }
  if (execErr || !hash)
    return { ok: false, broadcast: false, chain: chain.short, apyPct, asset: symbol, summary: `Couldn't supply your ~$${usd} into Aave V3 on ${chain.short}.`, detail: execErr || sup.text }

  const gas = await gasForTx(hash, chain.id)
  return {
    ok: true,
    broadcast: true,
    chain: chain.short,
    tx: { hash, explorer: explorerTx(chain.id, hash) },
    openUrl: explorerTx(chain.id, hash),
    apyPct,
    asset: symbol,
    usd,
    qty,
    gas: gas || undefined,
    summary: `Invested your ~$${usd} (${qty} LINK) into Aave V3 on ${chain.short}${apyPct != null ? `, now earning ~${apyPct}% APY` : ""} — USDC's market was at capacity, so I routed to the uncapped LINK market.${gasPhrase(gas)}`,
  }
}
