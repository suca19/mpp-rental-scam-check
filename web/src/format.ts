export const eur = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `€${Math.round(n).toLocaleString('en-IE')}`

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const shortRef = (ref: string) => (ref.length > 14 ? `${ref.slice(0, 8)}…${ref.slice(-4)}` : ref)

export const amount = (n: number) => n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

export const bedLabel = (b?: string) =>
  !b ? '' : b === 'all' ? 'all sizes' : b === '4plusbed' ? '4+ bed' : b.replace(/bed$/, '-bed')
