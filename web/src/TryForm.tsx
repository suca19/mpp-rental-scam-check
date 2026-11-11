import { useState, type FormEvent } from 'react'
import { parseCheckResult, type CheckResult } from './types'
import { Matches, RentLine, RiskBadge, SignalList } from './components'
import { EXAMPLES, type FormFields } from './examples'

// Posts to the FREE, unpaid demo route. No wallet or private key in the browser.
const DEMO_URL = '/api/demo-check'

const EMPTY: FormFields = { title: '', description: '', rent: '', area: '', bedrooms: '', iban: '', viewing: false }

// Paid route (added 10 Nov): the SERVER acts as the agent with the testnet wallet and pays /check.
const AGENT_URL = '/api/agent-check'

type AgentStep = { step: string; detail: string; ms: number }
type Exchange = {
  n: number
  method: string
  path: string
  status: number
  ms: number
  request_headers: Record<string, string>
  response_headers: Record<string, string>
  decoded: Record<string, unknown>
}
type Tier = 'full' | 'basic'
const TIERS: Record<Tier, { label: string; price: string; note: string }> = {
  full: { label: 'Full check', price: '€0.01', note: 'rules + RTB + reports + AI' },
  basic: { label: 'Basic check', price: '€0.002', note: 'rules + RTB + reports, no AI' },
}
type Payment = {
  amount: string
  token: string
  chain_id: number | null
  from: string
  to: string
  receipt_status: string
  tx_hash: string
  explorer_url: string | null
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; paid: boolean }
  | { kind: 'done'; result: CheckResult; steps?: AgentStep[]; payment?: Payment; exchanges?: Exchange[] }
  | { kind: 'error'; message: string; steps?: AgentStep[]; exchanges?: Exchange[] }

/** MPP inspector: the real HTTP exchanges the agent made, with decoded MPP headers. */
function Inspector({ exchanges }: { exchanges: Exchange[] }) {
  return (
    <details className="inspector" open>
      <summary>🔍 MPP inspector: the real HTTP exchanges</summary>
      {exchanges.map((e) => (
        <div key={e.n} className="exchange">
          <p className="exchange-line">
            <b>#{e.n}</b> {e.method} {e.path}
            {e.request_headers['Authorization'] ? ' + Authorization: Payment' : ''} →{' '}
            <span className={e.status === 402 ? 'st-402' : e.status === 200 ? 'st-200' : 'st-other'}>
              {e.status === 402 ? '402 Payment Required' : e.status === 200 ? '200 OK' : e.status}
            </span>{' '}
            <span className="payflow-ms">{e.ms} ms</span>
          </p>
          {Object.entries({ ...e.request_headers, ...e.response_headers }).map(([k, v]) => (
            <p key={k} className="header-line">
              <span className="header-name">{k}:</span> {v}
            </p>
          ))}
          {Object.entries(e.decoded).map(([k, v]) => (
            <div key={k}>
              <p className="decoded-label">
                decoded {k === 'challenge' ? 'challenge (the price tag)' : k === 'credential' ? 'credential (the signed payment)' : 'receipt (the proof)'}:
              </p>
              <pre className="decoded">{JSON.stringify(v, null, 2)}</pre>
            </div>
          ))}
        </div>
      ))}
    </details>
  )
}

const STEP_ICON: Record<string, string> = { request: '📨', challenge: '💳', sign: '✍️', receipt: '🧾' }
const EXPLORER_OK = /^https:\/\/explore\.testnet\.tempo\.xyz\/tx\/0x[0-9a-fA-F]{64}$/

