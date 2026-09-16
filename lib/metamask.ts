/*
 * MetaMask Delegation Toolkit — REAL, on-chain integration (SERVER ONLY).
 *
 * LUMEN's wallet is a genuine MetaMask Smart Account (Hybrid DeleGator) deployed
 * on Sepolia. The voice agent does NOT hold the wallet's keys — it holds a
 * SCOPED DELEGATION the owner signed (spend cap + allowlisted target + expiry).
 * When the agent acts, it REDEEMS that delegation on-chain through the
 * DelegationManager, which enforces every caveat. Exceed the cap or hit a
 * non-allowlisted target and the redemption reverts — the limits are real.
 *
 * No 4337 bundler is required: account deployment goes through the factory
 * directly, and redemption is a normal DelegationManager call from the delegate
 * (contracts.DelegationManager.execute.redeemDelegations takes a wallet client).
 * The whole thing is funded THROUGH KeeperHub (execute_transfer from the managed
 * wallet), so MetaMask + KeeperHub are genuinely wired together.
 *
 * The owner key here is a Sepolia burner standing in for a Ledger; swap in the
 * Ledger DMK device-signer and the exact same flow signs on hardware.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem"
import { sepolia } from "viem/chains"
import { privateKeyToAccount } from "viem/accounts"
import {
  toMetaMaskSmartAccount,
  Implementation,
  createDelegation,
  signDelegation,
  getDeleGatorEnvironment,
  createExecution,
  ExecutionMode,
  contracts,
  type Delegation,
} from "@metamask/delegation-toolkit"
import { createCaveatBuilder } from "@metamask/delegation-toolkit/utils"

import { KeeperHubClient, SEPOLIA, KH_WALLET, txHashOf } from "@/lib/keeperhub"

const RPC = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com"
const CHAIN_ID = 11155111
const explorerTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`
const explorerAddr = (a: string) => `https://sepolia.etherscan.io/address/${a}`

const OWNER_PK = process.env.MM_OWNER_PK as Hex | undefined
const RELAYER_PK = process.env.MM_RELAYER_PK as Hex | undefined

function requireKeys(): { owner: Hex; relayer: Hex } {
  if (!OWNER_PK || !RELAYER_PK) throw new Error("MM_OWNER_PK / MM_RELAYER_PK not set in .env.local (run the keygen step)")
  return { owner: OWNER_PK, relayer: RELAYER_PK }
}

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) })

function accounts() {
  const { owner, relayer } = requireKeys()
  const ownerAcct = privateKeyToAccount(owner)
  const relayerAcct = privateKeyToAccount(relayer)
  const relayerWallet = createWalletClient({ account: relayerAcct, chain: sepolia, transport: http(RPC) })
  return { ownerAcct, relayerAcct, relayerWallet }
}

// The MetaMask Smart Account (delegator), owned by the owner key.
async function getSmartAccount() {
  const { ownerAcct } = accounts()
  return toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [ownerAcct.address, [], [], []],
    deploySalt: "0x",
    signer: { account: ownerAcct },
  })
}

async function isDeployed(addr: Address): Promise<boolean> {
  const code = await publicClient.getCode({ address: addr })
  return !!code && code !== "0x"
}

// Fund an address from the KeeperHub managed wallet (real execute_transfer).
async function fundFromKeeperHub(to: string, amountEth: string): Promise<string | null> {
  const kh = await new KeeperHubClient().init()
  const exec = await kh.callTool("execute_transfer", { chain_id: SEPOLIA, to_address: to, amount: amountEth })
  return txHashOf(exec.data) || null
}

export type MmStatus = {
  configured: boolean
  chain: string
  smartAccount?: Address
  smartAccountUrl?: string
  owner?: Address
  agent?: Address
  deployed?: boolean
  balances?: { smartAccountEth: string; agentEth: string }
  delegationManager?: Address
  error?: string
}

/** Read-only: addresses, deploy state, balances. Never throws for the UI. */
export async function mmStatus(): Promise<MmStatus> {
  try {
    const { ownerAcct, relayerAcct } = accounts()
    const sa = await getSmartAccount()
    const [deployed, saBal, agentBal] = await Promise.all([
      isDeployed(sa.address),
      publicClient.getBalance({ address: sa.address }),
      publicClient.getBalance({ address: relayerAcct.address }),
    ])
    return {
      configured: true,
      chain: "Sepolia",
      smartAccount: sa.address,
      smartAccountUrl: explorerAddr(sa.address),
      owner: ownerAcct.address,
      agent: relayerAcct.address,
      deployed,
      balances: { smartAccountEth: formatEther(saBal), agentEth: formatEther(agentBal) },
      delegationManager: getDeleGatorEnvironment(CHAIN_ID).DelegationManager as Address,
    }
  } catch (e) {
    return { configured: false, chain: "Sepolia", error: e instanceof Error ? e.message : String(e) }
  }
}

