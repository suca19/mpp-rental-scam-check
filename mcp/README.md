# mcp/: let an AI agent pay for checks by itself (MCP)

An [MCP](https://modelcontextprotocol.io) server that gives an AI agent such as **Claude Code** one tool, **`check_rental_listing`**. The tool carries the agent's **testnet wallet**: when the agent calls it, the tool calls the paid Rental Scam Check API, receives the `402` price tag, **pays it via MPP** (mppx client, Tempo testnet) and returns the risk result with the payment receipt and an explorer link.

The agent decides when to call the tool; the tool pays. The private key never goes to the model: it stays in `../.env.payer`.

## Use it from Claude Code
1. Start the API server (`../server`, port 3000).
2. Open Claude Code **in the repo root**. The project file [`../.mcp.json`](../.mcp.json) registers the server; approve **rental-scam-check** when Claude Code asks (check with `/mcp`).
3. Ask, for example:
   > *Help me rent this flat: demo/listings/absurd-scam.json. The landlord wants the deposit today. Should I pay?*

   Claude Code calls `check_rental_listing` (it asks your permission first, since the tool spends money), pays 0.01, and answers with the risk, the reasons, and the transaction link.

## Tool
`check_rental_listing({ description, monthly_rent_eur, area, title?, bedrooms?, viewing_offered?, contact?: { phone?, email?, iban? }, tier?: "full" | "basic" })`
- `full` (default): 0.01, includes the AI reading of the text. `basic`: 0.002, no AI.
- Returns text: RESULT (risk, score), rent vs the RTB average, signals with sources, shared-report matches, advice, then the PAYMENT steps (402 → signed → 200 + receipt) and the on-chain proof link.

## Safety
- **Testnet only:** the mppx client refuses any chain but Tempo testnet (42431).
- **Spending limit:** at most `RSC_MAX_PAID_CALLS` (default 25) paid calls per server run.
- **Local API only:** refuses a non-localhost `RSC_API_URL` unless `RSC_ALLOW_REMOTE=1`.
- Logs go to stderr only (stdout is the MCP channel); the key is never printed.

## Test without Claude Code
```bash
cd mcp
npm install                                         # first time only
npm test                                            # lists tools, makes ONE paid full check (absurd scam)
npx tsx test-client.ts ../demo/listings/legit.json basic
```

## Files
`server.ts` (the MCP server and tool) · `test-client.ts` (connects over stdio like Claude Code does) · `package.json` (`@modelcontextprotocol/sdk`, `mppx`, `viem`, `zod`, `tsx`)
