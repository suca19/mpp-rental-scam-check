// Shapes from PROJECT_SPEC.md. Every field is treated as optional/untrusted
// because the server is being built in parallel; normalize() coerces it.

export type Risk = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Signal {
  id: string
  severity?: string
  message: string
  source?: string
}

export interface RentComparison {
  requested_area?: string
  compared_with?: string
  bedrooms?: string
  rtb_average_eur?: number
  difference_pct?: number
  period?: string
}

export interface ReportedMatch {
  field: string
  reports: number
}

export interface CheckEvent {
  key: string
  time: number // epoch ms
  area: string
  rent: number | null
  risk: Risk
  score: number
  paidAmount: number
  currency: string
  receiptRef: string
  demo: boolean
  signals: Signal[]
  rentComparison: RentComparison | null
  reportedMatches: ReportedMatch[]
  advice: string
}

/** Response of POST /check and POST /api/demo-check */
export interface CheckResult {
  risk: Risk
  score: number
  signals: Signal[]
  rent_comparison?: RentComparison | null
  reported_matches?: ReportedMatch[]
  advice?: string
  disclaimer?: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export function toRisk(v: unknown, score: number): Risk {
  const s = str(v).toUpperCase()
  if (s === 'LOW' || s === 'MEDIUM' || s === 'HIGH') return s
  return score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW'
}

function toTime(v: unknown): number {
  const n = num(v)
  if (n !== null) return n < 1e12 ? n * 1000 : n // seconds or ms
  const d = Date.parse(str(v))
  return Number.isFinite(d) ? d : Date.now()
}

function toSignals(v: unknown): Signal[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({ id: str(s.id), severity: str(s.severity), message: str(s.message) || str(s.id), source: str(s.source) }))
}

function toRentComparison(v: unknown): RentComparison | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  return {
    requested_area: str(r.requested_area) || undefined,
    compared_with: str(r.compared_with) || undefined,
    bedrooms: str(r.bedrooms) || undefined,
    rtb_average_eur: num(r.rtb_average_eur) ?? undefined,
    difference_pct: num(r.difference_pct) ?? undefined,
    period: str(r.period) || undefined,
  }
}

function toMatches(v: unknown): ReportedMatch[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({ field: str(m.field), reports: num(m.reports) ?? 0 }))
}

let seq = 0

/** Accepts flat events ({time, area, rent, ...}) and nested ones ({result: {...}}). */
export function normalize(raw: unknown): CheckEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const r = (e.result && typeof e.result === 'object' ? e.result : e) as Record<string, unknown>
  const score = num(r.score ?? e.score) ?? 0
  const rc = toRentComparison(r.rent_comparison ?? e.rent_comparison)
  const paid = num(e.paid_amount ?? e.amount) ?? 0
  const receiptRef = str(e.receipt_ref ?? e.receipt ?? e.reference)
  const time = toTime(e.time ?? e.timestamp ?? e.ts)
  const area = str(e.area) || rc?.requested_area || 'Unknown area'
  return {
    key: str(e.id) || `${time}-${receiptRef}-${seq++}`,
    time,
    area,
    rent: num(e.rent ?? e.monthly_rent_eur),
    risk: toRisk(r.risk ?? e.risk, score),
    score,
    paidAmount: paid,
    currency: str(e.currency) || 'pathUSD',
    receiptRef,
    demo: e.demo === true || e.paid === false || e.source === 'demo' || paid === 0,
    signals: toSignals(r.signals ?? e.signals),
    rentComparison: rc,
    reportedMatches: toMatches(r.reported_matches ?? e.reported_matches),
    advice: str(r.advice ?? e.advice),
  }
}

export function parseCheckResult(raw: unknown): CheckResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.score === undefined && r.risk === undefined) return null
  const score = num(r.score) ?? 0
  return {
    risk: toRisk(r.risk, score),
    score,
    signals: toSignals(r.signals),
    rent_comparison: toRentComparison(r.rent_comparison),
    reported_matches: toMatches(r.reported_matches),
    advice: str(r.advice),
    disclaimer: str(r.disclaimer),
  }
}
