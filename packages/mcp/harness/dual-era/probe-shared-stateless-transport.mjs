// Probe: one stateless transport reused across clients, on the SDK v2 floor.
//
// @modelcontextprotocol/server 2.0.0 (our peer floor) lets a host reuse one
// stateless StreamableHTTP transport for every client; 2.3 rejects that. On
// such a transport, any session id left on it makes the next `initialize` fail
// with "Server already initialized" and echoes on every later response. So the
// token minted at `initialize` must reach that one response and nothing else,
// while a per-request transport still hands its client a token.
//
//   node probe-shared-stateless-transport.mjs
import { McpServer, WebStandardStreamableHTTPServerTransport } from 'mcp-server-v2-0'
import { instrument } from '@posthog/mcp'
import { decodeSessionId } from '../../dist/extensions/session-token.mjs'
import { createRecorder } from './shared/posthog.mjs'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${name}${detail ? `  ${detail}` : ''}`)
}

async function connectedServer(instrumented) {
  const server = new McpServer({ name: 'probe', version: '1.0.0' })
  if (instrumented) {
    instrument(server, createRecorder('shared').client, { logger: () => {} })
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport
}

async function post(transport, body) {
  const response = await transport.handleRequest(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify(body),
    })
  )
  return { status: response.status, token: decodeSessionId(response.headers.get('mcp-session-id')) }
}

const initialize = (transport, clientName) =>
  post(transport, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: clientName, version: '1.0.0' } },
  })

console.log('shared stateless transport, @modelcontextprotocol/server 2.0.0')

const bare = await connectedServer(false)
const bareStatuses = [(await initialize(bare, 'client-a')).status, (await initialize(bare, 'client-b')).status]
check(
  'baseline: 2.0.0 accepts two clients on one uninstrumented transport',
  bareStatuses.join() === '200,200',
  bareStatuses.join()
)

const shared = await connectedServer(true)
const a = await initialize(shared, 'client-a')
const b = await initialize(shared, 'client-b')
check('instrumented: the second client still initializes', b.status === 200, `status ${b.status}`)
check(
  'each initialize response carries its own client token',
  a.token?.clientName === 'client-a' && b.token?.clientName === 'client-b',
  `${a.token?.clientName} / ${b.token?.clientName}`
)
const list = await post(shared, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
check(
  "a later response echoes no client's token",
  list.status === 200 && list.token === null,
  `status ${list.status} cn=${list.token?.clientName}`
)

const perRequest = await initialize(await connectedServer(true), 'client-c')
check(
  'per-request transport: initialize still hands back a token',
  perRequest.token?.clientName === 'client-c',
  `cn=${perRequest.token?.clientName}`
)

const failed = results.filter((r) => !r.ok).length
console.log(
  failed === 0 ? `${GREEN}all ${results.length} checks passed${RESET}` : `${RED}${failed} check(s) failed${RESET}`
)
process.exit(failed === 0 ? 0 : 1)
