// Demo client: posts a listing to the paid POST /check endpoint, pays the 402 with the
// testnet payer wallet, and prints the risk result plus the payment receipt.
//
// Run from demo/:   npm run check -- listings/absurd-scam.json
//   (= npx tsx --env-file=../.env.payer client.ts listings/absurd-scam.json)
// Options:          --json   print the raw response body instead of the summary
// Env:              MPPX_PRIVATE_KEY (from ../.env.payer, never printed)
//                   CHECK_URL (default http://localhost:3000/check)
import { readFileSync } from 'node:fs'
import { Receipt } from 'mppx'
import { Mppx, tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

const TEMPO_TESTNET = 42431 // Moderato. The client refuses to pay on any other chain.
const url = process.env.CHECK_URL ?? 'http://localhost:3000/check'
const args = process.argv.slice(2)
const raw = args.includes('--json')
const file = args.find((a) => !a.startsWith('--'))

if (!file) {
  console.error('usage: npm run check -- listings/<file>.json [--json]')
  process.exit(2)
}
const key = process.env.MPPX_PRIVATE_KEY as `0x${string}` | undefined
if (!key) {
  console.error('MPPX_PRIVATE_KEY missing: run with --env-file=../.env.payer (npm run check does this)')
  process.exit(2)
}

const account = privateKeyToAccount(key)
const mppx = Mppx.create({
  polyfill: false,
  methods: [tempo({ account, expectedChainId: TEMPO_TESTNET })],
})

let paidChallenge = false
mppx.onChallengeReceived(() => {
  paidChallenge = true
  if (!raw) console.log(dim('402 Payment Required -> paying $0.01 on Tempo testnet...'))
})

const body = readFileSync(file, 'utf8')
JSON.parse(body) // fail early on a broken listing file

const t0 = Date.now()
let res: Response
try {
  res = await mppx.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body,
  })
} catch (err) {
  console.error(`Request failed (${url}): ${(err as Error).message}`)
  console.error('Is the server running? curl http://localhost:3000/health')
  process.exit(1)
}
const ms = Date.now() - t0
const text = await res.text()

if (!res.ok) {
  console.error(`HTTP ${res.status} after ${ms} ms`)
  console.error(text.slice(0, 2000))
  process.exit(1)
}

let receipt: Receipt.Receipt | undefined
try {
  receipt = Receipt.fromResponse(res)
} catch {
  receipt = undefined
}

if (raw) {
  console.log(text)
  process.exit(0)
}

const r = JSON.parse(text) as CheckResponse
const color = r.risk === 'HIGH' ? red : r.risk === 'MEDIUM' ? yellow : green
console.log('')
console.log(bold(`Listing: ${file}`))
console.log(`Risk:    ${color(bold(`${r.risk}  ${r.score}/100`))}`)
const rc = r.rent_comparison
if (rc && rc.rtb_average_eur != null) {
  console.log(
    dim(`Rent:    vs RTB ${rc.period ?? ''} average for ${rc.bedrooms ?? ''} in ${rc.compared_with}: ` +
      `EUR ${rc.rtb_average_eur} (${rc.difference_pct > 0 ? '+' : ''}${rc.difference_pct}%)`),
  )
}
console.log('Signals:')
if (!r.signals?.length) console.log(dim('  (none)'))
for (const s of r.signals ?? []) {
  const sev = s.severity === 'high' ? red('high  ') : s.severity === 'medium' ? yellow('medium') : dim(s.severity.padEnd(6))
  console.log(`  ${sev} ${s.message}${s.source ? dim(`  [${s.source}]`) : ''}`)
}
for (const m of r.reported_matches ?? []) {
  if (m.reports > 0) console.log(`  ${red('report')} ${m.field} reported ${m.reports} time(s) by other users`)
}
if (r.advice) console.log(`Advice:  ${r.advice}`)
if (r.disclaimer) console.log(dim(r.disclaimer))
console.log('')
if (receipt) {
  console.log(green(`Paid $0.01 via ${receipt.method} (${receipt.status}) in ${ms} ms`))
  console.log(dim(`Receipt: ${receipt.reference}  ${receipt.timestamp}`))
  // The receipt reference is the Tempo transaction hash → link to the public testnet explorer.
  if (/^0x[0-9a-fA-F]{64}$/.test(receipt.reference)) {
    console.log(`🔗 On-chain proof: https://explore.testnet.tempo.xyz/tx/${receipt.reference}`)
  }
} else {
  console.log(yellow(`No Payment-Receipt header (challenge seen: ${paidChallenge}). ${ms} ms`))
}

// ---- types + tiny ANSI helpers ----
type CheckResponse = {
  risk: 'LOW' | 'MEDIUM' | 'HIGH'
  score: number
  signals?: { id: string; severity: string; message: string; source?: string }[]
  rent_comparison?: {
    compared_with: string
    bedrooms?: string
    rtb_average_eur: number | null
    difference_pct: number
    period?: string
  }
  reported_matches?: { field: string; reports: number }[]
  advice?: string
  disclaimer?: string
}
function wrap(code: number) {
  return (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
}
function bold(s: string) { return wrap(1)(s) }
function dim(s: string) { return wrap(2)(s) }
function red(s: string) { return wrap(31)(s) }
function green(s: string) { return wrap(32)(s) }
function yellow(s: string) { return wrap(33)(s) }
