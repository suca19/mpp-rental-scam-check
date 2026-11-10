// MCP server (stdio) for Rental Scam Check — added 10 Nov 2026.
//
// Gives an AI agent such as Claude Code ONE tool, `check_rental_listing`. The tool carries the
// agent's testnet wallet: when the agent calls it, the tool calls the paid Rental Scam Check API,
// gets the HTTP 402 price tag, pays it via MPP (mppx client, Tempo testnet), and returns the risk
// result together with the payment receipt and an explorer link. The agent decides to call the
// tool; the tool pays. No key ever goes to the model: it stays in ../.env.payer, read here only.
//
// Safety: testnet only (the client refuses any chain but 42431), at most MAX_PAID_CALLS paid calls
// per server run, the API URL must be localhost unless RSC_ALLOW_REMOTE=1.
// IMPORTANT: stdout is the MCP protocol channel. Log ONLY with console.error.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Receipt } from 'mppx'
import { Mppx, tempo } from 'mppx/client'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const HERE = dirname(fileURLToPath(import.meta.url))
const API = (process.env.RSC_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const TEMPO_TESTNET = 42431
const MAX_PAID_CALLS = Number(process.env.RSC_MAX_PAID_CALLS ?? 25)
const EXPLORER_TX = 'https://explore.testnet.tempo.xyz/tx/'
const TOKEN_NAMES: Record<string, string> = {
  '0x20c0000000000000000000006a37da5c996874be': 'OUSD',
  '0x20c0000000000000000000000000000000000000': 'pathUSD',
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API) && process.env.RSC_ALLOW_REMOTE !== '1') {
  console.error(`[mcp] refusing non-local API URL ${API} (set RSC_ALLOW_REMOTE=1 to allow)`)
  process.exit(1)
}

// ── Wallet: read MPPX_PRIVATE_KEY from ../.env.payer without printing it ─────────────────────────
function readPayerKey(): `0x${string}` | null {
  try {
    const text = readFileSync(resolve(HERE, '..', '.env.payer'), 'utf8')
    const m = text.match(/^MPPX_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)
    return m ? (m[1] as `0x${string}`) : null
  } catch {
    return null
  }
}
const key = process.env.MPPX_PRIVATE_KEY ?? readPayerKey()
if (!key) {
  console.error('[mcp] no payer wallet: put MPPX_PRIVATE_KEY in ../.env.payer')
  process.exit(1)
}
const account = privateKeyToAccount(key as `0x${string}`)

// ── Record the 402 challenge so we can tell the agent exactly what it paid ───────────────────────
let lastChallenge: { amount: string; token: string; recipient: string; chainId: number | null } | null = null
const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  if (res.status === 402) {
    const www = res.headers.get('www-authenticate') ?? ''
    const first = www.split(/,\s*(?=Payment\s)/i)[0] ?? ''
    const reqB64 = first.match(/request="([^"]+)"/)?.[1]
    try {
      const r = JSON.parse(Buffer.from(reqB64 ?? '', 'base64url').toString('utf8')) as {
        amount?: string
        currency?: string
        recipient?: string
        methodDetails?: { chainId?: number }
      }
      lastChallenge = {
        amount: String(Number(r.amount) / 1e6),
        token: TOKEN_NAMES[(r.currency ?? '').toLowerCase()] ?? r.currency ?? '?',
        recipient: r.recipient ?? '?',
        chainId: r.methodDetails?.chainId ?? null,
      }
    } catch {
      lastChallenge = null
    }
  }
  return res
}

const mppx = Mppx.create({
  polyfill: false,
  fetch: recordingFetch,
  methods: [tempo({ account, expectedChainId: TEMPO_TESTNET })],
})

let paidCalls = 0
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a)

// ── The MCP server and its one tool ───────────────────────────────────────────────────────────
const server = new McpServer({ name: 'rental-scam-check', version: '0.1.0' })

