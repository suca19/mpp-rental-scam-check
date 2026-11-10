import { useEffect, useRef, useState } from 'react'
import { normalize, type CheckEvent } from './types'

export type ConnState = 'connecting' | 'live' | 'reconnecting'

const MAX_EVENTS = 200

/**
 * Subscribes to GET /api/events (SSE). If the server is down, the Vite proxy
 * answers 502/504 and EventSource gives up (readyState CLOSED), so we retry
 * ourselves with backoff. Duplicate events (e.g. a backlog replayed after a
 * reconnect) are dropped by key.
 */
export function useEvents(url = '/api/events', seed: unknown[] = []) {
  const [events, setEvents] = useState<CheckEvent[]>([])
  const [state, setState] = useState<ConnState>('connecting')
  const [freshKey, setFreshKey] = useState<string | null>(null)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let stopped = false

    const add = (items: CheckEvent[]) => {
      const fresh = items.filter((e) => {
        const k = e.receiptRef ? `r:${e.receiptRef}` : e.key
        if (seen.current.has(k)) return false
        seen.current.add(k)
        return true
      })
      if (!fresh.length) return
      fresh.sort((a, b) => b.time - a.time)
      setEvents((prev) => [...fresh, ...prev].sort((a, b) => b.time - a.time).slice(0, MAX_EVENTS))
      setFreshKey(fresh[0].key)
    }

    const onData = (ev: MessageEvent) => {
      try {
        const data: unknown = JSON.parse(String(ev.data))
        const list = Array.isArray(data) ? data : [data]
        add(list.map(normalize).filter((e): e is CheckEvent => e !== null))
      } catch {
        /* ignore keep-alives / non-JSON */
      }
    }

    const connect = () => {
      if (stopped) return
      es = new EventSource(url)
      es.onopen = () => {
        attempt = 0
        setState('live')
      }
      es.onmessage = onData
      // Accept named events too, whichever name the server picks.
      for (const name of ['check', 'event', 'snapshot', 'backlog']) es.addEventListener(name, onData)
      es.onerror = () => {
        setState('reconnecting')
        if (es && es.readyState === EventSource.CLOSED) {
          es.close()
          const delay = Math.min(1000 * 2 ** attempt, 10000)
          attempt++
          timer = setTimeout(connect, delay)
        }
      }
    }

    if (seed.length) add(seed.map(normalize).filter((e): e is CheckEvent => e !== null))
    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      es?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return { events, state, freshKey }
}
