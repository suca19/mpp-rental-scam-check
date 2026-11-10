// RTB average rent lookup (data/rents.json, CSO RIA02, CC BY 4.0).
// Lookup order (PROJECT_SPEC.md "Rent lookup"):
//   1. exact area or alias (case-insensitive)
//   2. postal district -> its `fallback` (Dublin county; RIA02 has no district totals after 2021)
//   3. bedroom column if known, else `all`
//   4. always report which area was actually used (`compared_with`)
import { readFileSync } from 'node:fs'
import { dataPath } from './paths.js'

type BedKey = 'all' | '1bed' | '2bed' | '3bed' | '4plusbed'
type RentRow = Partial<Record<BedKey, number>>

interface RentsFile {
  period: string
  source: string
  source_url: string
  areas: Record<string, RentRow>
  postal_districts: Record<string, { fallback: string; neighbourhoods: string[] }>
  aliases: Record<string, string>
}

export interface RentComparison {
  requested_area: string
  compared_with: string
  bedrooms: BedKey
  rtb_average_eur: number
  difference_pct: number
  period: string
  note?: string
}

const rents = JSON.parse(readFileSync(dataPath('rents.json'), 'utf8')) as RentsFile

export const RENT_SOURCE = rents.source
export const RENT_SOURCE_URL = rents.source_url
/** Flag only if the rent is at least this many percent below the average (spec: >= 45%). */
export const FAR_BELOW_PCT = 45

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

const areaByKey = new Map<string, string>()
for (const name of Object.keys(rents.areas)) areaByKey.set(norm(name), name)
const districtByKey = new Map<string, string>()
for (const name of Object.keys(rents.postal_districts)) districtByKey.set(norm(name), name)
const aliasByKey = new Map<string, string>()
for (const [alias, target] of Object.entries(rents.aliases)) aliasByKey.set(norm(alias), target)

const COUNTIES = new Set(
  'Carlow Cavan Clare Cork Donegal Dublin Galway Kerry Kildare Kilkenny Laois Leitrim Limerick Longford Louth Mayo Meath Monaghan Offaly Roscommon Sligo Tipperary Waterford Westmeath Wexford Wicklow'.split(
    ' ',
  ),
)

interface Resolved {
  area: string // key in rents.areas
  viaDistrict?: string
}

function resolveOne(candidate: string): Resolved | null {
  const key = norm(candidate)
  if (!key) return null
  const target = areaByKey.get(key) ?? districtByKey.get(key) ?? aliasByKey.get(key)
  if (!target) return null
  if (rents.areas[target]) return { area: target }
  const district = rents.postal_districts[target]
  if (district && rents.areas[district.fallback]) return { area: district.fallback, viaDistrict: target }
  return null
}

function resolveArea(input: string): Resolved | null {
  // Whole string first ("Ranelagh, Dublin 6"), then each comma part left to right ("Ranelagh", "D6").
  const whole = resolveOne(input)
  if (whole) return whole
  for (const part of input.split(',')) {
    const hit = resolveOne(part)
    if (hit) return hit
  }
  return null
}

function bedKey(bedrooms?: number): BedKey {
  if (bedrooms === undefined || bedrooms < 1) return 'all'
  if (bedrooms >= 4) return '4plusbed'
  return `${bedrooms}bed` as BedKey
}

export function compareRent(area: string, monthlyRent: number, bedrooms?: number): RentComparison | null {
  const resolved = resolveArea(area)
  if (!resolved) return null
  const row = rents.areas[resolved.area]
  let col = bedKey(bedrooms)
  const notes: string[] = []
  if (row[col] === undefined) {
    if (col !== 'all') notes.push(`No ${col} figure for ${resolved.area}; using all bedrooms.`)
    col = 'all'
  }
  const avg = row[col]
  if (avg === undefined) return null
  if (resolved.viaDistrict) {
    notes.push(
      `RTB has no ${resolved.viaDistrict} total after 2021; compared with the county average, which is coarse.`,
    )
  }
  return {
    requested_area: area,
    compared_with: COUNTIES.has(resolved.area) ? `${resolved.area} (county)` : resolved.area,
    bedrooms: col,
    rtb_average_eur: avg,
    difference_pct: Math.round(((monthlyRent - avg) / avg) * 100),
    period: rents.period,
    ...(notes.length ? { note: notes.join(' ') } : {}),
  }
}
