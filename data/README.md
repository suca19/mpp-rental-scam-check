# data/: the facts the agent pays for

Small files the server loads at start-up. Sources, licences and the required credit text are in [`SOURCES.md`](SOURCES.md).

| File | What | Source / licence |
|---|---|---|
| `rents.json` | RTB 2025 average monthly rents for 340 Irish areas (counties, towns, Dublin neighbourhoods), by bedrooms (`all`, `1bed`, `2bed`, `3bed`, `4plusbed`), plus `aliases` (e.g. "D6" → "Dublin 6") and `postal_districts` (which fall back to the Dublin county figure) | RTB / CSO PxStat table RIA02, **CC BY 4.0** (credit required) |
| `scam-signals.json` | The fixed list of 12 rental-scam signals (`id`, `severity`, `detection` = `"text"` for the AI or `"rule"` for code, description, example phrases, source URL) | Paraphrased from An Garda Síochána, CCPC, Threshold, University of Galway advice; not endorsed by them |
| `SOURCES.md` | Every source with URL, licence, date checked and the attribution text | — |
| `scripts/build-rents.mjs` | Rebuilds `rents.json` from the raw CSO download | — |
| `reports.json` | Created at runtime by `POST /report`: SHA-256 hashes of reported phones / emails / IBANs. Not committed | — |
| `raw/` | Raw CSO downloads (~9 MB). Not committed; re-download as below | CC BY 4.0 |

## Rebuild the rent data
```bash
mkdir -p data/raw
curl -s 'https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/JSON-stat/2.0/en' -o data/raw/RIA02.json
node data/scripts/build-rents.mjs
```

## Known limits
- RIA02 has **no Dublin postal-district totals after 2021**, only neighbourhoods inside them; a district like "Dublin 6" is compared with the Dublin county average (the API says so in `compared_with`).
- Figures are 2025 annual averages across property types, not current asking prices. Good for a "far below average" signal, not for precise pricing.
- Missing values are left out, never estimated.
