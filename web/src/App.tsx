import { useMemo, useState } from 'react'
import './App.css'
import { useEvents } from './useEvents'
import { EventCard, Detail } from './components'
import { TryForm } from './TryForm'
import { MOCK_EVENTS } from './mock'
import { amount } from './format'

const isMock = new URLSearchParams(window.location.search).has('mock')

export default function App() {
  const { events, state, freshKey } = useEvents('/api/events', isMock ? MOCK_EVENTS : [])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [demoAvailable, setDemoAvailable] = useState(true)
  const [showTry, setShowTry] = useState(false)

  const paid = useMemo(() => events.filter((e) => !e.demo), [events])
  const earned = useMemo(() => paid.reduce((s, e) => s + e.paidAmount, 0), [paid])
  const currency = paid[0]?.currency ?? 'pathUSD'
  const highCount = useMemo(() => events.filter((e) => e.risk === 'HIGH').length, [events])
  const selected = events.find((e) => e.key === selectedKey) ?? null

  const conn =
    state === 'live'
      ? { cls: 'live', text: 'Live' }
      : state === 'connecting'
        ? { cls: 'wait', text: 'Connecting…' }
        : { cls: 'down', text: 'Server offline, reconnecting…' }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Rental Scam Check</h1>
          <p className="tagline">AI agents pay €0.01 per check via MPP · Tempo testnet</p>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="stat-num">{paid.length}</span>
            <span className="stat-label">paid checks</span>
          </div>
          <div className="stat">
            <span className="stat-num earned">{amount(earned)}</span>
            <span className="stat-label">{currency} earned</span>
          </div>
          <div className="stat">
            <span className="stat-num high">{highCount}</span>
            <span className="stat-label">high risk</span>
          </div>
          <span className={`conn conn-${conn.cls}`} role="status">
            <span className="dot" /> {conn.text}
          </span>
        </div>
      </header>

      <main className={`layout${selected || showTry ? ' with-side' : ''}`}>
        <section className="feed" aria-label="Live feed">
          <div className="feed-head">
            <h2>Live checks</h2>
            {demoAvailable && (
              <button type="button" className="ghost" onClick={() => { setShowTry((v) => !v); setSelectedKey(null) }}>
                {showTry ? 'Close form' : 'Try a listing'}
              </button>
            )}
          </div>
          {events.length === 0 ? (
            <div className="empty">
              <div className="pulse" />
              <p className="empty-title">Waiting for agents…</p>
              <p className="muted">
                Each paid <code>POST /check</code> appears here in real time.
                {state !== 'live' && ' (The server is not reachable yet.)'}
              </p>
            </div>
          ) : (
            <ul className="cards">
              {events.map((e) => (
                <EventCard
                  key={e.key}
                  e={e}
                  fresh={e.key === freshKey}
                  selected={e.key === selectedKey}
                  onSelect={() => { setSelectedKey(e.key === selectedKey ? null : e.key); setShowTry(false) }}
                />
              ))}
            </ul>
          )}
        </section>

        {selected ? (
          <Detail e={selected} onClose={() => setSelectedKey(null)} />
        ) : (
          showTry && demoAvailable && <TryForm onUnavailable={() => { setDemoAvailable(false); setShowTry(false) }} />
        )}
      </main>

      <footer className="footer">
        <p className="disclaimer">Automated risk signals, not a verdict. Prototype.</p>
        <p>
          Rent data: Residential Tenancies Board (RTB), <em>RTB Average Monthly Rent Report</em> (CSO PxStat table
          RIA02, 2025), licensed under{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            CC BY 4.0
          </a>
          . Values rounded to the nearest euro; we changed the format but not the figures.
        </p>
        <p>
          Risk signals are based on public advice from An Garda Síochána (GNECB), the CCPC, Threshold and the University
          of Galway Accommodation Advisory Service, and are not endorsed by those organisations.
        </p>
      </footer>
    </div>
  )
}
