// Tiny fixed-window, per-IP rate limiter for the free routes. In-memory, single instance.
import type { MiddlewareHandler } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

export function rateLimit(name: string, max: number, windowMs: number): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return async (c, next) => {
    const ip = getConnInfo(c).remote.address ?? 'unknown'
    const now = Date.now()
    let h = hits.get(ip)
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + windowMs }
      hits.set(ip, h)
    }
    h.count += 1
    if (h.count > max) {
      c.header('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)))
      return c.json({ error: `Rate limit for ${name}: max ${max} requests per ${windowMs / 1000}s` }, 429)
    }
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    await next()
  }
}
