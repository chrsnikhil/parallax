// Sample data for the PARALLAX wallet views. Presentational only — no live wiring.

export const BRAND = "Parallax"
export const CAP = 50 // USDC delegation cap (Ledger-rooted MetaMask delegation)

export type Chain = {
  name: string
  short: string
  color: string
}

export const CHAINS: Record<string, Chain> = {
  base: { name: "Base", short: "BASE", color: "#0052FF" },
  arbitrum: { name: "Arbitrum", short: "ARB", color: "#28A0F0" },
  optimism: { name: "Optimism", short: "OP", color: "#FF0420" },
  ethereum: { name: "Ethereum", short: "ETH", color: "#627EEA" },
}

export type Token = {
  symbol: string
  name: string
  chainKey: keyof typeof CHAINS
  amount: string // display string (already formatted)
  usd: number
}

export const TOKENS: Token[] = [
  { symbol: "USDC", name: "USD Coin", chainKey: "base", amount: "8,204.51", usd: 8204.51 },
  { symbol: "USDC", name: "USD Coin", chainKey: "arbitrum", amount: "2,150.00", usd: 2150.0 },
  { symbol: "ETH", name: "Ethereum", chainKey: "base", amount: "0.6120", usd: 1584.22 },
  { symbol: "cbETH", name: "Coinbase ETH", chainKey: "base", amount: "0.1840", usd: 498.11 },
  { symbol: "USDT", name: "Tether", chainKey: "optimism", amount: "43.20", usd: 43.2 },
]

export const TOTAL_USD = TOKENS.reduce((s, t) => s + t.usd, 0)

export type AllocSlice = { label: string; usd: number; color: string }
export const ALLOCATION: AllocSlice[] = [
  { label: "Stablecoins", usd: 10397.71, color: "#86efac" },
  { label: "ETH & LSTs", usd: 2082.33, color: "#627EEA" },
]

export type AutomationStatus = "active" | "paused" | "armed"
export type Automation = {
  id: string
  title: string
  status: AutomationStatus
  statusLabel: string
  trigger: string
  lastRun: string
  tx: string | null
}

export const AUTOMATIONS: Automation[] = [
  {
    id: "yield",
    title: "Keep 50 in best yield",
    status: "active",
    statusLabel: "Active",
    trigger: "Rebalance idle USDC into the highest-APY allowlisted venue, capped at 50 USDC per move.",
    lastRun: "2h ago",
    tx: "0x9d00c4a1b749f2e0",
  },
  {
    id: "depeg",
    title: "Depeg → evacuate",
    status: "armed",
    statusLabel: "Armed",
    trigger: "If any held stablecoin trades below $0.985 for 3 blocks, evacuate to the safe-haven venue.",
    lastRun: "never triggered",
    tx: null,
  },
  {
    id: "sweep",
    title: "Weekly gas sweep",
    status: "active",
    statusLabel: "Active",
    trigger: "Every Monday, consolidate dust below 5 USDC across chains back into Base USDC.",
    lastRun: "5d ago",
    tx: "0x39708f2c55b4d1aa",
  },
  {
    id: "ladder",
    title: "Yield ladder unwind",
    status: "paused",
    statusLabel: "Paused",
    trigger: "Unwind laddered positions as they mature and route proceeds to the primary vault.",
    lastRun: "12d ago",
    tx: "0x4ca02312951f88b0",
  },
]

export const VENUES = ["Aave v3", "Compound", "Moonwell", "Morpho"]

export type ActivityStatus = "ok" | "rejected"
export type Activity = {
  action: string
  desc: string
  amount: string
  unit: string
  venue: string
  tx: string
  when: string
  status: ActivityStatus
}

export const ACTIVITY: Activity[] = [
  { action: "INVEST", desc: "Idle USDC → best yield", amount: "40.00", unit: "USDC", venue: "Moonwell", tx: "0x9d00c4…b749f", when: "2h ago", status: "ok" },
  { action: "REBALANCE", desc: "Migrated position", amount: "1,200.00", unit: "USDC", venue: "Aave → Compound", tx: "0x39708f…55b4d", when: "1d ago", status: "ok" },
  { action: "REJECTED", desc: "Move exceeded cap", amount: "80.00", unit: "USDC", venue: "on-chain bound", tx: "0x00d7a1…c0ffee", when: "1d ago", status: "rejected" },
  { action: "PROTECT", desc: "Evacuate → safe haven", amount: "6,500.00", unit: "USDC", venue: "Aave v3", tx: "0x4ca023…12951f", when: "3d ago", status: "ok" },
  { action: "SWEEP", desc: "Dust consolidation", amount: "12.84", unit: "USDC", venue: "cross-chain", tx: "0x71bd5e…9a02c", when: "5d ago", status: "ok" },
  { action: "INVEST", desc: "Fresh deposit routed", amount: "2,000.00", unit: "USDC", venue: "Morpho", tx: "0xb4e0aa…7c31d", when: "8d ago", status: "ok" },
]

export function fakeHash() {
  const h = "0123456789abcdef"
  let s = "0x"
  for (let i = 0; i < 64; i++) s += h[Math.floor(Math.random() * 16)]
  return s
}

export function parseAmount(cmd: string): number | null {
  const m = cmd.match(/(\d[\d,]*(?:\.\d+)?)/)
  if (!m) return null
  return Number(m[1].replace(/,/g, ""))
}

export function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
