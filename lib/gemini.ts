/*
 * Gemini (Google AI) — SERVER ONLY. Keep GEMINI_API_KEY server-side. Jobs:
 *   1. parseIntent(text): natural-language command -> structured on-chain intent.
 *   2. parseVoice(audio): the SAME, but from a spoken audio clip (real Gemini
 *      multimodal — audio in). Push-to-talk records a clip, we send it here.
 *   3. mintLiveToken(): ephemeral token for a full-duplex Gemini Live session
 *      (native audio) if/when we move from push-to-talk to streaming voice.
 */

const KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest"
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-native-audio-latest"
const BASE = "https://generativelanguage.googleapis.com/v1beta"

// Transient "high demand" 503s happen on flash models; fail over rather than fail.
const MODEL_CANDIDATES = [MODEL, "gemini-3.6-flash", "gemini-2.5-flash", "gemini-flash-lite-latest"]

export type Intent = {
  action: "transfer" | "invest" | "rebalance" | "protect" | "sweep" | "query" | "unknown"
  amount?: number
  token?: string
  venue?: string
  chain?: string
  summary: string
}
export type VoiceIntent = Intent & { transcript: string }

const SYSTEM = `You are the intent parser for Parallax, a voice-controlled crypto wallet.
Parallax executes on-chain through KeeperHub, inside bounds a user signed once on a Ledger
(a per-move spend cap, allowlisted venues, an expiry). Convert the user's command into a
single structured intent. Rules:
- action: transfer (send tokens), invest (move into yield), rebalance (move between venues),
  protect (evacuate to safety on a depeg/risk), sweep (consolidate dust), query (read-only
  question), or unknown.
- amount: the numeric amount if stated, else omit.
- token: the asset symbol (e.g. USDC, ETH) if stated, else omit.
- venue: a named protocol if stated (e.g. Aave, Compound, Moonwell), else omit.
- summary: one short sentence, in the wallet's voice, of what it will do.
Output only the structured fields.`

const INTENT_PROPS = {
  action: { type: "STRING", enum: ["transfer", "invest", "rebalance", "protect", "sweep", "query", "unknown"] },
  amount: { type: "NUMBER" },
  token: { type: "STRING" },
  venue: { type: "STRING" },
  chain: { type: "STRING" },
  summary: { type: "STRING" },
}
const INTENT_SCHEMA = { type: "OBJECT", properties: INTENT_PROPS, required: ["action", "summary"] }
const VOICE_SCHEMA = {
  type: "OBJECT",
  properties: { transcript: { type: "STRING" }, ...INTENT_PROPS },
  required: ["transcript", "action", "summary"],
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

async function runModel<T>(parts: Part[], schema: unknown, systemText: string): Promise<{ ok: boolean; value?: T; error?: string; model?: string }> {
  if (!KEY) return { ok: false, error: "GEMINI_API_KEY not set" }
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
  })
  let lastErr = "no model available"
  const tried = new Set<string>()
  for (const model of MODEL_CANDIDATES) {
    if (tried.has(model)) continue
    tried.add(model)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${BASE}/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
          body,
          cache: "no-store",
        })
        const data = await res.json()
        if (!res.ok) {
          lastErr = data?.error?.message || `HTTP ${res.status}`
          const transient = res.status === 503 || res.status === 429 || /high demand|overloaded|unavailable/i.test(lastErr)
          if (transient && attempt === 0) { await new Promise((r) => setTimeout(r, 700)); continue }
          break
        }
        const out = data?.candidates?.[0]?.content?.parts?.[0]?.text
        if (!out) { lastErr = "no content"; break }
        return { ok: true, value: JSON.parse(out) as T, model }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
  }
  return { ok: false, error: lastErr }
}

export async function parseIntent(text: string) {
  const r = await runModel<Intent>([{ text }], INTENT_SCHEMA, SYSTEM)
  return { ok: r.ok, intent: r.value, error: r.error, model: r.model }
}

export async function parseVoice(audioBase64: string, mimeType: string) {
  const r = await runModel<VoiceIntent>(
    [
      { inlineData: { mimeType, data: audioBase64 } },
      { text: "Transcribe the spoken wallet command and extract its intent." },
    ],
    VOICE_SCHEMA,
    SYSTEM
  )
  return { ok: r.ok, intent: r.value, error: r.error, model: r.model }
}

// ---------------- KeeperHub tool router (function-calling) ----------------

const TYPE_MAP: Record<string, string> = {
  string: "STRING", number: "NUMBER", integer: "INTEGER", boolean: "BOOLEAN", array: "ARRAY", object: "OBJECT",
}

