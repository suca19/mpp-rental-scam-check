# server/: Rental Scam Check API (Hono + mppx)

Paid API: an agent pays **0.01** (full check, with AI) or **0.002** (basic check, no AI) on Tempo **testnet** (the 402 offers OUSD and pathUSD; the agent picks one) to get **risk signals** for an Irish rental listing.
The server listens on **127.0.0.1:3000** only (set `HOST=0.0.0.0` to expose it on purpose) and prints one log line per request (method, path, payment proof yes/no, status, risk; never listing text or contacts).
Contract: [../PROJECT_SPEC.md](../PROJECT_SPEC.md). Secrets come from `../.env` (`MPP_SECRET_KEY`, `MPP_RECIPIENT`, `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`).

## Run
```bash
cd /home/carlos/hackathons/stripe/server
npm install            # first time only
npx tsx watch src/index.ts      # or: npm run dev   -> http://localhost:3000
```
If both AI keys are empty (Gemini is used when `GEMINI_API_KEY` is set, else Claude) or the call fails/times out (5 s), checks still work rules-only and say `"llm": "unavailable"` (or `"disabled"`).

## Routes
| Route | Paid? | What |
|---|---|---|
| `POST /check` | 0.01 via MPP | Full check: rules + RTB + reports + AI text signals. Response has `"tier": "full"`. Body is validated **before** the 402, so malformed requests get `400` and are never charged |
| `POST /check/basic` | 0.002 via MPP | Basic check: same body, no AI step (`"llm": "disabled"`, `"tier": "basic"`). Cheaper and faster |
| `POST /api/demo-check` | free, 10/min per IP | Same logic as `/check`, unpaid, for the dashboard form (no wallet in the browser). Events are marked `demo: true` |
| `POST /api/agent-check[?tier=basic]` | the server pays (testnet), 6/min | Built-in demo agent (`src/agent.ts`): uses the payer wallet from `../.env.payer` to pay this server's own `/check` (or `/check/basic`) through real MPP. Returns `steps` (request → 402 → sign → receipt), `exchanges` (the recorded HTTP exchanges with the decoded challenge offers, credential and receipt: the dashboard's MPP inspector), `result` and `payment` (tx hash, explorer link) |
| `POST /report` | free, 10/min per IP | `{phone?, email?, iban?, note?}`: stores SHA-256 hashes of the normalised values in `../data/reports.json`. The note is never stored |
| `GET /api/events` | free | SSE: `event: backlog` (JSON array) on connect, then `event: check` per check. No listing text, contact details or quotes |
| `GET /health` | free | `{"ok":true}` |
| `GET /openapi.json` | free | Discovery document (both paid routes, prices, body schema) |

## Try it
```bash
# 402 challenge (no payment)
curl -i -X POST http://localhost:3000/check -H 'content-type: application/json' -d @test/scam.json

# 400 before charging (bad input)
curl -i -X POST http://localhost:3000/check -H 'content-type: application/json' -d '{"description":"x"}'

# Pay and get the result (payer wallet + testnet RPC from ../.env.payer)
cd /home/carlos/hackathons/stripe && set -a && . ./.env.payer && set +a && cd server
npx mppx http://localhost:3000/check -i -J "$(cat test/scam.json)"     # HIGH
npx mppx http://localhost:3000/check -J "$(cat test/legit.json)"       # LOW
npx mppx http://localhost:3000/check/basic -J "$(cat test/scam.json)"  # basic tier, 0.002, no AI

# Seed shared reports (3x) for the demo listing's phone + IBAN (demo/listings/absurd-scam.json),
# then re-check that listing: adds "reported_contact". Delete ../data/reports.json first for a clean count.
bash test/seed-reports.sh

# Server-paid demo agent (what the dashboard's "Pay as the agent" button calls)
curl -s -X POST 'http://localhost:3000/api/agent-check?tier=basic' -H 'content-type: application/json' -d @test/legit.json

# Free demo route (what the dashboard form uses)
curl -s -X POST http://localhost:3000/api/demo-check -H 'content-type: application/json' -d @test/legit.json

# Watch events live
curl -N http://localhost:3000/api/events

# Protocol check: 53 passed, 0 failed (load ../.env.payer first)
npx mppx validate http://localhost:3000

# Offline test of the LLM output validator (no API call)
npx tsx test/llm-validate.ts
```

## How the score works
- **Rules decide the score.** Every signal has a severity; score = `100 * (1 - Π(1 - w))` with `w = 0.4` (high) and `0.2` (medium). One high gives 40, two give 64, four give 87. Bands: `LOW` < 30 ≤ `MEDIUM` < 60 ≤ `HIGH`.
- Rule signals: rent ≥ 45% below the RTB average (`rents.ts`, Dublin postal districts fall back to the county figure and say so in `compared_with` + `note`), `viewing_offered === false`, non-IE IBAN, keyword and phrase matches from `data/scam-signals.json`, contacts found in shared reports.
- **The AI** (Gemini `gemini-2.5-flash` if `GEMINI_API_KEY` is set; otherwise Claude `claude-haiku-5-5`, then `claude-sonnet-5-5`; 5 s total) only returns ids from the fixed `detection: "text"` list plus a verbatim quote. The listing goes inside random delimiter tags and is marked as untrusted. Output is checked against a JSON schema and the allowed ids, and each quote must really appear in the listing, otherwise the signal is dropped.
- Unknown area: `rent_comparison` is `null` and no rent signal is raised.

## Files
`src/index.ts` (routes + mppx, request log), `src/agent.ts` (built-in demo agent + MPP inspector recorder), `src/rules.ts`, `src/rents.ts`, `src/llm.ts`, `src/reports.ts`, `src/events.ts`, `src/schema.ts` (zod), `src/ratelimit.ts`, `src/paths.ts`. Test bodies are in `test/`.
