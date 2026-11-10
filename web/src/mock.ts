// Sample events for rehearsing the dashboard without the server: open /?mock
export const MOCK_EVENTS = [
  {
    time: Date.now() - 4000, area: 'Dublin 6', rent: 400, risk: 'HIGH', score: 87,
    paid_amount: 0.01, receipt_ref: '0x9f3a1c7be2d04411aa', currency: 'pathUSD',
    signals: [
      { id: 'rent_far_below_average', severity: 'high', message: 'Rent is 84% below the RTB 2025 average for a 3-bed in Dublin (county) (€2,567).', source: 'RTB / CSO RIA02' },
      { id: 'landlord_abroad', severity: 'high', message: "Landlord says they are abroad and can't show the property.", source: 'Garda accommodation fraud advice' },
    ],
    rent_comparison: { requested_area: 'Dublin 6', compared_with: 'Dublin (county)', bedrooms: '3bed', rtb_average_eur: 2567, difference_pct: -84, period: '2025' },
    reported_matches: [{ field: 'iban', reports: 3 }],
    advice: 'Do not pay a deposit before viewing in person.',
  },
  {
    time: Date.now() - 60000, area: 'Galway City', rent: 1100, risk: 'MEDIUM', score: 42,
    paid_amount: 0.01, receipt_ref: '0x41be09d2ff7a3c90', currency: 'pathUSD',
    rent_comparison: { requested_area: 'Galway City', compared_with: 'Galway City', bedrooms: '2bed', rtb_average_eur: 1720, difference_pct: -36, period: '2025' },
  },
  {
    time: Date.now() - 180000, area: 'Rathmines', rent: 2100, risk: 'LOW', score: 8,
    paid_amount: 0.01, receipt_ref: '0x7c2d55e01a9b6f12', currency: 'pathUSD',
  },
]
