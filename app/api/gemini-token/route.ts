import { GoogleGenAI, Modality, Type } from "@google/genai"

/*
 * Mints a short-lived ephemeral token so the browser can open a Gemini LIVE
 * session (native audio — the natural voice, not TTS) WITHOUT ever seeing
 * GEMINI_API_KEY. With ephemeral tokens the session config is LOCKED here via
 * liveConnectConstraints (client config is ignored), so the voice, the
 * system instruction, and the tools are all baked in server-side.
 *
 * The Live model gets ONE tool — run_keeperhub — which the browser routes to
 * /api/keeperhub/act (Gemini function-calls over the 44-tool KeeperHub catalog,
 * simulates + executes). So the voice can do literally anything on KeeperHub and
 * then speak the result back naturally.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Half-cascade Live model: uses a discrete STT that HONORS inputAudioTranscription
// languageCodes, so the transcript stays English. The native-audio model
// (gemini-2.5-flash-native-audio) ignores the hint and transliterates the
// owner's accent into other scripts (known Google limitation).
const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-live-2.5-flash-preview"

// A distinct Gemini prebuilt voice per clay character.
const VOICES: Record<string, string> = {
  tv: "Charon", // Guardian — deep, steady
  dog: "Puck", // Biscuit — upbeat
  bungirl: "Aoede", // Juno — breezy
  ginger: "Kore", // Ginger — firm
  alien: "Zephyr", // Nova — bright
}

const SYSTEM = `You are Parallax, a calm, warm voice-controlled crypto wallet on the Sepolia testnet.
You execute on-chain through KeeperHub within Ledger-signed bounds (a per-move cap, allowlisted
venues, an expiry). The daily execution cap is 0.02 ETH. The network is always Sepolia.

ALWAYS operate in English (US). The owner speaks English — understand their speech as English, show
the transcript in English using the Latin alphabet, and always reply in English. Never use any other
language or any non-Latin script.

WHEN THE SESSION OPENS, introduce yourself in two short spoken lines, warm and confident:
"I'm Parallax — the world's first agentic AI that can handle your funds entirely by voice. I have
access to 47 protocols through KeeperHub, which is my execution layer — so you can swap, bridge, send,
and autonomously invest, all with one-shot commands." Then invite them to speak an intent.

Answer questions and carry out commands by CALLING TOOLS — never say you lack access to their
finances; call the matching tool and read the live result. Prefer the SPECIFIC tools:
 - get_balances — "what do I hold", "my portfolio", "how much is my wallet worth"
 - get_price — "what's ETH at", "price of bitcoin"
 - get_spending_limits — "how much can I spend today"
 - list_executions — "recent activity", "what have you done"
 - execute_transfer — "send X ETH to …"
 - swap_tokens — "swap X ETH for USDC", "trade …"
 - bridge_tokens — "bridge 0.01 to Base", "move … cross-chain". ONE STEP: never tell the owner to wrap or swap first, and don't ask which token — just call bridge_tokens with the amount + destination and it does the whole thing.
 - invest_yield — "invest 50 USDC", "put my funds to work", "earn yield", "make my money work": supplies USDC into Aave V3 (a REAL deposit) and arms an autonomous rotation workflow. In your reply, say the APY it's earning and that you'll keep monitoring yields and rotate to the best market automatically.
 - build_workflow (then execute_workflow) — when the owner wants "a workflow that…" or any scheduled automation
 - search_protocol_actions — to discover DeFi actions; get_wallet_integration — wallet details
Use run_keeperhub ONLY for something none of those cover. AFTER ANY TRANSACTION, say in one natural
sentence: that you executed it through the smart router with as little gas as possible; the actual gas cost
from the result (the result includes a gas figure in ETH and USD — ALWAYS state it); and that you're
opening the transaction — and the KeeperHub workflow too whenever the action created one (like an
autonomous invest). For reads (balances, prices, limits) just give the real numbers in one short sentence.
Keep every reply brief, warm, and conversational.`

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return Response.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 })
  try {
    const body = await req.json().catch(() => ({}))
    const character = String((body as { character?: string })?.character || "tv")
    const voiceName = VOICES[character] || VOICES.tv

    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } })
    const now = Date.now()
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            // Force English transcription — an empty config auto-detects and can
            // transliterate an accented English speaker into a non-Latin script.
            inputAudioTranscription: { languageCodes: ["en-US"] },
            outputAudioTranscription: { languageCodes: ["en-US"] },
            speechConfig: { languageCode: "en-US", voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            // Push-to-talk uses AUTOMATIC VAD plus mic gating on the client: audio
            // is streamed only while the key or button is held, and the client sends
            // audioStreamEnd on release. This is reliable across Live models. Manual
            // VAD (activityStart/activityEnd) is not honored by the half-cascade model.
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "get_spending_limits",
                    description: "Read the daily on-chain spending cap and how much is used/remaining today.",
                    parameters: { type: Type.OBJECT, properties: {} },
                  },
                  {
                    name: "list_executions",
                    description: "List the wallet's recent executions (transfers and workflow runs) with status.",
                    parameters: { type: Type.OBJECT, properties: {} },
                  },
                  {
                    name: "get_balances",
                    description: "Read the owner's REAL portfolio across chains: native + ERC20 balances, priced live, with a USD total. Omit chain for the whole multichain portfolio, or pass a chain for one. Use for 'what do I hold', 'my balance', 'portfolio value'.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: { chain: { type: Type.STRING, description: "optional chain name, e.g. 'Base', 'Arbitrum', 'Sepolia'" } },
                    },
                  },
                  {
                    name: "get_price",
                    description: "Get a live USD price from a Chainlink oracle. Use for 'what's ETH at', 'price of bitcoin'.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: { symbol: { type: Type.STRING, description: "asset symbol, e.g. 'ETH', 'BTC', 'LINK'" } },
                      required: ["symbol"],
                    },
                  },
                  {
                    name: "swap_tokens",
                    description: "Swap tokens on Uniswap V3, on any supported chain. Broadcasts a real swap within a safety cap and returns a transaction link the app opens automatically. Use for 'swap 0.01 ETH for USDC' or 'swap on Base'.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        fromToken: { type: Type.STRING, description: "token to sell, e.g. 'ETH', 'USDC'" },
                        toToken: { type: Type.STRING, description: "token to buy" },
                        amount: { type: Type.STRING, description: "amount of fromToken, e.g. '0.01'" },
                        chain: { type: Type.STRING, description: "optional chain to swap on, e.g. 'Base', 'Arbitrum', 'Ethereum' (default Sepolia)" },
                      },
                      required: ["fromToken", "toToken", "amount"],
                    },
                  },
                  {
                    name: "bridge_tokens",
                    description: "Bridge cross-chain in ONE STEP via Chainlink CCIP (from Sepolia to Base, Arbitrum, or Optimism). It handles the cross-chain transport token itself — you do NOT need to wrap or swap first, and you do NOT need to name a token. Just pass the amount and destination; it broadcasts a real transaction and returns a link. Use for 'bridge 0.01 to Base'. Never tell the owner to wrap or swap before bridging.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        amount: { type: Type.STRING, description: "amount to bridge, e.g. '0.01'" },
                        toChain: { type: Type.STRING, description: "destination chain: Base, Arbitrum, or Optimism" },
                        token: { type: Type.STRING, description: "optional; ignored — the bridge picks the transport token itself" },
                      },
                      required: ["amount", "toChain"],
                    },
                  },
                  {
                    name: "drip_ccip_bnm",
                    description: "Fund the wallet with CCIP-BnM test tokens (Chainlink faucet) so a real cross-chain bridge can broadcast on a testnet. Use before bridging on testnet if the bridge says it needs the token.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: { chain: { type: Type.STRING, description: "chain to drip on (default Sepolia)" } },
                    },
                  },
                  {
                    name: "wrap_eth",
                    description: "Wrap native ETH into WETH via the WETH protocol contract — a real on-chain protocol interaction. Returns a transaction link the app opens. Use for 'wrap 0.01 ETH' or 'convert ETH to WETH'.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        amount: { type: Type.STRING, description: "amount of ETH to wrap, e.g. '0.01'" },
                        chain: { type: Type.STRING, description: "optional chain (default Sepolia)" },
                      },
                    },
                  },
                  {
                    name: "invest_yield",
                    description: "Invest idle USDC into a REAL yield position by supplying it to Aave V3 on Sepolia (earns interest), then arm an autonomous KeeperHub workflow that monitors yields across venues and rotates the funds to the best market. Broadcasts a real deposit and returns a transaction link the app opens. Use for 'invest 50 USDC', 'put my funds to work', 'earn yield', 'make my money work', 'invest and keep the yield good'.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        amount: { type: Type.STRING, description: "amount of USDC to invest, e.g. '50'" },
                      },
                    },
                  },
                  {
                    name: "agent_pay",
                    description: "Act through the MetaMask delegation: the agent redeems its owner-signed, scoped delegation on-chain to send ETH from the MetaMask Smart Account, strictly within the signed cap + allowlist. Returns a transaction link the app opens. Use for 'pay from my delegation' or 'have the agent send X'.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        amount: { type: Type.STRING, description: "amount of ETH to send, e.g. '0.0005'" },
                        to: { type: Type.STRING, description: "recipient 0x address (optional; defaults to the treasury)" },
                      },
                    },
                  },
                  {
                    name: "delegation_status",
                    description: "Report the MetaMask Smart Account: its address, whether it's deployed on Sepolia, and its balance. Use for 'what's my smart account' or 'is my delegation set up'.",
                    parameters: { type: Type.OBJECT, properties: {} },
                  },
                  {
                    name: "search_protocol_actions",
                    description: "Search available DeFi protocol actions (e.g. Aave supply) the owner could use to earn yield.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: { query: { type: Type.STRING, description: "what to search for, e.g. 'aave usdc supply'" } },
                      required: ["query"],
                    },
                  },
                  {
                    name: "get_wallet_integration",
                    description: "Get the wallet address and integration details.",
                    parameters: { type: Type.OBJECT, properties: {} },
                  },
                  {
                    name: "execute_transfer",
                    description: "Send native ETH on Sepolia. Simulates then broadcasts within the cap. Returns a tx hash.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        to_address: { type: Type.STRING, description: "recipient 0x address (optional; defaults to the wallet itself)" },
                        amount: { type: Type.STRING, description: "amount in ETH, e.g. '0.001'" },
                      },
                      required: ["amount"],
                    },
                  },
                  {
                    name: "build_workflow",
                    description: "BUILD a real KeeperHub workflow from a natural-language description (e.g. 'every Monday sweep dust into Base USDC', 'if USDC depegs move to safety'). Creates it and returns its id. Use whenever the owner wants to set up an automation or 'a workflow that…'.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        description: { type: Type.STRING, description: "what the workflow should do, in plain language" },
                        enable: { type: Type.BOOLEAN, description: "true to arm schedule/event/block triggers immediately" },
                      },
                      required: ["description"],
                    },
                  },
                  {
                    name: "execute_workflow",
                    description: "Run a KeeperHub workflow by its id (e.g. one you just built).",
                    parameters: {
                      type: Type.OBJECT,
                      properties: { workflowId: { type: Type.STRING } },
                      required: ["workflowId"],
                    },
                  },
                  {
                    name: "run_keeperhub",
                    description: "Catch-all: run ANY other KeeperHub action from a natural-language command. Use ONLY when no specific tool above fits. Reads use execute=false.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        command: { type: Type.STRING, description: "the owner's intent in plain language" },
                        execute: { type: Type.BOOLEAN, description: "true to broadcast an on-chain action; false for reads" },
                      },
                      required: ["command"],
                    },
                  },
                ],
              },
            ],
            systemInstruction: SYSTEM,
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    })
    return Response.json({ token: token.name, model: MODEL, voice: voiceName })
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