server.registerTool(
  'check_rental_listing',
  {
    title: 'Check a rental listing for scam risk (paid via MPP)',
    description:
      'Checks an Irish rental listing for scam risk signals before anyone pays a deposit or trusts the landlord. ' +
      'Returns a risk level (LOW/MEDIUM/HIGH), a 0-100 score, reasons with sources (official RTB 2025 rent averages, ' +
      'Garda/CCPC scam patterns, shared scam reports) and advice. ' +
      'Each call is PAID automatically via the Machine Payments Protocol on Tempo TESTNET (test money): ' +
      'tier "full" costs 0.01 (includes an AI reading of the text), tier "basic" costs 0.002 (no AI). ' +
      'The response includes the payment receipt and an explorer link. Results are risk signals, not a verdict.',
    inputSchema: {
      description: z.string().min(1).describe('The full listing text'),
      monthly_rent_eur: z.number().positive().describe('Monthly rent in euro'),
      area: z.string().min(1).describe('Area, e.g. "Ranelagh", "Dublin 6", "Galway City"'),
      title: z.string().optional().describe('Listing title'),
      bedrooms: z.number().int().min(0).max(10).optional(),
      viewing_offered: z.boolean().optional().describe('Is an in-person viewing offered?'),
      contact: z
        .object({ phone: z.string().optional(), email: z.string().optional(), iban: z.string().optional() })
        .optional()
        .describe('Landlord contact details, if given'),
      tier: z.enum(['full', 'basic']).default('full').describe('"full" (0.01, with AI) or "basic" (0.002, no AI)'),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ tier, ...listing }) => {
    if (paidCalls >= MAX_PAID_CALLS) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Spending limit reached: ${MAX_PAID_CALLS} paid checks in this session. Restart the MCP server to reset.` }],
      }
    }
    const path = tier === 'basic' ? '/check/basic' : '/check'
    lastChallenge = null
    const t0 = Date.now()
    let res: Response
    try {
      res = await mppx.fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(listing),
      })
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Could not reach the Rental Scam Check API at ${API}: ${(err as Error).message}. Is the server running?` }],
      }
    }
    const ms = Date.now() - t0
    const text = await res.text()
    if (!res.ok) {
      return { isError: true, content: [{ type: 'text', text: `API error HTTP ${res.status}: ${text.slice(0, 500)}` }] }
    }
    paidCalls++

    let receipt: Receipt.Receipt | undefined
    try {
      receipt = Receipt.fromResponse(res)
    } catch {
      receipt = undefined
    }
    const tx = receipt?.reference ?? ''
    const explorer = /^0x[0-9a-fA-F]{64}$/.test(tx) ? `${EXPLORER_TX}${tx}` : null
    const r = JSON.parse(text) as {
      risk: string
      score: number
      signals: { severity: string; message: string; source?: string }[]
      rent_comparison?: { compared_with?: string; difference_pct?: number; rtb_average_eur?: number } | null
      reported_matches?: { field: string; reports: number }[]
      advice?: string
      disclaimer?: string
      llm?: string
    }
    const c = lastChallenge as { amount: string; token: string; recipient: string; chainId: number | null } | null
    const paid = c ? `${c.amount} ${c.token}` : tier === 'basic' ? '0.002' : '0.01'

    const lines = [
      `RESULT: ${r.risk} risk, score ${r.score}/100 (${tier} check${r.llm ? `, AI: ${r.llm}` : ''})`,
      r.rent_comparison?.compared_with != null
        ? `Rent vs RTB 2025 average for ${r.rent_comparison.compared_with}: €${r.rent_comparison.rtb_average_eur} (${r.rent_comparison.difference_pct}%)`
        : 'Rent: no RTB figure for this area',
      'Signals:',
      ...(r.signals.length ? r.signals.map((s) => `- [${s.severity}] ${s.message}${s.source ? ` (source: ${s.source})` : ''}`) : ['- none']),
      ...(r.reported_matches?.length ? [`Shared scam reports: ${r.reported_matches.map((m) => `${m.field} reported ${m.reports}x`).join(', ')}`] : []),
      `Advice: ${r.advice ?? '-'}`,
      r.disclaimer ?? 'Automated risk signals, not a verdict.',
      '',
      'PAYMENT (Machine Payments Protocol, Tempo testnet — test money):',
      `1. POST ${path} → 402 Payment Required: pay ${paid}${c ? ` to ${short(c.recipient)} on chain ${c.chainId}` : ''}`,
      `2. Signed the transfer with the agent wallet ${short(account.address)} and retried with Authorization: Payment`,
      `3. 200 OK + Payment-Receipt: ${receipt?.status ?? 'unknown'}${tx ? `, transaction ${tx}` : ''}`,
      explorer ? `On-chain proof: ${explorer}` : '',
      `Paid checks this session: ${paidCalls}/${MAX_PAID_CALLS} · ${ms} ms`,
    ].filter((l) => l !== '')

    console.error(`[mcp] paid ${paid} for ${path} → ${r.risk} ${r.score} (tx ${short(tx)})`)
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

await server.connect(new StdioServerTransport())
console.error(`[mcp] rental-scam-check ready · API ${API} · agent wallet ${short(account.address)} · testnet only · max ${MAX_PAID_CALLS} paid calls`)
