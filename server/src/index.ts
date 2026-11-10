import { config } from 'dotenv'
import { serve } from '@hono/node-server'
import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { Receipt } from 'mppx'
import { Mppx, discovery, tempo } from 'mppx/hono'
import { resolve } from 'node:path'
import { z } from 'zod'
import { backlog, recordCheck, subscribe, type CheckEvent } from './events.js'
import { detectTextSignals } from './llm.js'
import { agentAvailable, payAndCheck } from './agent.js'
import { ROOT } from './paths.js'
import { rateLimit } from './ratelimit.js'
import { addReport, lookupReports } from './reports.js'
import { evaluate, type CheckResult } from './rules.js'
import { ListingSchema, ReportSchema, formatZodError, type Listing } from './schema.js'

config({ path: resolve(ROOT, '.env'), quiet: true })

const recipient = process.env.MPP_RECIPIENT as `0x${string}` | undefined
if (!recipient || !process.env.MPP_SECRET_KEY) {
  throw new Error('MPP_RECIPIENT and MPP_SECRET_KEY must be set in .env')
}

const PRICE = '0.01'
const EXAMPLE_LISTING = {
  title: 'Stunning 3-bed in Ranelagh',
  description: 'I am currently abroad, so viewings are not possible. Send the deposit to secure it.',
  monthly_rent_eur: 400,
  area: 'Dublin 6',
  bedrooms: 3,
  viewing_offered: false,
}
const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  // testnet: true -> Tempo Moderato; mppx offers OUSD first, then pathUSD (see SETUP.md)
  methods: [tempo.charge({ testnet: true, recipient })],
})

// Tempo testnet token addresses -> display names (from the 402 offers seen in SETUP.md)
const CURRENCY_NAMES: Record<string, string> = {
  '0x20c0000000000000000000006a37da5c996874be': 'OUSD',
  '0x20c0000000000000000000000000000000000000': 'pathUSD',
}

type Env = { Variables: { listing: Listing; result: CheckResult } }
const app = new Hono<Env>()

// One log line per request so you can watch agents talk to the service (added 10 Nov).
// Logs method, path, payment proof yes/no, status, risk and time — never the listing text or contacts.
app.use('*', async (c, next) => {
  const start = Date.now()
  const hasProof = (c.req.header('authorization') ?? '').startsWith('Payment ')
  await next()
  if (c.req.path === '/health') return
  const status = c.res.status
  const note =
    status === 402 ? '💳 payment required (challenge sent)'
    : status === 200 && hasProof ? `✅ paid → ${c.get('result')?.risk ?? ''} ${c.get('result')?.score ?? ''}`
    : status === 200 && c.get('result') ? `free → ${c.get('result')?.risk} ${c.get('result')?.score}`
    : status === 400 ? '❌ bad input (no charge)'
    : ''
  const time = new Date().toLocaleTimeString('en-IE')
  console.log(`${time}  ${c.req.method} ${c.req.path}${hasProof ? ' [+payment proof]' : ''} → ${status} ${note} (${Date.now() - start} ms)`)
})

const limitBody = bodyLimit({
  maxSize: 32 * 1024,
  onError: (c) => c.json({ error: 'Request body too large (max 32 KB)' }, 413),
})

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | undefined> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

/** Validates the listing BEFORE the payment middleware, so malformed requests never get charged. */
const validateListing: MiddlewareHandler<Env> = async (c, next) => {
  const body = await readJson(c)
  if (body === undefined) return c.json({ error: 'Body must be JSON (Content-Type: application/json)' }, 400)
  const parsed = ListingSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: `Invalid listing: ${formatZodError(parsed.error)}` }, 400)
  c.set('listing', parsed.data)
  await next()
}

/** Runs after the payment middleware has attached Payment-Receipt; emits one dashboard event per paid check. */
const emitPaidEvent = (price: string): MiddlewareHandler<Env> => async (c, next) => {
  await next()
  const result = c.get('result')
  if (c.res.status !== 200 || !result) return
  let receipt_ref: string | undefined
  let currency = 'OUSD'
  try {
    const r = Receipt.fromResponse(c.res) as { reference?: string; fundingCurrency?: string }
    receipt_ref = r.reference
    if (r.fundingCurrency) currency = CURRENCY_NAMES[r.fundingCurrency.toLowerCase()] ?? r.fundingCurrency
  } catch (err) {
    console.warn(`[events] could not read Payment-Receipt: ${(err as Error).message}`)
  }
  recordCheck(c.get('listing'), result, { amount: Number(price), currency, receipt_ref, demo: false })
}

