"use client"

/*
 * Sign a mandate on a real Ledger Flex — BROWSER ONLY, using the Ledger Device
 * Management Kit: device-management-kit +
 * device-transport-kit-web-hid + device-signer-kit-ethereum. A hardware wallet
 * is reachable only from the browser (WebHID over USB-C), never a server.
 *
 * Flow: discover the Flex → connect → build SignerEth → the client builds the
 * MetaMask smart account (owned by the Flex address) + the functionCall-scoped
 * delegation → SignerEth.signTypedData shows the mandate on the Flex and the
 * user taps to approve → the signed delegation is posted to /api/mandate.
 *
 * Everything loads dynamically so these browser-only SDKs never run on the
 * server. Requires Chrome/Edge (WebHID) with the Flex unlocked + Ethereum app open.
 */

export type LedgerCatalog = {
  protocols: { id: string; address: string }[]
  actions: { id: string; selector: string }[]
}
export type LedgerContext = { agent: string; delegationManager: string; flexOwner: string; chainId: number; rpc: string }

const PATH = "44'/60'/0'/0/0" // first Ethereum account on the Flex

function errStr(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === "object") { try { return JSON.stringify(e) } catch { return String(e) } }
  return String(e)
}

export async function signMandateWithLedger(opts: {
  protocols: string[]
  actions: string[]
  catalog: LedgerCatalog
  context: LedgerContext
  days?: number
  onStatus?: (s: string) => void
}): Promise<{ owner: string; signedDelegation: unknown }> {
  const say = opts.onStatus || (() => {})
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { hid?: unknown }) : undefined
  if (!nav?.hid) throw new Error("This browser has no WebHID. Use desktop Chrome or Edge on http://localhost.")

  // Browser-only SDKs — load at click so they never touch SSR/build.
  const [dmkKit, transportKit, signerKit, viem, viemAccounts, viemChains, dtk, dtkUtils] = await Promise.all([
    import("@ledgerhq/device-management-kit"),
    import("@ledgerhq/device-transport-kit-web-hid"),
    import("@ledgerhq/device-signer-kit-ethereum"),
    import("viem"),
    import("viem/accounts"),
    import("viem/chains"),
    import("@metamask/delegation-toolkit"),
    import("@metamask/delegation-toolkit/utils"),
  ])
  const { DeviceManagementKitBuilder, DeviceActionStatus } = dmkKit
  const { webHidTransportFactory } = transportKit
  const { SignerEthBuilder } = signerKit
  const { createPublicClient, http, getAddress } = viem
  const { toAccount } = viemAccounts
  const { sepolia } = viemChains
  const { toMetaMaskSmartAccount, Implementation, createDelegation, getDeleGatorEnvironment } = dtk
  const { createCaveatBuilder } = dtkUtils

  say("Connecting to your Flex…")
  const dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build()
  const device = await new Promise<unknown>((resolve, reject) => {
    const sub = dmk.startDiscovering({}).subscribe({
      next: (d: unknown) => { sub.unsubscribe(); resolve(d) },
      error: reject,
    })
    setTimeout(() => { try { sub.unsubscribe() } catch {} reject(new Error("No Flex found — connect it by USB, unlock it, and open the Ethereum app.")) }, 30000)
  })
  const sessionId = await dmk.connect({ device: device as never })
  const signerEth = new SignerEthBuilder({ dmk, sessionId }).build()

  // Run a DMK device action and resolve its output when Completed.
  const runAction = <T,>(observable: { subscribe: (o: { next: (s: { status: unknown; output?: T; error?: unknown }) => void; error: (e: unknown) => void }) => void }) =>
    new Promise<T>((resolve, reject) => {
      observable.subscribe({
        next: (st) => {
          if (st.status === DeviceActionStatus.Completed && st.output !== undefined) resolve(st.output as T)
          else if (st.status === DeviceActionStatus.Error) reject(new Error("Ledger action error: " + errStr(st.error)))
        },
        error: (e) => reject(new Error("Ledger stream error: " + errStr(e))),
      })
    })

  const owner = getAddress(opts.context.flexOwner) as `0x${string}`

  // A viem account whose EIP-712 signing routes to the Flex (via the DMK).
  const ledgerAccount = toAccount({
    address: owner,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTypedData(typed: any): Promise<`0x${string}`> {
      say("Review + approve the mandate on your Flex…")
      // the DMK signer wants full EIP-712 incl. EIP712Domain in types
      const domainFields: { name: string; type: string }[] = []
      if (typed.domain?.name != null) domainFields.push({ name: "name", type: "string" })
      if (typed.domain?.version != null) domainFields.push({ name: "version", type: "string" })
      if (typed.domain?.chainId != null) domainFields.push({ name: "chainId", type: "uint256" })
      if (typed.domain?.verifyingContract != null) domainFields.push({ name: "verifyingContract", type: "address" })
      if (typed.domain?.salt != null) domainFields.push({ name: "salt", type: "bytes32" })
      const td = { domain: typed.domain, types: { EIP712Domain: domainFields, ...typed.types }, primaryType: typed.primaryType, message: typed.message }
      const out = await runAction<{ r: string; s: string; v: number }>(signerEth.signTypedData(PATH, td as never).observable)
      if (!out || out.r == null || out.s == null) throw new Error("Unexpected Ledger output: " + errStr(out))
      const r = (out.r.startsWith("0x") ? out.r : "0x" + out.r).slice(2)
      const s = (out.s.startsWith("0x") ? out.s : "0x" + out.s).slice(2)
      const v = (Number(out.v) < 27 ? Number(out.v) + 27 : Number(out.v)).toString(16).padStart(2, "0")
      return `0x${r}${s}${v}` as `0x${string}`
    },
    async signMessage() { throw new Error("Message signing isn't used for mandates.") },
    async signTransaction() { throw new Error("Transaction signing isn't used for mandates.") },
  })

  say("Building the mandate…")
  const publicClient = createPublicClient({ chain: sepolia, transport: http(opts.context.rpc) })
  const sa = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [owner, [], [], []],
    deploySalt: "0x",
    signer: { account: ledgerAccount },
  })
  const env = getDeleGatorEnvironment(opts.context.chainId)
  const targets = opts.protocols.map((p) => opts.catalog.protocols.find((x) => x.id === p)?.address).filter((a): a is string => !!a)
  const selectors = opts.actions.map((a) => opts.catalog.actions.find((x) => x.id === a)?.selector).filter((s): s is string => !!s)
  const expiry = Math.floor(Date.now() / 1000) + (opts.days ?? 7) * 24 * 3600
  const caveats = createCaveatBuilder(env).addCaveat("timestamp", { afterThreshold: 0, beforeThreshold: expiry }).build()

  const delegation = createDelegation({
    environment: env,
    from: sa.address,
    to: opts.context.agent as `0x${string}`,
    scope: { type: "functionCall", targets, selectors } as never,
    caveats,
  })

  const signature = await sa.signDelegation({ delegation })
  say("Signed on your Ledger Flex ✓")
  try { await dmk.disconnect({ sessionId }) } catch { /* device gone */ }
  return { owner, signedDelegation: { ...delegation, signature } }
}
