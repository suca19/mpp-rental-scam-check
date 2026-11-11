// Built-in DEMO AGENT (added 10 Nov) — lets the dashboard show a REAL paid check, step by step.
// The browser never holds a key: it sends the listing to POST /api/agent-check, and this module
// acts as the agent on the server. It uses the testnet payer wallet from ../.env.payer and pays
// our own POST /check (or /check/basic) through the normal MPP flow (402 → sign → retry → 200 +
// receipt), exactly like demo/client.ts. Testnet only: the client refuses any chain but 42431.
//
// MPP inspector: the mppx client's fetch is wrapped by a RECORDER, so the dashboard can show the
// real HTTP exchanges: the 402 + WWW-Authenticate challenge, the retry with Authorization: Payment,
// and the 200 + Payment-Receipt. Long values are shortened; the agent's private key is never
// in any of them (the credential holds a signed payment, which the server broadcasts publicly).
import { config } from 'dotenv'
import { Receipt } from 'mppx'
import { Mppx, tempo } from 'mppx/client'
import { resolve } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { ROOT } from './paths.js'

const TEMPO_TESTNET = 42431
const EXPLORER_TX = 'https://explore.testnet.tempo.xyz/tx/'
const TOKEN_DECIMALS = 6 // Tempo test stablecoins (amount "10000" = 0.01)
const TOKEN_NAMES: Record<string, string> = {
  '0x20c0000000000000000000006a37da5c996874be': 'OUSD',
  '0x20c0000000000000000000000000000000000000': 'pathUSD',
}

// ── Recorder: every HTTP exchange the mppx client makes during one run ────────────────────────
export type Exchange = {
  n: number
  method: string
  path: string
  status: number
  ms: number
  request_headers: Record<string, string>
  response_headers: Record<string, string>
  decoded: Record<string, unknown>
}
let recording: Exchange[] | null = null
let recordStart = 0

const shorten = (s: string, keep = 28) => (s.length > keep * 2 + 1 ? `${s.slice(0, keep)}…${s.slice(-10)}` : s)

/** Shortens long strings inside a decoded object so it fits on screen. */
function summarize(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 66 ? `${v.slice(0, 26)}…${v.slice(-10)}` : v
  if (Array.isArray(v)) return depth > 6 ? `[${v.length} items]` : v.slice(0, 5).map((x) => summarize(x, depth + 1))
  if (v && typeof v === 'object') {
    if (depth > 6) return '{…}'
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, summarize(x, depth + 1)]))
  }
  return v
}