/** Full check = rules + RTB + reports + AI text signals. Basic check (ai:false) skips the AI step. */
async function runCheck(listing: Listing, opts: { ai: boolean } = { ai: true }): Promise<CheckResult> {
  if (!opts.ai) return evaluate(listing, lookupReports(listing.contact), null, 'disabled')
  const text = [listing.title, listing.description].filter(Boolean).join('\n')
  const llm = await detectTextSignals(text)
  return evaluate(listing, lookupReports(listing.contact), llm.signals, llm.status)
}

app.get('/health', (c) => c.json({ ok: true }))

// GET /llms.txt (added 10 Nov, per the hackathon guide): plain-text description for AI agents, with prices.
app.get('/llms.txt', (c) => {
  const base = new URL(c.req.url).origin
  return c.text(`# Rental Scam Check

> Paid API for AI agents: risk signals for an Irish rental listing before anyone pays a deposit.
> Payment: Machine Payments Protocol (MPP), HTTP 402. Tempo testnet, test stablecoins (OUSD or pathUSD), no real funds.

## Prices
- POST ${base}/check: 0.01 per request. Full check: official RTB 2025 rent averages, Garda/CCPC scam patterns, shared scam reports, plus an AI reading of the listing text.
- POST ${base}/check/basic: 0.002 per request. Basic check: the same without the AI step. Cheaper and faster.

## How to pay
1. POST the listing as JSON. You get 402 Payment Required with a WWW-Authenticate: Payment challenge (price, token, recipient, chain 42431).
2. Pay with any MPP client (e.g. mppx: \`npx mppx ${base}/check -J '{...}' --network testnet\`) and retry with Authorization: Payment <credential>.
3. You get 200 with the result and a Payment-Receipt header (its reference is the Tempo transaction hash).
Invalid bodies get 400 before any payment is asked.

## Request body (JSON)
Required: description (string), monthly_rent_eur (number), area (string, e.g. "Ranelagh", "Dublin 6").
Optional: title, bedrooms, viewing_offered (boolean), contact { phone, email, iban }.

## Response
risk (LOW | MEDIUM | HIGH), score (0-100), signals [{ id, severity, message, source }], rent_comparison, reported_matches, advice, disclaimer.
Results are automated risk signals, not a verdict.

## Discovery
- OpenAPI with x-payment-info offers: ${base}/openapi.json
- Health: ${base}/health
`)
})

const chargeCheck = mppx.charge({ amount: PRICE, description: 'Rental listing risk-signal check' })
// Tiered pricing (added 10 Nov): the same 402 mechanism, a different price per route.
const PRICE_BASIC = '0.002'
const chargeBasic = mppx.charge({ amount: PRICE_BASIC, description: 'Basic rental check: rules + RTB rents + reports (no AI)' })

// Paid: 0.01 via MPP (Tempo testnet). Full check including the AI step.
app.post(
  '/check',
  limitBody,
  validateListing,
  emitPaidEvent(PRICE),
  chargeCheck,
  async (c) => {
    const result = await runCheck(c.get('listing'))
    c.set('result', result)
    return c.json({ ...result, tier: 'full' })
  },
)

// Paid: 0.002 via MPP. Basic check, no AI: cheaper and faster, for agents screening many listings.
app.post(
  '/check/basic',
  limitBody,
  validateListing,
  emitPaidEvent(PRICE_BASIC),
  chargeBasic,
  async (c) => {
    const result = await runCheck(c.get('listing'), { ai: false })
    c.set('result', result)
    return c.json({ ...result, tier: 'basic' })
  },
)

// PUBLIC_DEPLOY=1 (set on the public host, added 10 Nov): listen on all interfaces and switch OFF the two
// laptop-demo routes below. On the internet, /api/agent-check would let anyone spend the agent wallet and
// /api/demo-check would give free AI checks. The paid routes /check and /check/basic stay on.
const PUBLIC_DEPLOY = process.env.PUBLIC_DEPLOY === '1'
const localDemoOnly: MiddlewareHandler<Env> = async (c, next) => {
  if (PUBLIC_DEPLOY) return c.json({ error: 'Not available on the public deployment. Use the paid POST /check.' }, 404)
  await next()
}

