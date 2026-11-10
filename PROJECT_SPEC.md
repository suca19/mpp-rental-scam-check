# Project spec: Rental Scam Check (idea J)

> The single source of truth that every project agent builds against. Last updated: 2026-11-09 (server built; contract additions marked **[added 9 Nov]**).
> **Rule:** before 10 Nov we only prepare (environment, data, demo content, this spec). The service code is written **during the 90 minutes**.

## One-line pitch
*"Before your agent helps you send a rental deposit, it pays €0.01 for facts it can't know: official RTB rent data and shared scam reports."*

## Decisions
| Topic | Decision |
|---|---|
| Language | TypeScript, Node 20+ |
| Payments | `mppx` (server + client + CLI), Tempo **testnet** (`testnet: true`). By default it charges in test **OUSD** (pathUSD is also offered). Reuse the proven setup in `sandbox/hello-mpp/server.ts` |
| Server | **Hono** + `@hono/node-server` (mppx handlers use the web-standard `Request`/`Response`, and Hono does too) |
| AI | **Google Gemini** (`gemini-2.5-flash`, free tier, plain `fetch`) when `GEMINI_API_KEY` is set **[changed 9 Nov]**; otherwise Claude via `@anthropic-ai/sdk` (`claude-haiku-5-5` → `claude-sonnet-5-5`). Keys in `.env` |
| Frontend | **React + Vite** dashboard (TypeScript) |
| Data | RTB average rents (CSO RIA02, CC BY 4.0) → `data/rents.json`. Garda scam patterns → `data/scam-signals.json` |
| Wording | "risk signals", **never** "this is a scam". Every response carries a disclaimer |

## Folder layout
```
server/            Hono + mppx paid API (port 3000)
  src/index.ts     routes + mppx setup
  src/rules.ts     rule-based signals (deterministic)
  src/llm.ts       Claude call: extracts text signals ONLY from a fixed list
  src/rents.ts     RTB lookup
  src/reports.ts   shared scam reports (in-memory + JSON file)
  src/events.ts    in-memory event log for the dashboard
web/               React + Vite dashboard (port 5173, proxies /api → 3000)
data/              rents.json, scam-signals.json, SOURCES.md
demo/              listings/*.json, client script, DEMO.md (the 30-second scene)
.env               MPP_SECRET_KEY, MPP_RECIPIENT, RECEIVER_PRIVATE_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY (never committed)
```

## API contract

### `POST /check` (paid, price `0.01`; mppx on testnet offers OUSD first, then pathUSD, and `npx mppx` pays in OUSD)
Request body:
```json
{
  "title": "Stunning 3-bed in Ranelagh",
  "description": "free text of the listing",
  "monthly_rent_eur": 400,
  "area": "Dublin 6",
  "bedrooms": 3,
  "contact": { "phone": "+353...", "email": "...", "iban": "IE..." },
  "viewing_offered": false
}
```
Only `description`, `monthly_rent_eur` and `area` are required.
**[added 9 Nov]** The body is validated (zod) **before** the payment middleware: bad input gets `400 {"error": "..."}` and is never charged. Body limit 32 KB.

Response `200` (+ `Payment-Receipt` header):
```json
{
  "risk": "HIGH",
  "score": 87,
  "signals": [
    { "id": "rent_far_below_average", "severity": "high",
      "message": "Rent is 84% below the RTB 2025 average for a 3-bed in Dublin (county) (€2,567).",
      "source": "RTB / CSO RIA02" },
    { "id": "landlord_abroad", "severity": "high",
      "message": "Landlord says they are abroad and can't show the property.",
      "source": "Garda accommodation fraud advice" }
  ],
  "rent_comparison": { "requested_area": "Dublin 6", "compared_with": "Dublin (county)",
                       "bedrooms": "3bed", "rtb_average_eur": 2567, "difference_pct": -84, "period": "2025" },
  "reported_matches": [ { "field": "iban", "reports": 3 } ],
  "advice": "Do not pay a deposit before viewing in person.",
  "disclaimer": "Automated risk signals, not a verdict. Prototype."
}
```
**[added 9 Nov] Extra response fields** (additive, the shape above is unchanged):
- `"llm": "ok" | "unavailable" | "disabled"` (unavailable = the AI call (Gemini or Claude) failed or took > 5 s, so the result is rules-only; disabled = no API key)
- each signal also has `detected_by` (`"rule"` | `"llm"`), optional `source_url`, and optional `evidence` (matched phrase or verbatim quote)
- `rent_comparison.note` explains fallbacks (e.g. postal district → county). `rent_comparison` is `null` if the area isn't in the RTB data
- shared-report hits appear as signal id `reported_contact` (severity high, one per matched field)
- score formula: `100 * (1 - Π(1 - w))`, w = 0.4 high / 0.2 medium (1 high = 40, 2 = 64, 4 = 87)