/** Tries to decode a base64url JSON blob (MPP challenge request, credential, receipt). */
function decodeB64Json(s: string | undefined): unknown {
  if (!s) return undefined
  try {
    return JSON.parse(Buffer.from(s.trim(), 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
}

/** Parses `Payment id="…", realm="…", method="tempo", intent="charge", request="<b64>"` into fields. */
function parseAuthParams(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of header.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

const recordingFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init)
  const res = await fetch(req)
  if (recording) {
    const decoded: Record<string, unknown> = {}
    const request_headers: Record<string, string> = {}
    const response_headers: Record<string, string> = {}

    const auth = req.headers.get('authorization')
    if (auth) {
      request_headers['Authorization'] = shorten(auth)
      const cred = decodeB64Json(auth.replace(/^Payment\s+/i, ''))
      if (cred) decoded.credential = summarize(cred)
    }
    const www = res.headers.get('www-authenticate')
    if (www) {
      response_headers['WWW-Authenticate'] = shorten(www, 60)
      // One header can carry SEVERAL offers ("Payment …, Payment …"), e.g. OUSD and pathUSD.
      const offers = www.split(/,\s*(?=Payment\s)/i).map((part) => {
        const p = parseAuthParams(part)
        return { id: p.id, realm: p.realm, method: p.method, intent: p.intent, description: p.description, request: decodeB64Json(p.request) }
      })
      decoded.challenge = summarize({ offers })
    }
    const receipt = res.headers.get('payment-receipt')
    if (receipt) {
      response_headers['Payment-Receipt'] = shorten(receipt)
      const r = decodeB64Json(receipt)
      if (r) decoded.receipt = summarize(r)
    }
    recording.push({
      n: recording.length + 1,
      method: req.method,
      path: new URL(req.url).pathname,
      status: res.status,
      ms: Date.now() - recordStart,
      request_headers,
      response_headers,
      decoded,
    })
  }
  return res
}

// Load the payer key into a private object (not process.env) so nothing else can read it by accident.
const payerEnv: Record<string, string> = {}
config({ path: resolve(ROOT, '.env.payer'), processEnv: payerEnv, quiet: true })
// On the public host there is no .env.payer: a SEPARATE testnet-only demo wallet comes from the
// DEMO_PAYER_KEY variable (added 11 Nov). It is removed from process.env right away so nothing else can read it.
const demoKey = process.env.DEMO_PAYER_KEY?.trim()
delete process.env.DEMO_PAYER_KEY
const rawKey = demoKey || payerEnv.MPPX_PRIVATE_KEY
const key = (rawKey && /^0x[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : undefined) as `0x${string}` | undefined
const account = key ? privateKeyToAccount(key) : null
const client = account
  ? Mppx.create({
      polyfill: false,
      fetch: recordingFetch,
      methods: [tempo({ account, expectedChainId: TEMPO_TESTNET })],
    })
  : null

export const agentAvailable = () => client !== null
export const agentAddress = () => account?.address ?? null

export type AgentStep = { step: string; detail: string; ms: number }

export type AgentRun = {
  ok: boolean
  steps: AgentStep[]
  exchanges: Exchange[]
  result?: unknown
  error?: string
  payment?: {
    amount: string
    token: string
    chain_id: number | null
    from: string
    to: string
    receipt_status: string
    receipt_method: string
    tx_hash: string
    explorer_url: string | null
    timestamp: string
  }
}

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a)

/** Price, token, recipient and chain from a decoded challenge `request`. */
function priceFrom(req: unknown) {
  const r = (req ?? {}) as { amount?: string; currency?: string; recipient?: string; methodDetails?: { chainId?: number } }
  const units = Number(r.amount ?? NaN)
  return {
    amount: Number.isFinite(units) ? String(units / 10 ** TOKEN_DECIMALS) : String(r.amount ?? '?'),
    token: TOKEN_NAMES[(r.currency ?? '').toLowerCase()] ?? short(r.currency ?? '?'),
    recipient: r.recipient ?? '?',
    chainId: r.methodDetails?.chainId ?? null,
  }
}

/** Runs one real paid check against our own /check (or /check/basic) and records every step. */
export async function payAndCheck(checkUrl: string, listingJson: string, extraHeaders: Record<string, string> = {}): Promise<AgentRun> {
  const steps: AgentStep[] = []
  const exchanges: Exchange[] = []
  if (!client || !account) return { ok: false, steps, exchanges, error: 'Demo agent has no wallet (.env.payer missing)' }

  recording = exchanges
  recordStart = Date.now()
  let res: Response
  let text: string
  try {
    res = await client.fetch(checkUrl, {
      method: 'POST',
      headers: { ...extraHeaders, 'content-type': 'application/json', accept: 'application/json' },
      body: listingJson,
    })
    text = await res.text()
  } catch (err) {
    recording = null
    return { ok: false, steps, exchanges, error: `Request failed: ${(err as Error).message}` }
  }
  recording = null

  const path = new URL(checkUrl).pathname
  const first = exchanges[0]
  const challengeEx = exchanges.find((e) => e.status === 402)
  const paidEx = exchanges.find((e) => e.request_headers['Authorization'])
  // The offer the agent actually chose = the one whose id is echoed inside its credential.
  type Offer = { id?: string; request?: unknown; chosen?: boolean }
  const offers = ((challengeEx?.decoded.challenge as { offers?: Offer[] } | undefined)?.offers ?? []) as Offer[]
  const chosenId = (paidEx?.decoded.credential as { challenge?: { id?: string } } | undefined)?.challenge?.id
  for (const o of offers) o.chosen = !!chosenId && o.id === chosenId
  const chosen = offers.find((o) => o.chosen) ?? offers[0]
  // summarize() only shortens long strings; amounts, token addresses and recipients stay intact.
  const price = priceFrom(chosen?.request)

  if (first) steps.push({ step: 'request', detail: `Agent ${short(account.address)} sends POST ${path} with your listing`, ms: first.ms })
  if (challengeEx)
    steps.push({
      step: 'challenge',
      detail: `402 Payment Required — pay ${price.amount} ${price.token} to ${short(price.recipient)} on chain ${price.chainId}`,
      ms: challengeEx.ms,
    })
  if (paidEx)
    steps.push({
      step: 'sign',
      detail: `Agent signs a ${price.amount} ${price.token} transfer with its own key and retries with Authorization: Payment …`,
      ms: paidEx.ms,
    })
  if (!res.ok) return { ok: false, steps, exchanges, error: `Paid request failed: HTTP ${res.status} ${text.slice(0, 200)}` }

  let receipt: Receipt.Receipt | undefined
  try {
    receipt = Receipt.fromResponse(res)
  } catch {
    receipt = undefined
  }
  const txHash = receipt?.reference ?? ''
  const isTx = /^0x[0-9a-fA-F]{64}$/.test(txHash)
  steps.push({
    step: 'receipt',
    detail: `200 OK + Payment-Receipt (${receipt?.status ?? 'no receipt'}) — transaction ${isTx ? short(txHash) : 'n/a'}`,
    ms: paidEx?.ms ?? Date.now() - recordStart,
  })

  return {
    ok: true,
    steps,
    exchanges,
    result: JSON.parse(text),
    payment: {
      amount: price.amount,
      token: price.token,
      chain_id: price.chainId,
      from: account.address,
      to: price.recipient,
      receipt_status: receipt?.status ?? 'unknown',
      receipt_method: receipt?.method ?? 'tempo',
      tx_hash: txHash,
      explorer_url: isTx ? `${EXPLORER_TX}${txHash}` : null,
      timestamp: receipt?.timestamp ?? new Date().toISOString(),
    },
  }
}