// JSON Schema (MCP) -> the OpenAPI subset Gemini functionDeclarations accept.
function sanitizeSchema(schema: unknown, depth = 0): any {
  if (!schema || typeof schema !== "object" || depth > 5) return { type: "OBJECT", properties: {} }
  const s = schema as Record<string, any>
  const rawType = Array.isArray(s.type) ? s.type[0] : s.type
  const type = TYPE_MAP[rawType] || (s.properties ? "OBJECT" : "STRING")
  const out: any = { type }
  if (typeof s.description === "string") out.description = s.description.slice(0, 200)
  if (Array.isArray(s.enum)) out.enum = s.enum.map(String)
  if (type === "OBJECT") {
    out.properties = {}
    const props = s.properties || {}
    for (const k of Object.keys(props)) out.properties[k] = sanitizeSchema(props[k], depth + 1)
    if (Array.isArray(s.required) && s.required.length) out.required = s.required.filter((r: string) => out.properties[r])
    if (!Object.keys(out.properties).length) delete out.required
  }
  if (type === "ARRAY") out.items = sanitizeSchema(s.items || { type: "string" }, depth + 1)
  return out
}

const ROUTER_SYSTEM = `You are Parallax's command router for KeeperHub. Given the user's command,
call the single most appropriate KeeperHub tool with correct arguments — Parallax can reach ANY
KeeperHub action this way. Defaults when the user doesn't specify:
- chain / chain_id / network: "11155111" (Sepolia)
- wallet integrationId: "k21rhqx8fw6o5tob49jds"; wallet address: "0x5623D4a6A316Cf9b16fF92808E3931E17CcB960C"
For a read/question, call the matching read tool (e.g. get_spending_limits, list_executions,
search_protocol_actions). Prefer execute_transfer / execute_contract_call / execute_protocol_action
for on-chain actions. Only if truly no tool fits, reply in plain text.`

export type Routed = { ok: boolean; name?: string; args?: Record<string, unknown>; text?: string; model?: string; error?: string }

export async function routeToKeeperHub(
  command: string,
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
): Promise<Routed> {
  if (!KEY) return { ok: false, error: "GEMINI_API_KEY not set" }
  const functionDeclarations = tools
    .filter((t) => !/DEPRECATED/i.test(t.description || ""))
    .map((t) => ({
      name: t.name,
      description: (t.description || "").slice(0, 200),
      parameters: sanitizeSchema(t.inputSchema),
    }))
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: ROUTER_SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: command }] }],
    tools: [{ functionDeclarations }],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0 },
  })
  let lastErr = "no model available"
  for (const model of MODEL_CANDIDATES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${BASE}/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
          body,
          cache: "no-store",
        })
        const data = await res.json()
        if (!res.ok) {
          lastErr = data?.error?.message || `HTTP ${res.status}`
          const transient = res.status === 503 || res.status === 429 || /high demand|overloaded|unavailable/i.test(lastErr)
          if (transient && attempt === 0) { await new Promise((r) => setTimeout(r, 700)); continue }
          break
        }
        const parts = data?.candidates?.[0]?.content?.parts ?? []
        const fc = parts.find((p: any) => p.functionCall)?.functionCall
        if (fc) return { ok: true, name: fc.name, args: (fc.args as Record<string, unknown>) || {}, model }
        const text = parts.find((p: any) => p.text)?.text
        return { ok: true, text: text || "I couldn't map that to a KeeperHub action.", model }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
  }
  return { ok: false, error: lastErr }
}

/** One-sentence, spoken-friendly summary of a KeeperHub tool result. */
export async function summarizeResult(command: string, tool: string, mode: string, payload: unknown): Promise<string | null> {
  if (!KEY) return null
  const prompt = `User command: "${command}"
KeeperHub tool run: ${tool} (${mode})
Result (JSON, truncated): ${JSON.stringify(payload ?? {}).slice(0, 1600)}

Reply in ONE short sentence, in Parallax's voice (a calm wallet assistant speaking to its owner).
State the concrete result — numbers, status, counts, or that it was a preview/simulation. No preamble, no markdown.`
  const reqBody = JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } })
  for (const model of MODEL_CANDIDATES.slice(0, 3)) {
    try {
      const res = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: reqBody,
        cache: "no-store",
      })
      const data = await res.json()
      if (!res.ok) continue // try next model on 503/high-demand etc.
      const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      if (out) return out
    } catch {
      /* try next */
    }
  }
  return null
}

/** Ephemeral token for a browser Gemini Live (native-audio) session. */
export async function mintLiveToken(): Promise<{ ok: boolean; token?: string; model: string; error?: string }> {
  if (!KEY) return { ok: false, model: LIVE_MODEL, error: "GEMINI_API_KEY not set" }
  try {
    const res = await fetch(`${BASE}/auth_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({ uses: 1 }),
      cache: "no-store",
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, model: LIVE_MODEL, error: data?.error?.message || `HTTP ${res.status}` }
    const token = data?.name || data?.token
    return { ok: !!token, token, model: LIVE_MODEL }
  } catch (e) {
    return { ok: false, model: LIVE_MODEL, error: e instanceof Error ? e.message : String(e) }
  }
}

export { LIVE_MODEL }
