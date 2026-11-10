import type { CheckEvent, Risk, RentComparison, ReportedMatch, Signal } from './types'
import { amount, bedLabel, clock, eur, shortRef } from './format'

export function RiskBadge({ risk, score, big }: { risk: Risk; score: number; big?: boolean }) {
  return (
    <span className={`badge badge-${risk.toLowerCase()}${big ? ' badge-big' : ''}`}>
      <span className="badge-risk">{risk}</span>
      <span className="badge-score">{Math.round(score)}</span>
    </span>
  )
}

export function comparedText(rc: RentComparison | null | undefined): string {
  if (!rc?.compared_with) return ''
  const beds = bedLabel(rc.bedrooms)
  return `vs RTB ${rc.period ?? ''} average${beds ? ` (${beds})` : ''} for ${rc.compared_with}`.replace(/\s+/g, ' ')
}

export function RentLine({ rent, rc }: { rent: number | null; rc: RentComparison | null | undefined }) {
  const diff = rc?.difference_pct
  return (
    <div className="rent-line">
      <span className="rent">{eur(rent)}<small>/month</small></span>
      {rc?.compared_with && (
        <span className="compare">
          {diff !== undefined && (
            <strong className={diff <= -45 ? 'diff diff-bad' : 'diff'}>
              {diff > 0 ? '+' : ''}
              {Math.round(diff)}%
            </strong>
          )}{' '}
          {comparedText(rc)}
          {rc.rtb_average_eur !== undefined && <> ({eur(rc.rtb_average_eur)})</>}
        </span>
      )}
    </div>
  )
}

export function EventCard({
  e,
  selected,
  fresh,
  onSelect,
}: {
  e: CheckEvent
  selected: boolean
  fresh: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        className={`card card-${e.risk.toLowerCase()}${selected ? ' selected' : ''}${fresh ? ' fresh' : ''}`}
        onClick={onSelect}
        aria-pressed={selected}
      >
        <div className="card-main">
          <div className="card-top">
            <span className="time">{clock(e.time)}</span>
            <span className="area">{e.area}</span>
          </div>
          <RentLine rent={e.rent} rc={e.rentComparison} />
        </div>
        <RiskBadge risk={e.risk} score={e.score} />
        <div className="payment">
          {e.demo ? (
            <span className="pay pay-demo">free demo check</span>
          ) : (
            <span className="pay">
              +{amount(e.paidAmount)} {e.currency} received
            </span>
          )}
          {e.receiptRef && (
            <span className="receipt" title={e.receiptRef}>
              receipt {shortRef(e.receiptRef)}
            </span>
          )}
        </div>
      </button>
    </li>
  )
}

// The Payment-Receipt reference is the Tempo transaction hash (verified 10 Nov via eth_getTransactionReceipt).
const EXPLORER_TX = 'https://explore.testnet.tempo.xyz/tx/'
const TX_HASH = /^0x[0-9a-fA-F]{64}$/

export function SignalList({ signals }: { signals: Signal[] }) {
  if (!signals.length) return <p className="muted">No risk signals found.</p>
  return (
    <ul className="signals">
      {signals.map((s, i) => (
        <li key={`${s.id}-${i}`} className={`signal sev-${(s.severity || 'low').toLowerCase()}`}>
          <span className="sev">{s.severity || 'info'}</span>
          <div>
            <p>{s.message}</p>
            {s.source && <p className="source">Source: {s.source}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Matches({ matches }: { matches: ReportedMatch[] }) {
  if (!matches.length) return null
  return (
    <ul className="matches">
      {matches.map((m, i) => (
        <li key={`${m.field}-${i}`}>
          <strong>{m.field.toUpperCase()}</strong> reported {m.reports} time{m.reports === 1 ? '' : 's'} by other users
        </li>
      ))}
    </ul>
  )
}

export function Detail({ e, onClose }: { e: CheckEvent; onClose: () => void }) {
  const hasDetail = e.signals.length > 0 || e.reportedMatches.length > 0 || !!e.advice
  return (
    <section className="panel detail" aria-label="Check details">
      <div className="panel-head">
        <h2>{e.area}</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </div>
      <RiskBadge risk={e.risk} score={e.score} big />
      <RentLine rent={e.rent} rc={e.rentComparison} />
      {e.rentComparison?.requested_area && e.rentComparison.compared_with &&
        e.rentComparison.requested_area !== e.rentComparison.compared_with && (
          <p className="muted small">
            No RTB figure for “{e.rentComparison.requested_area}”, so the {e.rentComparison.compared_with} average was used.
          </p>
        )}
      {hasDetail ? (
        <>
          <h3>Signals</h3>
          <SignalList signals={e.signals} />
          <Matches matches={e.reportedMatches} />
          {e.advice && <p className="advice">{e.advice}</p>}
        </>
      ) : (
        <p className="muted">
          Summary only: the event stream carries the score, not the listing or its signals (privacy by design).
        </p>
      )}
      <dl className="meta">
        <dt>Time</dt>
        <dd>{new Date(e.time).toLocaleString('en-IE')}</dd>
        <dt>Payment</dt>
        <dd>{e.demo ? 'Free demo check (unpaid)' : `${amount(e.paidAmount)} ${e.currency} via MPP`}</dd>
        {e.receiptRef && (
          <>
            <dt>Receipt</dt>
            <dd className="mono">{e.receiptRef}</dd>
            {TX_HASH.test(e.receiptRef) && (
              <>
                <dt>On-chain</dt>
                <dd>
                  <a
                    className="explorer-link"
                    href={`${EXPLORER_TX}${e.receiptRef}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    🔗 View this payment on the Tempo testnet explorer
                  </a>
                </dd>
              </>
            )}
          </>
        )}
      </dl>
    </section>
  )
}
