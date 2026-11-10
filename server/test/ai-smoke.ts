// Smoke test of the AI step only (no payment): which signals does the model pick for a demo listing?
// Run from server/:  npx tsx test/ai-smoke.ts subtle-scam      (uses GEMINI_MODEL from ../.env if set)
//                    GEMINI_MODEL=gemini-2.5-flash-lite npx tsx test/ai-smoke.ts legit
import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from '../src/paths.js'

config({ path: resolve(ROOT, '.env'), quiet: true })
const { detectTextSignals } = await import('../src/llm.js')

const name = process.argv[2] ?? 'subtle-scam'
const l = JSON.parse(readFileSync(resolve(ROOT, 'demo/listings', `${name}.json`), 'utf8'))
const t0 = Date.now()
const r = await detectTextSignals([l.title, l.description].filter(Boolean).join('\n'))
console.log(`${name}: ${r.status} in ${Date.now() - t0} ms (model ${process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'})`)
console.log('  signals:', r.signals ? r.signals.map((s) => s.id).join(', ') || '(none)' : '-')
