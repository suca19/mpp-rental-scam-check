// Deterministic risk signals + scoring. Rules decide the score; the LLM can only
// add ids from the fixed signal list (data/scam-signals.json), never a score or verdict.
import { readFileSync } from 'node:fs'
import { dataPath } from './paths.js'
import { compareRent, FAR_BELOW_PCT, RENT_SOURCE, RENT_SOURCE_URL, type RentComparison } from './rents.js'
import type { Listing } from './schema.js'

type Severity = 'high' | 'medium'

interface SignalDef {
  id: string
  severity: Severity
  detection: 'text' | 'rule'
  description: string
  example_phrases: string[]
  source: string
}

export interface Signal {
  id: string
  severity: Severity
  message: string
  source: string
  source_url?: string
  detected_by: 'rule' | 'llm'
  evidence?: string
}

export interface ReportedMatch {
  field: 'phone' | 'email' | 'iban'
  reports: number
}

export interface LlmSignal {
  id: string
  quote: string
}

export type Risk = 'LOW' | 'MEDIUM' | 'HIGH'

export const DISCLAIMER = 'Automated risk signals, not a verdict. Prototype.'

export const SIGNALS: SignalDef[] = JSON.parse(readFileSync(dataPath('scam-signals.json'), 'utf8'))
const byId = new Map(SIGNALS.map((s) => [s.id, s]))
/** Ids the LLM is allowed to return. */
export const TEXT_SIGNAL_IDS = SIGNALS.filter((s) => s.detection === 'text').map((s) => s.id)

function sourceLabel(url: string): string {
  if (url.includes('garda.ie')) return 'Garda accommodation fraud advice'
  if (url.includes('ccpc.ie')) return 'CCPC rental scam advice'
  if (url.includes('threshold.ie')) return 'Threshold Scamwatch'
  if (url.includes('universityofgalway.ie')) return 'University of Galway accommodation advice'
  return url
}

