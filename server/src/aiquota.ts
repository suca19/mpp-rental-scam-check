// AI quota (added 11 Nov): protects the Gemini key on the public host.
//  - each caller gets at most AI_MAX_PER_USER_PER_DAY AI checks (default 3) per 24 h,
//  - the whole server gets at most AI_MAX_PER_HOUR AI checks (default 60) per hour.
// After that, checks still run, but rules-only (llm: 'limited'). Only active when PUBLIC_DEPLOY=1.
// In-memory, single instance; a restart resets the counters.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

const PUBLIC = process.env.PUBLIC_DEPLOY === '1'
const PER_USER = Number(process.env.AI_MAX_PER_USER_PER_DAY ?? 3)
const PER_HOUR = Number(process.env.AI_MAX_PER_HOUR ?? 60)
const DAY = 86_400_000
const HOUR = 3_600_000

// Random per process: caller ids are salted hashes, so raw IPs are never stored or logged.
const SALT = randomBytes(16)
const INTERNAL = randomBytes(32)

/**
 * A short, anonymous id for whoever sent this request.
 * On the public host the request arrives through the hosting proxy, which APPENDS the visitor's IP to
 * X-Forwarded-For. Entries before the last one can be typed in by the client, so only the last one is trusted.
 */
export function clientKey(c: Context): string {
  let ip = getConnInfo(c).remote.address ?? 'unknown'
  if (PUBLIC) {
    const last = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()
    if (last) ip = last
  }
  return createHash('sha256').update(SALT).update(ip).digest('hex').slice(0, 12)
}

// "Pay as the agent": the server calls its own /check, so that request comes from the server itself.
// It forwards the visitor's id in a header signed with a per-process secret, so outsiders cannot fake it.
export const VISITOR_HEADER = 'x-demo-visitor'
const sign = (key: string) => createHmac('sha256', INTERNAL).update(key).digest('hex').slice(0, 32)
export const signedVisitor = (key: string) => `${key}.${sign(key)}`

/** The id the AI quota is charged to: a valid signed visitor id (from the demo agent), else the caller. */
export function aiCaller(c: Context): string {
  const v = c.req.header(VISITOR_HEADER)
  if (v) {
    const [key, sig] = v.split('.')
    if (key && sig && sig.length === 32 && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(key)))) return key
  }
  return clientKey(c)
}

const users = new Map<string, { count: number; resetAt: number }>()
let hour = { start: Date.now(), count: 0 }

export type AiBudget = { ok: true } | { ok: false; note: string }

/** Takes one AI call from the caller's budget. Always ok when not on the public host. */
export function takeAiBudget(caller: string): AiBudget {
  if (!PUBLIC) return { ok: true }
  const now = Date.now()
  if (now - hour.start >= HOUR) hour = { start: now, count: 0 }
  let u = users.get(caller)
  if (!u || u.resetAt <= now) {
    u = { count: 0, resetAt: now + DAY }
    users.set(caller, u)
  }
  if (u.count >= PER_USER)
    return { ok: false, note: `AI step skipped: the public demo allows ${PER_USER} AI checks per visitor per day. This result uses rules, RTB rents and reports only.` }
  if (hour.count >= PER_HOUR)
    return { ok: false, note: 'AI step skipped: the public demo reached its hourly AI limit. This result uses rules, RTB rents and reports only.' }
  u.count += 1
  hour.count += 1
  if (users.size > 50_000) for (const [k, v] of users) if (v.resetAt <= now) users.delete(k)
  return { ok: true }
}