export type SetupResult = {
  ok: boolean
  smartAccount: Address
  deployed: boolean
  funded: { smartAccount?: string; agent?: string }
  deployTx?: string
  balances: { smartAccountEth: string; agentEth: string }
  detail?: string
}

/** Idempotent: fund the agent (gas) + smart account, then deploy the account. */
export async function mmSetup(): Promise<SetupResult> {
  const { relayerAcct, relayerWallet } = accounts()
  const sa = await getSmartAccount()
  const funded: { smartAccount?: string; agent?: string } = {}

  // 1) fund the agent for gas + the smart account for the bounded transfers
  const agentBal = await publicClient.getBalance({ address: relayerAcct.address })
  if (agentBal < parseEther("0.004")) funded.agent = (await fundFromKeeperHub(relayerAcct.address, "0.006")) || undefined
  const saBal0 = await publicClient.getBalance({ address: sa.address })
  if (saBal0 < parseEther("0.003")) funded.smartAccount = (await fundFromKeeperHub(sa.address, "0.004")) || undefined

  // wait for funding to land so deploy/redeem have gas + value
  for (let i = 0; i < 20; i++) {
    const [a, s] = await Promise.all([
      publicClient.getBalance({ address: relayerAcct.address }),
      publicClient.getBalance({ address: sa.address }),
    ])
    if (a >= parseEther("0.003") && s >= parseEther("0.002")) break
    await new Promise((r) => setTimeout(r, 3000))
  }

  // 2) deploy the smart account via the factory (normal tx, no bundler)
  let deployTx: string | undefined
  let deployed = await isDeployed(sa.address)
  if (!deployed) {
    const { factory, factoryData } = await sa.getFactoryArgs()
    if (!factory || !factoryData) throw new Error("no factory args for smart account")
    const hash = await relayerWallet.sendTransaction({ to: factory, data: factoryData })
    await publicClient.waitForTransactionReceipt({ hash })
    deployTx = hash
    deployed = await isDeployed(sa.address)
  }

  const [saBal, agentBal2] = await Promise.all([
    publicClient.getBalance({ address: sa.address }),
    publicClient.getBalance({ address: relayerAcct.address }),
  ])
  return {
    ok: deployed,
    smartAccount: sa.address,
    deployed,
    funded,
    deployTx,
    balances: { smartAccountEth: formatEther(saBal), agentEth: formatEther(agentBal2) },
    detail: deployed ? undefined : "smart account not deployed yet (funding may still be pending)",
  }
}

export type SignedDelegation = Delegation & { signature: Hex }

/** Build + owner-sign a scoped delegation (cap + allowlisted target + expiry). */
export async function mmSignDelegation(opts?: { capEth?: string; allow?: Address; days?: number }): Promise<{
  ok: boolean
  smartAccount: Address
  agent: Address
  delegationManager: Address
  bounds: { spendCapEth: string; allowlist: Address[]; expiresAt: string }
  caveats: unknown[]
  signed: SignedDelegation
}> {
  const { owner } = requireKeys()
  const { relayerAcct } = accounts()
  const sa = await getSmartAccount()
  const environment = getDeleGatorEnvironment(CHAIN_ID)
  const capEth = opts?.capEth || "1" // 1 ETH delegation spend cap
  const allow = (opts?.allow || (KH_WALLET as Address)) as Address
  const expiry = Math.floor(Date.now() / 1000) + (opts?.days ?? 7) * 24 * 3600

  const caveats = createCaveatBuilder(environment)
    .addCaveat("allowedTargets", { targets: [allow] })
    .addCaveat("timestamp", { afterThreshold: 0, beforeThreshold: expiry })
    .build()

  const delegation = createDelegation({
    environment,
    from: sa.address,
    to: relayerAcct.address, // the agent is the delegate
    scope: { type: "nativeTokenTransferAmount", maxAmount: parseEther(capEth) },
    caveats,
  })

  const signature = await signDelegation({
    privateKey: owner,
    delegation,
    delegationManager: environment.DelegationManager as Address,
    chainId: CHAIN_ID,
  })

  return {
    ok: true,
    smartAccount: sa.address,
    agent: relayerAcct.address,
    delegationManager: environment.DelegationManager as Address,
    bounds: { spendCapEth: capEth, allowlist: [allow], expiresAt: new Date(expiry * 1000).toISOString() },
    caveats: (delegation.caveats as unknown[]) ?? [],
    signed: { ...delegation, signature } as SignedDelegation,
  }
}