// Extra keyword patterns on top of example_phrases. Kept narrow to avoid flagging normal listings.
const EXTRA_PATTERNS: Record<string, RegExp[]> = {
  deposit_before_viewing: [/deposit (first|before (the |a )?viewing|to (secure|hold|reserve))/i],
  landlord_abroad: [
    /\b(i am|i'm|currently|i live|living|i moved|working|i work) (now )?(abroad|overseas|out of the country|outside (of )?ireland)/i,
  ],
  no_viewing: [/viewings? (are|is) not (possible|available)/i, /(can'?t|cannot|unable to) (do a |arrange a )?view/i],
  keys_by_post: [/keys? (by|via|through) (post|courier|dhl|an? post)/i, /(post|courier|send) (you )?the keys/i],
  unusual_payment_method: [
    /western union|moneygram|bitcoin|crypto(currency)?|gift ?cards?|friends (and|&) family|cash only/i,
  ],
  urgency_pressure: [/pay (it )?today|within the hour|first come,? first served|(lots of|many people|huge) interest/i],
  messaging_only_contact: [/whatsapp only|only (on|via|through) whatsapp|no (phone )?calls/i],
  early_id_documents: [/cop(y|ies) of (your )?passport|bank statements? (first|before)/i],
  payment_before_lease: [/no questions asked|(sign|send) the (contract|lease) after|pay first/i],
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ')

function mkSignal(id: string, detected_by: Signal['detected_by'], evidence?: string, message?: string): Signal {
  const def = byId.get(id)!
  return {
    id,
    severity: def.severity,
    message: message ?? `${def.description}.`,
    source: sourceLabel(def.source),
    source_url: def.source,
    detected_by,
    ...(evidence ? { evidence } : {}),
  }
}

function keywordSignals(text: string): Signal[] {
  const t = norm(text)
  const out: Signal[] = []
  for (const def of SIGNALS) {
    if (def.detection !== 'text') continue
    const phrase = def.example_phrases.find((p) => t.includes(norm(p)))
    if (phrase) {
      out.push(mkSignal(def.id, 'rule', `matched phrase "${phrase}"`))
      continue
    }
    for (const re of EXTRA_PATTERNS[def.id] ?? []) {
      const m = text.match(re)
      if (m) {
        out.push(mkSignal(def.id, 'rule', `matched "${m[0]}"`))
        break
      }
    }
  }
  return out
}

const eur = (n: number) => `€${n.toLocaleString('en-IE')}`

export interface CheckResult {
  risk: Risk
  score: number
  signals: Signal[]
  rent_comparison: RentComparison | null
  reported_matches: ReportedMatch[]
  advice: string
  llm: 'ok' | 'unavailable' | 'disabled' | 'limited'
  disclaimer: string
}

const WEIGHT: Record<Severity, number> = { high: 0.4, medium: 0.2 }

/** Combined score: 100 * (1 - prod(1 - w)). One high = 40, two highs = 64, four highs = 87. Never 100. */
export function scoreOf(signals: Signal[]): number {
  const remaining = signals.reduce((acc, s) => acc * (1 - WEIGHT[s.severity]), 1)
  return Math.round(100 * (1 - remaining))
}

export function riskOf(score: number): Risk {
  if (score >= 60) return 'HIGH'
  if (score >= 30) return 'MEDIUM'
  return 'LOW'
}

function adviceFor(risk: Risk, ids: Set<string>): string {
  if (risk === 'LOW') {
    return 'No strong risk signals found. Still view the property in person and confirm the landlord before paying anything.'
  }
  const parts = ['Do not pay a deposit before viewing in person.']
  if (ids.has('reported_contact')) parts.push('These contact details appear in shared scam reports.')
  if (ids.has('unusual_payment_method') || ids.has('foreign_bank_account'))
    parts.push('Avoid cash, crypto, money transfer services and foreign accounts.')
  parts.push('If in doubt, contact Threshold or report to An Garda Síochána.')
  return parts.join(' ')
}

export function evaluate(
  listing: Listing,
  reported: ReportedMatch[],
  llmSignals: LlmSignal[] | null,
  llmStatus: CheckResult['llm'],
): CheckResult {
  const signals = new Map<string, Signal>()
  const add = (s: Signal, key = s.id) => {
    if (!signals.has(key)) signals.set(key, s)
  }

  // 1. Rent vs RTB average
  const rent = compareRent(listing.area, listing.monthly_rent_eur, listing.bedrooms)
  if (rent && rent.difference_pct <= -FAR_BELOW_PCT) {
    const beds = rent.bedrooms === 'all' ? 'a home' : `a ${rent.bedrooms.replace('plusbed', '+ bed').replace('bed', '-bed')}`
    add(
      mkSignal(
        'rent_far_below_average',
        'rule',
        undefined,
        `Rent is ${Math.abs(rent.difference_pct)}% below the RTB ${rent.period} average for ${beds} in ${rent.compared_with} (${eur(rent.rtb_average_eur)}).`,
      ),
    )
    const rentSignal = signals.get('rent_far_below_average')!
    rentSignal.source = RENT_SOURCE
    rentSignal.source_url = RENT_SOURCE_URL
  }

  // 2. Field checks
  if (listing.viewing_offered === false) {
    add(mkSignal('no_viewing', 'rule', 'viewing_offered is false', 'No in-person viewing is offered.'))
  }
  const iban = listing.contact?.iban?.replace(/\s+/g, '').toUpperCase()
  if (iban && /^[A-Z]{2}/.test(iban) && !iban.startsWith('IE')) {
    add(
      mkSignal(
        'foreign_bank_account',
        'rule',
        `IBAN country ${iban.slice(0, 2)}`,
        `Payment account is outside Ireland (IBAN country ${iban.slice(0, 2)}).`,
      ),
    )
  }

  // 3. Shared scam reports
  for (const m of reported) {
    add({
      id: 'reported_contact',
      severity: 'high',
      message: `This ${m.field === 'iban' ? 'IBAN' : m.field} appears in ${m.reports} shared scam report${m.reports === 1 ? '' : 's'}.`,
      source: 'Shared scam reports (this service)',
      detected_by: 'rule',
    }, `reported_contact:${m.field}`)
  }

  // 4. Deterministic keyword checks on the text
  const text = [listing.title, listing.description].filter(Boolean).join('\n')
  for (const s of keywordSignals(text)) add(s)

  // 5. LLM-detected ids (already validated against TEXT_SIGNAL_IDS in llm.ts)
  for (const s of llmSignals ?? []) {
    if (byId.get(s.id)?.detection === 'text') add(mkSignal(s.id, 'llm', `"${s.quote}"`))
  }

  const list = [...signals.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
  const score = scoreOf(list)
  const risk = riskOf(score)
  return {
    risk,
    score,
    signals: list,
    rent_comparison: rent,
    reported_matches: reported,
    advice: adviceFor(risk, new Set(list.map((s) => s.id))),
    llm: llmStatus,
    disclaimer: DISCLAIMER,
  }
}
