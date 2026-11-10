// In-memory event log for the dashboard. One event per check.
// Never contains listing text, contact details or LLM evidence quotes.
import { randomUUID } from 'node:crypto'
import type { CheckResult } from './rules.js'
import type { Listing } from './schema.js'

export interface CheckEvent {
  id: string
  time: string
  area: string
  rent: number
  risk: CheckResult['risk']
  score: number
  paid_amount: number
  currency: string
  receipt_ref: string
  demo: boolean
  llm: CheckResult['llm']
  signals: Array<{ id: string; severity: string; message: string; source: string }>
  rent_comparison: CheckResult['rent_comparison']
  reported_matches: CheckResult['reported_matches']
  advice: string
}

const MAX = 100
const log: CheckEvent[] = []
const listeners = new Set<(e: CheckEvent) => void>()

export function recordCheck(
  listing: Listing,
  result: CheckResult,
  payment: { amount: number; currency: string; receipt_ref?: string; demo: boolean },
): CheckEvent {
  const id = randomUUID()
  const event: CheckEvent = {
    id,
    time: new Date().toISOString(),
    area: listing.area,
    rent: listing.monthly_rent_eur,
    risk: result.risk,
    score: result.score,
    paid_amount: payment.amount,
    currency: payment.currency,
    receipt_ref: payment.receipt_ref ?? `demo-${id}`,
    demo: payment.demo,
    llm: result.llm,
    // Whitelist the fields: no `evidence` (quotes from the listing) and no source_url noise.
    signals: result.signals.map(({ id, severity, message, source }) => ({ id, severity, message, source })),
    rent_comparison: result.rent_comparison,
    reported_matches: result.reported_matches.map(({ field, reports }) => ({ field, reports })),
    advice: result.advice,
  }
  log.push(event)
  if (log.length > MAX) log.shift()
  for (const fn of listeners) {
    try {
      fn(event)
    } catch {
      /* a broken listener must not break the check */
    }
  }
  return event
}

export const backlog = () => [...log]

export function subscribe(fn: (e: CheckEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