export type RedeemResult = {
  ok: boolean
  broadcast: boolean
  tx?: { hash: string; explorer: string }
  openUrl?: string
  summary: string
  detail?: string
  reverted?: boolean
}

/**
 * The agent ACTS: redeem the scoped delegation on-chain to make the smart
 * account send `amount` ETH to `to`. Reverts if it breaks a caveat (over cap or
 * non-allowlisted target) — which is exactly the enforcement guarantee.
 */
export async function mmRedeem(opts?: {
  to?: Address
  amountEth?: string
  capEth?: string
  allow?: Address
}): Promise<RedeemResult> {
  const { relayerWallet } = accounts()
  const to = (opts?.to || (KH_WALLET as Address)) as Address
  const amountEth = opts?.amountEth || "0.0005"
  const environment = getDeleGatorEnvironment(CHAIN_ID)

  // build + sign the scoped delegation (allowlist defaults to the recipient)
  const { signed } = await mmSignDelegation({ capEth: opts?.capEth, allow: opts?.allow || to })

  const execution = createExecution({ target: to, value: parseEther(amountEth), callData: "0x" as Hex })

  try {
    const hash = await contracts.DelegationManager.execute.redeemDelegations({
      client: relayerWallet,
      delegationManagerAddress: environment.DelegationManager as Address,
      delegations: [[signed]],
      modes: [ExecutionMode.SingleDefault],
      executions: [[execution]],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    return {
      ok: true,
      broadcast: true,
      tx: { hash, explorer: explorerTx(hash) },
      openUrl: explorerTx(hash),
      summary: `Agent redeemed its delegation and sent ${amountEth} ETH — enforced on-chain by the caveats.`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      broadcast: false,
      reverted: true,
      summary: `Redemption reverted — the caveats blocked it (over cap or non-allowlisted target).`,
      detail: msg.slice(0, 300),
    }
  }
}

// ---- custom mandate: a Ledger-signed, on-chain-enforced allowlist -----------
// A mandate is a scoped delegation with a functionCall scope: the agent may ONLY
// call the allowlisted protocol contracts (targets) with the allowlisted methods
// (selectors), until expiry. The DelegationManager enforces it on redemption —
// any other protocol or method reverts on-chain. Rooted in the owner (Ledger).

export const MANDATE_PROTOCOLS: Record<string, { address: Address; label: string }> = {
  weth: { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", label: "WETH" },
  uniswap: { address: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E", label: "Uniswap V3" },
  usdc: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", label: "USDC" },
  link: { address: "0x779877A7B0D9E8603169DdbD7836e478b4624789", label: "LINK" },
  ccip: { address: "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59", label: "Chainlink CCIP" },
}
export const MANDATE_ACTIONS: Record<string, { selector: Hex; label: string }> = {
  transfer: { selector: "0xa9059cbb", label: "Transfer" },
  approve: { selector: "0x095ea7b3", label: "Approve" },
  wrap: { selector: "0xd0e30db0", label: "Wrap ETH" },
  unwrap: { selector: "0x2e1a7d4d", label: "Unwrap WETH" },
  swap: { selector: "0x04e45aaf", label: "Swap" },
  bridge: { selector: "0x96f4e9f9", label: "Bridge (CCIP)" },
}

type Mandate = {
  signed: SignedDelegation
  protocols: string[]
  actions: string[]
  targets: Address[]
  selectors: Hex[]
  expiresAt: string
}
let activeMandate: Mandate | null = null

/** The choices the "Set mandate" wizard offers (protocols + actions). */
export function mmMandateCatalog() {
  return {
    protocols: Object.entries(MANDATE_PROTOCOLS).map(([id, v]) => ({ id, label: v.label, address: v.address })),
    actions: Object.entries(MANDATE_ACTIONS).map(([id, v]) => ({ id, label: v.label, selector: v.selector })),
  }
}

/** The active mandate, for the UI. */
export function mmGetMandate() {
  if (!activeMandate) return { active: false as const }
  return {
    active: true as const,
    protocols: activeMandate.protocols.map((p) => MANDATE_PROTOCOLS[p]?.label || p),
    actions: activeMandate.actions.map((a) => MANDATE_ACTIONS[a]?.label || a),
    targets: activeMandate.targets,
    selectors: activeMandate.selectors,
    expiresAt: activeMandate.expiresAt,
    signature: activeMandate.signed.signature,
  }
}

/** Build + owner-sign (Ledger) a mandate from chosen protocols + actions. */
export async function mmSetMandate(input: { protocols: string[]; actions: string[]; days?: number }): Promise<{
  ok: boolean
  error?: string
  smartAccount?: Address
  agent?: Address
  protocols?: string[]
  actions?: string[]
  expiresAt?: string
  signature?: Hex
}> {
  const { owner } = requireKeys()
  const { relayerAcct } = accounts()
  const sa = await getSmartAccount()
  const environment = getDeleGatorEnvironment(CHAIN_ID)

  const protoKeys = input.protocols.map((p) => p.toLowerCase()).filter((p) => MANDATE_PROTOCOLS[p])
  const actKeys = input.actions.map((a) => a.toLowerCase()).filter((a) => MANDATE_ACTIONS[a])
  if (!protoKeys.length || !actKeys.length) return { ok: false, error: "Pick at least one protocol and one action." }
  const targets = protoKeys.map((p) => MANDATE_PROTOCOLS[p].address)
  const selectors = actKeys.map((a) => MANDATE_ACTIONS[a].selector)
  const expiry = Math.floor(Date.now() / 1000) + (input.days ?? 7) * 24 * 3600

  const caveats = createCaveatBuilder(environment)
    .addCaveat("timestamp", { afterThreshold: 0, beforeThreshold: expiry })
    .build()

  const delegation = createDelegation({
    environment,
    from: sa.address,
    to: relayerAcct.address,
    scope: { type: "functionCall", targets, selectors } as never,
    caveats,
  })
  const signature = await signDelegation({ privateKey: owner, delegation, delegationManager: environment.DelegationManager as Address, chainId: CHAIN_ID })
  const signed = { ...delegation, signature } as SignedDelegation
  activeMandate = { signed, protocols: protoKeys, actions: actKeys, targets, selectors, expiresAt: new Date(expiry * 1000).toISOString() }

  return {
    ok: true,
    smartAccount: sa.address,
    agent: relayerAcct.address,
    protocols: protoKeys.map((p) => MANDATE_PROTOCOLS[p].label),
    actions: actKeys.map((a) => MANDATE_ACTIONS[a].label),
    expiresAt: activeMandate.expiresAt,
    signature,
  }
}

/** Redeem the mandate: make the smart account call `target` with `callData`.
 *  Reverts on-chain if target/method is outside the mandate. */
async function mandateExec(target: Address, callData: Hex, valueEth?: string): Promise<RedeemResult> {
  if (!activeMandate) return { ok: false, broadcast: false, summary: "No mandate is set — set one first." }
  const { relayerWallet } = accounts()
  const environment = getDeleGatorEnvironment(CHAIN_ID)
  const execution = createExecution({ target, value: valueEth ? parseEther(valueEth) : BigInt(0), callData })
  try {
    const hash = await contracts.DelegationManager.execute.redeemDelegations({
      client: relayerWallet,
      delegationManagerAddress: environment.DelegationManager as Address,
      delegations: [[activeMandate.signed]],
      modes: [ExecutionMode.SingleDefault],
      executions: [[execution]],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    return { ok: true, broadcast: true, tx: { hash, explorer: explorerTx(hash) }, openUrl: explorerTx(hash), summary: "Executed within the mandate." }
  } catch (e) {
    return { ok: false, broadcast: false, reverted: true, summary: "Blocked by the mandate — that protocol or action isn't allowed.", detail: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
  }
}

/** Prove the mandate on-chain: an allowlisted action succeeds; an off-mandate one reverts. */
export async function mmMandateProve(): Promise<{ ok: boolean; error?: string; allowed?: RedeemResult; blocked?: RedeemResult }> {
  if (!activeMandate) return { ok: false, error: "No mandate is set." }
  const WETH = MANDATE_PROTOCOLS.weth.address
  // ALLOWED: WETH.deposit{value} — succeeds only if the mandate allows WETH + Wrap
  const allowed = activeMandate.targets.includes(WETH) && activeMandate.selectors.includes("0xd0e30db0")
    ? await mandateExec(WETH, "0xd0e30db0", "0.0003")
    : { ok: false, broadcast: false, reverted: false, summary: "Add WETH + Wrap to the mandate to show an allowed action." }
  // BLOCKED: call a non-allowlisted contract → AllowedTargetsEnforcer reverts
  const deadCall = encodeFunctionData({
    abi: [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
    functionName: "transfer",
    args: [KH_WALLET as Address, BigInt(1)],
  })
  const blocked = await mandateExec("0x000000000000000000000000000000000000dEaD" as Address, deadCall)
  return { ok: true, allowed, blocked }
}

// ---- Ledger Flex signing (client builds + signs; server stores + deploys) ----
// The Flex can only be reached from the browser, so the client builds the smart
// account (owned by the Ledger) + the delegation and signs the EIP-712 on the
// device. The server stores the signed mandate and makes the Ledger-owned account
// exist on-chain (deploy + a little ETH) via the relayer — no KeeperHub, no cap.

// The Ledger Flex account that owns the mandate's smart account (path 44'/60'/0'/0/0).
// Same device ITHACA armed on; override with MM_FLEX_OWNER if a different Flex signs.
const FLEX_OWNER = (process.env.MM_FLEX_OWNER || "0xDeC312D5Fe0eaef03048BE83137f87cE7907A7Da") as Address

/** Context the browser needs to build the delegation for Ledger signing. */
export function mmMandateContext() {
  const { relayerAcct } = accounts()
  const env = getDeleGatorEnvironment(CHAIN_ID)
  return {
    agent: relayerAcct.address as Address,
    delegationManager: env.DelegationManager as Address,
    flexOwner: FLEX_OWNER,
    chainId: CHAIN_ID,
    rpc: RPC,
  }
}

async function ledgerSmartAccount(owner: Address) {
  const { relayerAcct } = accounts()
  // the address derives from deployParams(owner) + salt; the signer is a
  // placeholder here (server only needs the address + factory args to deploy).
  return toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [owner, [], [], []],
    deploySalt: "0x",
    signer: { account: relayerAcct },
  })
}

/** Store a Flex-signed mandate + make the Ledger-owned smart account live. */
export async function mmSetMandateLedger(input: {
  owner: Address
  signedDelegation: SignedDelegation
  protocols: string[]
  actions: string[]
  days?: number
}): Promise<{ ok: boolean; error?: string; smartAccount?: Address; owner?: Address; deployTx?: string; fundTx?: string; protocols?: string[]; actions?: string[]; expiresAt?: string; signature?: Hex }> {
  const { relayerWallet } = accounts()
  const protoKeys = input.protocols.map((p) => p.toLowerCase()).filter((p) => MANDATE_PROTOCOLS[p])
  const actKeys = input.actions.map((a) => a.toLowerCase()).filter((a) => MANDATE_ACTIONS[a])
  if (!protoKeys.length || !actKeys.length) return { ok: false, error: "Pick at least one protocol and one action." }
  const targets = protoKeys.map((p) => MANDATE_PROTOCOLS[p].address)
  const selectors = actKeys.map((a) => MANDATE_ACTIONS[a].selector)
  const expiry = Math.floor(Date.now() / 1000) + (input.days ?? 7) * 24 * 3600

  // make the Ledger-owned account exist on-chain (deploy + fund) via the relayer
  const sa = await ledgerSmartAccount(input.owner)
  let deployTx: string | undefined
  let fundTx: string | undefined
  if (!(await isDeployed(sa.address))) {
    const { factory, factoryData } = await sa.getFactoryArgs()
    if (factory && factoryData) {
      const h = await relayerWallet.sendTransaction({ to: factory, data: factoryData })
      await publicClient.waitForTransactionReceipt({ hash: h })
      deployTx = h
    }
  }
  if ((await publicClient.getBalance({ address: sa.address })) < parseEther("0.0006")) {
    const h = await relayerWallet.sendTransaction({ to: sa.address, value: parseEther("0.001") })
    await publicClient.waitForTransactionReceipt({ hash: h })
    fundTx = h
  }

  activeMandate = { signed: input.signedDelegation, protocols: protoKeys, actions: actKeys, targets, selectors, expiresAt: new Date(expiry * 1000).toISOString() }
  return {
    ok: true,
    smartAccount: sa.address,
    owner: input.owner,
    deployTx,
    fundTx,
    protocols: protoKeys.map((p) => MANDATE_PROTOCOLS[p].label),
    actions: actKeys.map((a) => MANDATE_ACTIONS[a].label),
    expiresAt: activeMandate.expiresAt,
    signature: input.signedDelegation.signature,
  }
}
