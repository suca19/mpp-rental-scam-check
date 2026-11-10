// Shared scam reports. Only SHA-256 hashes of normalised identifiers are kept
// (in memory + data/reports.json); raw phone/email/IBAN and notes are never stored.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dataPath } from './paths.js'
import type { ReportedMatch } from './rules.js'

type Field = ReportedMatch['field']
interface Entry {
  field: Field
  count: number
  last_reported: string
}

const FILE = dataPath('reports.json')
const store = new Map<string, Entry>()

if (existsSync(FILE)) {
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { entries?: Record<string, Entry> }
    for (const [hash, e] of Object.entries(raw.entries ?? {})) store.set(hash, e)
  } catch (err) {
    console.warn(`[reports] could not read ${FILE}, starting empty: ${(err as Error).message}`)
  }
}

function persist() {
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify({ note: 'SHA-256 of "field:normalised value". No raw data.', entries: Object.fromEntries(store) }, null, 1))
  renameSync(tmp, FILE)
}

export function normalise(field: Field, value: string): string | null {
  const v = value.trim()
  if (field === 'email') return v.toLowerCase() || null
  if (field === 'iban') return v.replace(/[\s-]+/g, '').toUpperCase() || null
  // phone: digits only, international form without "+"; Irish national "0..." -> "353..."
  let d = v.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = `353${d.slice(1)}`
  d = d.replace(/\D/g, '')
  return d.length >= 6 ? d : null
}

const hashOf = (field: Field, normalised: string) =>
  createHash('sha256').update(`${field}:${normalised}`).digest('hex')

type Contact = Partial<Record<Field, string>>
const FIELDS: Field[] = ['phone', 'email', 'iban']

function hashes(contact: Contact): Array<[Field, string]> {
  const out: Array<[Field, string]> = []
  for (const f of FIELDS) {
    const raw = contact[f]
    if (!raw) continue
    const n = normalise(f, raw)
    if (n) out.push([f, hashOf(f, n)])
  }
  return out
}

/** Adds a report; returns the new count per field. */
export function addReport(contact: Contact): ReportedMatch[] {
  const now = new Date().toISOString()
  const result: ReportedMatch[] = []
  for (const [field, h] of hashes(contact)) {
    const e = store.get(h) ?? { field, count: 0, last_reported: now }
    e.count += 1
    e.last_reported = now
    store.set(h, e)
    result.push({ field, reports: e.count })
  }
  if (result.length) persist()
  return result
}

export function lookupReports(contact: Contact | undefined): ReportedMatch[] {
  if (!contact) return []
  return hashes(contact).flatMap(([field, h]) => {
    const e = store.get(h)
    return e ? [{ field, reports: e.count }] : []
  })
}