export function TryForm({ onUnavailable }: { onUnavailable: () => void }) {
  const [f, setF] = useState<FormFields>(EMPTY)
  const [picked, setPicked] = useState<string | null>(null)
  const [tier, setTier] = useState<Tier>('full')
  const fill = (id: string) => {
    const ex = EXAMPLES.find((x) => x.id === id)
    if (!ex) return
    setF({ ...ex.fields })
    setPicked(id)
    setStatus({ kind: 'idle' })
  }
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value })

  function submit(ev: FormEvent) {
    ev.preventDefault()
    // Which button submitted the form? "Pay as the agent" carries data-paid="1".
    const submitter = (ev.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    void run(submitter?.dataset.paid === '1')
  }

  async function run(paid: boolean) {
    setStatus({ kind: 'loading', paid })
    const body: Record<string, unknown> = {
      description: f.description,
      monthly_rent_eur: Number(f.rent),
      area: f.area,
      viewing_offered: f.viewing,
    }
    if (f.title.trim()) body.title = f.title.trim()
    if (f.bedrooms.trim()) body.bedrooms = Number(f.bedrooms)
    if (f.iban.trim()) body.contact = { iban: f.iban.trim() }
    try {
      const res = await fetch(paid ? `${AGENT_URL}${tier === 'basic' ? '?tier=basic' : ''}` : DEMO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 404 && !paid) {
        onUnavailable()
        return
      }
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      const steps = Array.isArray(data?.steps) ? (data.steps as AgentStep[]) : undefined
      const exchanges = Array.isArray(data?.exchanges) ? (data.exchanges as Exchange[]) : undefined
      if (!res.ok) {
        const msg = data && 'error' in data ? String(data.error) : ''
        setStatus({
          kind: 'error',
          steps,
          exchanges,
          message: msg || (res.status >= 500 ? 'Server is offline or failed.' : `Request failed (${res.status}).`),
        })
        return
      }
      const result = parseCheckResult(paid ? data?.result : data)
      if (!result) throw new Error('Unexpected response from server.')
      setStatus({ kind: 'done', result, steps, exchanges, payment: paid ? (data?.payment as Payment) : undefined })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Request failed.' })
    }
  }

  const rentNum = Number(f.rent)
  return (
    <section className="panel try" aria-label="Try a listing">
      <div className="panel-head">
        <h2>Try a listing</h2>
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            setF(EMPTY)
            setPicked(null)
            setStatus({ kind: 'idle' })
          }}
        >
          Clear
        </button>
      </div>
      <p className="muted small">Free demo route, no payment. Agents pay €0.01 per call on /check.</p>
      <div className="examples" role="group" aria-label="Fill an example listing">
        <span className="muted small">Fill example:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className={`ghost small example-btn${picked === ex.id ? ' active' : ''}`}
            onClick={() => fill(ex.id)}
            title={`Expected: ${ex.expected}`}
          >
            {ex.label}
          </button>
        ))}
      </div>
      {picked && (
        <p className="muted small">Expected result: {EXAMPLES.find((x) => x.id === picked)?.expected}</p>
      )}
      <form onSubmit={submit}>
        <label>
          Title
          <input value={f.title} onChange={set('title')} maxLength={200} />
        </label>
        <label>
          Description *
          <textarea value={f.description} onChange={set('description')} required rows={4} maxLength={5000} />
        </label>
        <div className="row">
          <label>
            Rent €/month *
            <input type="number" min={0} value={f.rent} onChange={set('rent')} required />
          </label>
          <label>
            Area *
            <input value={f.area} onChange={set('area')} required placeholder="Dublin 6, Galway City…" />
          </label>
          <label className="narrow">
            Beds
            <input type="number" min={0} max={10} value={f.bedrooms} onChange={set('bedrooms')} />
          </label>
        </div>
        <div className="row">
          <label>
            IBAN (optional)
            <input value={f.iban} onChange={set('iban')} maxLength={40} />
          </label>
          <label className="check">
            <input type="checkbox" checked={f.viewing} onChange={(e) => setF({ ...f, viewing: e.target.checked })} />
            Viewing offered
          </label>
        </div>
        <div className="tiers" role="radiogroup" aria-label="Which paid check the agent buys">
          {(Object.keys(TIERS) as Tier[]).map((t) => (
            <label key={t} className={`tier${tier === t ? ' active' : ''}`}>
              <input type="radio" name="tier" value={t} checked={tier === t} onChange={() => setTier(t)} />
              <b>{TIERS[t].label}</b> {TIERS[t].price} <span className="muted small">({TIERS[t].note})</span>
            </label>
          ))}
        </div>
        <div className="row buttons">
          <button type="submit" className="ghost" disabled={status.kind === 'loading'}>
            {status.kind === 'loading' && !status.paid ? 'Checking…' : 'Check free (no payment)'}
          </button>
          <button type="submit" data-paid="1" className="primary" disabled={status.kind === 'loading'}>
            {status.kind === 'loading' && status.paid ? 'Agent is paying…' : `🤖 Pay as the agent (${TIERS[tier].price})`}
          </button>
        </div>
      </form>
      {status.kind === 'loading' && status.paid && (
        <p className="muted small">The agent is asking, getting a 402, paying on Tempo testnet and retrying (about 3–6 s)…</p>
      )}
      {(status.kind === 'done' || status.kind === 'error') && status.steps && status.steps.length > 0 && (
        <div className="payflow" aria-label="How the payment happened">
          <h3>How the agent paid</h3>
          <ol>
            {status.steps.map((s, i) => (
              <li key={i}>
                <span className="payflow-icon" aria-hidden>{STEP_ICON[s.step] ?? '•'}</span>
                <span>{s.detail}</span>
                <span className="payflow-ms">{s.ms} ms</span>
              </li>
            ))}
          </ol>
          {status.kind === 'done' && status.payment && (
            <p className="payflow-proof">
              💰 {status.payment.amount} {status.payment.token} moved from the agent’s wallet{' '}
              <code>{status.payment.from.slice(0, 8)}…</code> to yours <code>{status.payment.to.slice(0, 8)}…</code>{' '}
              (receipt: {status.payment.receipt_status}).{' '}
              {status.payment.explorer_url && EXPLORER_OK.test(status.payment.explorer_url) && (
                <a className="explorer-link" href={status.payment.explorer_url} target="_blank" rel="noopener noreferrer">
                  🔗 See the transaction on the Tempo testnet explorer
                </a>
              )}
            </p>
          )}
        </div>
      )}
      {(status.kind === 'done' || status.kind === 'error') && status.exchanges && status.exchanges.length > 0 && (
        <Inspector exchanges={status.exchanges} />
      )}
      {status.kind === 'error' && <p className="error">{status.message}</p>}
      {status.kind === 'done' && (
        <div className="result">
          <RiskBadge risk={status.result.risk} score={status.result.score} big />
          <RentLine rent={Number.isFinite(rentNum) ? rentNum : null} rc={status.result.rent_comparison} />
          <SignalList signals={status.result.signals} />
          <Matches matches={status.result.reported_matches ?? []} />
          {status.result.advice && <p className="advice">{status.result.advice}</p>}
          {status.result.ai_note && <p className="muted small">ℹ️ {status.result.ai_note}</p>}
        </div>
      )}
    </section>
  )
}
