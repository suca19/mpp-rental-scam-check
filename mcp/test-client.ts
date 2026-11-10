// Tests the MCP server the way Claude Code uses it: start it over stdio, list tools, call the tool.
// Needs the API server running on http://127.0.0.1:3000. Each run makes ONE paid testnet call.
// Run from mcp/:  npm test            (or: npx tsx test-client.ts ../demo/listings/legit.json basic)
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync } from 'node:fs'

const file = process.argv[2] ?? '../demo/listings/absurd-scam.json'
const tier = (process.argv[3] ?? 'full') as 'full' | 'basic'

const transport = new StdioClientTransport({ command: 'npx', args: ['tsx', 'server.ts'], stderr: 'inherit' })
const client = new Client({ name: 'test-client', version: '0.0.1' })
await client.connect(transport)

const { tools } = await client.listTools()
console.log('Tools:', tools.map((t) => t.name).join(', '))

const listing = JSON.parse(readFileSync(file, 'utf8'))
const out = await client.callTool({ name: 'check_rental_listing', arguments: { ...listing, tier } })
const content = out.content as { type: string; text?: string }[]
console.log(out.isError ? 'TOOL ERROR:' : 'Tool result:')
console.log(content.map((c) => c.text ?? '').join('\n'))
await client.close()
