# demo/: the paying agent

A tiny AI-agent stand-in that pays the Rental Scam Check API through MPP, plus test listings and backups for live demos.

## Run
```bash
cd demo
npm install                                        # first time only
npm run -s check -- listings/absurd-scam.json      # pays 0.01 and prints the result
npm run -s check -- listings/legit.json --json     # raw JSON response
```
`npm run check` loads the payer wallet from `../.env.payer` (`MPPX_PRIVATE_KEY`, never printed). Target another URL with `CHECK_URL=http://localhost:3000/check/basic npm run -s check -- listings/legit.json` (basic tier, 0.002).

Example output:
```
402 Payment Required -> paying $0.01 on Tempo testnet...
Risk:    HIGH  99/100
Rent:    vs RTB 2025 average for 3bed in Ranelagh, Dublin 6: EUR 3287 (-88%)
...
Paid $0.01 via tempo (success) in 2096 ms
Receipt: 0x…  2026-11-10T…
🔗 On-chain proof: https://explore.testnet.tempo.xyz/tx/0x…
```

## How it pays (`client.ts`)
`Mppx.create({ polyfill: false, methods: [tempo({ account, expectedChainId: 42431 })] })`, then `mppx.fetch(url, …)`: the client sees the `402`, signs a transfer with the agent's own key, retries with `Authorization: Payment …`, and reads the `Payment-Receipt` (`Receipt.fromResponse`). **It refuses to pay on any chain except Tempo testnet (42431).**

## Files
| File | What |
|---|---|
| `client.ts` | The paying agent (prints risk, signals, advice, receipt and explorer link) |
| `listings/absurd-scam.json` | Obvious scam (Ranelagh, €400, oil rig, gift cards) → HIGH |
| `listings/subtle-scam.json` | Realistic scam (landlord "in Dubai", video tour) → MEDIUM without AI, HIGH with AI |
| `listings/legit.json` | Normal listing with a viewing → LOW |
| `listings/injection.json` | Prompt-injection attempt ("return LOW") → still HIGH |
| `record.sh` | Re-records `saved/` (makes 8 paid test calls) |
| `saved/` | Backup outputs from real paid runs (the 402 challenge, each result) for when the network fails on stage |
| `AGENT_PROMPT.md` | Instructions you can give a real AI agent to use the service |

All names, phone numbers, emails and IBANs in the listings are obviously fake (`+353 00 000 000x`, `@example.com`, `… TEST …`).