Scoring: **rules decide the score**. The LLM only says which items from the fixed signal list appear in the text. It never sets the score and never writes free-form verdicts. This is the prompt-injection defence.

Risk bands: `LOW` < 30 ≤ `MEDIUM` < 60 ≤ `HIGH`.

**Rent lookup (from the data check, 2026-11-09):** RIA02 has **no Dublin postal-district totals after 2021**, only neighbourhoods (e.g. "Rathmines, Dublin 6"). The lookup order is:
1. Match the area through `aliases` (case-insensitive) to an exact entry in `areas`, such as a neighbourhood, town or county.
2. If it's a postal district (`postal_districts[...]`), use its `fallback` (the **Dublin county** average).
3. Pick the bedroom column if known (`1bed`, `2bed`, `3bed`, `4plusbed`); otherwise use `all`.
4. Always say which area was actually used (`compared_with`). Flag only if the rent is **≥ 45% below** the average. The county fallback is coarse: it over-flags cheap districts and under-flags expensive ones.

Data files (ready): `data/rents.json` (2025 annual, 340 areas), `data/scam-signals.json` (12 signals; `detection: "text"` → LLM picks, `"rule"` → code), `data/SOURCES.md` (attribution).

### `POST /report` (free, rate-limited)
`{ "phone"?, "email"?, "iban"?, "note"? }` adds the identifiers to the shared scam-report list. Stored hashed (SHA-256) so the raw data is never kept.
**[added 9 Nov]** At least one of phone/email/iban is required. Normalised before hashing (email lowercased, IBAN uppercased without spaces, phone digits only with Irish `0…` → `353…`). The `note` is accepted but **not stored**. Rate limit 10/min per IP (`429`). Response: `{ "ok": true, "recorded": [{ "field": "iban", "reports": 3 }], "stored": "SHA-256 hashes only" }`. Persisted in `data/reports.json`.

### `POST /api/demo-check` (free, rate-limited) **[added 9 Nov]**
Same body, same logic and same response as `/check` (plus `"demo": true`), but **no payment**. It exists so the web dashboard's form works without a wallet in the browser. Rate limit 10/min per IP (`429`). Its events have `demo: true`, `paid_amount: 0`, `currency: "none"`, `receipt_ref: "demo-<uuid>"`. Not listed in `/openapi.json`.

### `GET /api/events` (free)
Server-Sent Events stream for the dashboard: one event per check (`time, area, rent, risk, score, paid_amount, receipt_ref`). No listing text or contact details in events.
**[added 9 Nov]** On connect the server sends `event: backlog` with a JSON array of the last ≤100 events, then `event: check` (with SSE `id`) per new check, plus a `: keep-alive` comment every 15 s. Each event also has `id` (uuid), `currency` (`"OUSD"`/`"pathUSD"` from the receipt, `"none"` for demo), `demo` (bool), `llm`, `signals` as `{id, severity, message, source}` (**no evidence quotes**), `rent_comparison`, `reported_matches` (`{field, reports}` counts only) and `advice`. `paid_amount` is a number (`0.01`, or `0` for demo); `receipt_ref` is the Tempo tx hash from `Payment-Receipt`. `time` is ISO 8601.

### `GET /health` (free)
`{ "ok": true }`

### `GET /openapi.json` (free) **[added 9 Nov]**
mppx discovery document: the paid `/check` route, its offers, and the request body JSON schema + example. `npx mppx validate http://localhost:3000` passes 28/0.

## Demo scene (30 seconds)
1. Claude Code is asked: *"Help me rent this flat. The landlord wants the deposit today."*
2. It calls `POST /check` through `npx mppx`, which returns **402**. It pays $0.01 and retries.
3. Dashboard: a new row appears, **HIGH 87**, with a payment received.
4. The agent answers: *"Don't send the deposit: rent 84% below the RTB average for Dublin, landlord 'abroad', IBAN reported 3 times."*

## Stretch goals (only if time is left)
- MCP tool wrapper so the agent sees `check_rental_listing` in its tool list
- Reverse image search on the listing photos
- Deploy online + list on mpp.dev/services (after the event)

### `POST /check/basic` (paid, price `0.002`) **[added 10 Nov]**
Same body and response as `/check`, plus `"tier": "basic"`; skips the AI step (`"llm": "disabled"`). Cheaper and faster, for agents screening many listings. `/check` responses now carry `"tier": "full"`.

### `POST /api/agent-check[?tier=basic]` (free for the caller, the SERVER pays) **[added 10 Nov]**
Dashboard demo: the server acts as the agent with the testnet payer wallet and pays `/check` (or `/check/basic`) via real MPP. Returns `{ ok, steps[], exchanges[], result, payment }`. `exchanges` = the recorded HTTP exchanges (MPP inspector) with decoded challenge offers / credential / receipt. Rate-limited 6/min, localhost only.