// Free demo for the dashboard form (no wallet in the browser). Same logic, rate-limited, marked demo.
app.post('/api/demo-check', localDemoOnly, limitBody, rateLimit('/api/demo-check', 10, 60_000), validateListing, async (c) => {
  const listing = c.get('listing')
  const result = await runCheck(listing)
  recordCheck(listing, result, { amount: 0, currency: 'none', demo: true })
  return c.json({ ...result, demo: true })
})

// Dashboard "Pay as the agent" (added 10 Nov): the SERVER acts as the agent with the testnet payer
// wallet (key never reaches the browser) and pays our own /check through the real MPP flow.
// The server only listens on 127.0.0.1, and this route is rate-limited (it spends test funds).
app.post('/api/agent-check', localDemoOnly, limitBody, rateLimit('/api/agent-check', 6, 60_000), validateListing, async (c) => {
  if (!agentAvailable()) return c.json({ error: 'Demo agent wallet not configured (.env.payer)' }, 503)
  const port = Number(process.env.PORT ?? 3000)
  const path = c.req.query('tier') === 'basic' ? '/check/basic' : '/check'
  const run = await payAndCheck(`http://127.0.0.1:${port}${path}`, JSON.stringify(c.get('listing')))
  return c.json(run, run.ok ? 200 : 502)
})

// Free: add identifiers to the shared scam-report list (stored as SHA-256 hashes only).
app.post('/report', limitBody, rateLimit('/report', 10, 60_000), async (c) => {
  const body = await readJson(c)
  if (body === undefined) return c.json({ error: 'Body must be JSON (Content-Type: application/json)' }, 400)
  const parsed = ReportSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: `Invalid report: ${formatZodError(parsed.error)}` }, 400)
  const { note: _note, ...contact } = parsed.data // the note is accepted but never stored
  const recorded = addReport(contact)
  if (!recorded.length) return c.json({ error: 'No usable phone, email or IBAN after normalising' }, 400)
  return c.json({ ok: true, recorded, stored: 'SHA-256 hashes only' })
})

// Free: live event stream for the dashboard. Sends a `backlog` array on connect, then one `check` event per check.
app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    const queue: CheckEvent[] = []
    let wake: (() => void) | null = null
    const unsubscribe = subscribe((e) => {
      queue.push(e)
      wake?.()
    })
    let open = true
    stream.onAbort(() => {
      open = false
      unsubscribe()
      wake?.()
    })
    await stream.writeSSE({ event: 'backlog', data: JSON.stringify(backlog()) })
    while (open) {
      while (queue.length) {
        const e = queue.shift()!
        await stream.writeSSE({ event: 'check', id: e.id, data: JSON.stringify(e) })
      }
      // Wait for the next event, or 15 s for a keep-alive comment.
      await new Promise<void>((r) => {
        wake = r
        setTimeout(r, 15_000)
      })
      wake = null
      if (open && !queue.length) await stream.write(': keep-alive\n\n')
    }
    unsubscribe()
  }),
)

// GET /openapi.json: lets agents (and `npx mppx validate`) find the paid route and its body schema.
discovery(app, mppx, {
  info: { title: 'Rental Scam Check', version: '0.1.0' },
  routes: [
    {
      handler: chargeCheck,
      method: 'post',
      path: '/check',
      summary: 'Risk signals for an Irish rental listing (RTB rent data, Garda scam patterns, shared reports)',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: z.toJSONSchema(ListingSchema), example: EXAMPLE_LISTING } },
      },
    },
    {
      handler: chargeBasic,
      method: 'post',
      path: '/check/basic',
      summary: 'Basic risk signals without the AI step (rules, RTB rents, shared reports): cheaper and faster',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: z.toJSONSchema(ListingSchema), example: EXAMPLE_LISTING } },
      },
    },
  ],
})

const port = Number(process.env.PORT ?? 3000)
// Bind to localhost only, so nobody on the venue Wi-Fi can reach the server (security review, 9 Nov).
// Set HOST=0.0.0.0 to expose it on purpose. On the public host (PUBLIC_DEPLOY=1) it listens on 0.0.0.0.
const hostname = process.env.HOST ?? (PUBLIC_DEPLOY ? '0.0.0.0' : '127.0.0.1')
serve({ fetch: app.fetch, port, hostname }, () =>
  console.log(`rental-scam-check on http://${hostname}:${port}${PUBLIC_DEPLOY ? ' (PUBLIC_DEPLOY: demo routes off)' : ''}`),
)
