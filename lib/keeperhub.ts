/*
 * KeeperHub MCP client — SERVER ONLY. Never import this into a client component;
 * it carries the kh_ key which can move real funds. It speaks MCP JSON-RPC over
 * Streamable HTTP to app.keeperhub.com/mcp: initialize (grab the session id from
 * the response header) -> notifications/initialized -> tools/call.
 *
 * Tool results arrive as { content: [{ type:"text", text }] } where `text` is
 * usually a JSON string; callTool parses that into `data` for you.
 */

const BASE = process.env.KEEPERHUB_MCP_URL || "https://app.keeperhub.com/mcp"
const KEY = process.env.KEEPERHUB_API_KEY

// Sepolia is where the KeeperHub integration wallet is funded (~1 ETH) with a
// 0.02 ETH/day execution cap. See .env.local.
export const SEPOLIA = "11155111"
export const KH_INTEGRATION_ID =
  process.env.KEEPERHUB_INTEGRATION_ID || "k21rhqx8fw6o5tob49jds"
export const KH_WALLET =
  process.env.KEEPERHUB_WALLET || "0x5623D4a6A316Cf9b16fF92808E3931E17CcB960C"

export type ToolResult = {
  raw: unknown
  text?: string
  data?: unknown
  isError: boolean
}

export class KeeperHubError extends Error {}

export class KeeperHubClient {
  private sessionId?: string
  private id = 0

  constructor(private key: string | undefined = KEY, private base = BASE) {
    if (!this.key) throw new KeeperHubError("KEEPERHUB_API_KEY is not set")
  }

  private async post(body: unknown): Promise<string> {
    // retry transient network failures ("fetch failed" from undici) so a single
    // blip reaching KeeperHub doesn't bubble up to the user
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(this.base, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
          },
          body: JSON.stringify(body),
          cache: "no-store",
        })
        const sid = res.headers.get("mcp-session-id")
        if (sid) this.sessionId = sid
        return res.text()
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
    }
    throw lastErr
  }

  // Handles both plain JSON and SSE ("event:/data:") framing.
  private parse(text: string): { result?: any; error?: any } {
    const t = text.trim()
    if (!t) return {}
    if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t)
    const data = t
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("")
    return data ? JSON.parse(data) : {}
  }

  async init(): Promise<this> {
    const text = await this.post({
      jsonrpc: "2.0",
      id: ++this.id,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "lumen", version: "0.1" },
      },
    })
    this.parse(text)
    if (!this.sessionId) throw new KeeperHubError("KeeperHub returned no session id")
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" })
    return this
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    opts: { retryColdStart?: boolean } = {},
  ): Promise<ToolResult> {
    if (!this.sessionId) await this.init()
    const retryColdStart = opts.retryColdStart !== false
    // some tools (e.g. ai_generate_workflow) cold-start; retry a couple times.
    // callers that have a fast fallback pass retryColdStart:false to bail out now
    // instead of eating ~24s of warm-up waits (keeps voice snappy in the demo).
    for (let attempt = 0; ; attempt++) {
      const text = await this.post({
        jsonrpc: "2.0",
        id: ++this.id,
        method: "tools/call",
        params: { name, arguments: args },
      })
      const json = this.parse(text)
      if (json.error) throw new KeeperHubError(`${name}: ${json.error.message || "MCP error"}`)
      const content: Array<{ type: string; text?: string }> = json.result?.content ?? []
      const textPart = content.find((c) => c.type === "text")?.text
      let data: unknown = undefined
      if (textPart) {
        try {
          data = JSON.parse(textPart)
        } catch {
          data = textPart
        }
      }
      const isError = !!json.result?.isError
      const coldStart = isError && typeof textPart === "string" && /upstream_cold_start/.test(textPart)
      if (coldStart && retryColdStart && attempt < 3) {
        const m = /retryAfterSeconds"?:\s*(\d+)/.exec(textPart || "")
        const wait = Math.min(m ? Number(m[1]) * 1000 : 6000, 8000)
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      return { raw: json.result, text: textPart, data, isError }
    }
  }

  /** The full live tool catalog (name, description, JSON-Schema inputSchema). */
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    if (!this.sessionId) await this.init()
    const text = await this.post({ jsonrpc: "2.0", id: ++this.id, method: "tools/list", params: {} })
    const json = this.parse(text)
    return (json.result?.tools as Array<{ name: string; description?: string; inputSchema?: unknown }>) ?? []
  }

  /** Poll get_direct_execution_status until a tx hash lands or we time out. */
  async pollDirect(executionId: string, tries = 20, delayMs = 2000): Promise<ToolResult> {
    let last: ToolResult | undefined
    for (let i = 0; i < tries; i++) {
      last = await this.callTool("get_direct_execution_status", { execution_id: executionId })
      const d = last.data as Record<string, unknown> | undefined
      const hash = d && (d.transactionHash || d.txHash || d.hash)
      const status = d && (d.status as string)
      if (hash || status === "failed" || status === "reverted") return last
      await new Promise((r) => setTimeout(r, delayMs))
    }
    return last as ToolResult
  }
}

/** Convenience: an initialized client. */
export async function keeperhub(): Promise<KeeperHubClient> {
  return new KeeperHubClient().init()
}

/** Pull a tx hash out of whatever shape a direct-execution result has. */
export function txHashOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined
  const d = data as Record<string, unknown>
  const h = d.transactionHash || d.txHash || d.hash || d.transaction_hash
  return typeof h === "string" ? h : undefined
}

/** Pull an execution id out of a direct-execution result. */
export function executionIdOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined
  const d = data as Record<string, unknown>
  const id = d.executionId || d.execution_id || d.id
  return typeof id === "string" ? id : undefined
}
