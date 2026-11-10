# web/: Rental Scam Check dashboard (React + Vite)

The "shop window" of the paid API: it shows every check live, and lets you run a real paid check from the browser and watch the MPP payment happen.

## Run
```bash
cd web
npm install          # first time only
npm run dev          # http://localhost:5173
```
The API server must be running on port 3000 (see [`../server/README.md`](../server/README.md)). The Vite dev server proxies `/api`, `/check` and `/health` to `http://localhost:3000`, so the browser talks to one address and no CORS setup is needed. Point it elsewhere with `API_TARGET=http://host:port npm run dev`.

- `http://localhost:5173/?mock`: sample data, no server needed (rehearsal or backup).
- `npm run build`: type-check + production build into `dist/`. `npm run lint`: Oxlint.

## What it shows

**Live feed** (`useEvents.ts`): listens to `GET /api/events` (Server-Sent Events) and reconnects by itself if the server drops. Each check is a card with area, rent, % vs the RTB average, a risk badge (LOW / MEDIUM / HIGH + score), and either "+0.01 OUSD received" with a receipt, or "free demo check". The header counts paid checks, money earned and high-risk results. Clicking a card opens the details: signals with sources, shared-report matches, advice, the full receipt and a **🔗 link to the transaction on the Tempo testnet explorer**.

**Try a listing** (`TryForm.tsx`):
- **Fill example** buttons: Absurd scam, Subtle scam, Legit listing, Injection attack (`examples.ts`, same listings as `demo/listings/`, all contact data fake).
- **Basic (€0.002, no AI) / Full (€0.01, with AI)** price choice.
- **Check free (no payment)** → `POST /api/demo-check`.
- **🤖 Pay as the agent** → `POST /api/agent-check`: the server acts as the agent with the testnet wallet (no key in the browser) and pays through real MPP. The form then shows:
  - a **"How the agent paid"** timeline: 📨 request → 💳 402 → ✍️ sign → 🧾 receipt, plus a 🔗 explorer link,
  - the **🔍 MPP inspector**: the real HTTP exchanges with the decoded `WWW-Authenticate` challenge (both offers, the chosen one marked), the `Authorization: Payment` credential and the `Payment-Receipt`.

**Footer:** the disclaimer ("Automated risk signals, not a verdict. Prototype.") and the RTB / CSO CC BY 4.0 data credit.

## Safety
- Everything is rendered as text (no `dangerouslySetInnerHTML`); explorer links are only built from a validated 64-hex transaction hash.
- No wallet, private key or API key is ever in the browser bundle.

## Files
`src/App.tsx` (layout, header stats, footer) · `src/useEvents.ts` (SSE + reconnect) · `src/components.tsx` (cards, badges, detail panel, explorer link) · `src/TryForm.tsx` (form, tiers, payment timeline, MPP inspector) · `src/examples.ts` · `src/types.ts` · `src/format.ts` · `src/mock.ts` · `src/App.css` · `vite.config.ts` (dev proxy)
