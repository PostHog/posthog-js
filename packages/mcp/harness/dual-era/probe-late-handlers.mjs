// Late-registration probe — the case the matrix does not cover.
//
// Both servers in the matrix register `tools/list` / `tools/call` BEFORE
// instrument(), so the synthetic `tools/call` fallback path never runs there.
// This probe registers them AFTER — the mcp-nest / adapter shape — on both SDK
// majors, and asserts instrument() stayed quiet and the late-registered
// dispatcher was still instrumented.
//
//   node probe-late-handlers.mjs                 both majors
//   node probe-late-handlers.mjs --major v1|v2  one major (what each CI lane runs,
//                                                so a red probe names the stack)
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { Server as V1Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema as V1CallToolRequestSchema,
  ListToolsRequestSchema as V1ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { Server as V2Server, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { instrument } from '@posthog/mcp'
import { TOOLS, TOOL_BY_NAME } from './shared/tools.mjs'
import { createRecorder } from './shared/posthog.mjs'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${name}${detail ? `  ${detail}` : ''}`)
}

const listHandler = async () => ({
  tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema })),
})
const callHandler = async (request) => {
  const tool = TOOL_BY_NAME[request.params.name]
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`)
  return tool.handler(request.params.arguments ?? {})
}

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'probe', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

async function post(port, body, headers = {}) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text, sessionId: res.headers.get('mcp-session-id') }
}

// ── v2, low-level, handlers registered after instrument() ───────────────────
async function probeV2() {
  console.log('\nv2 low-level · handlers registered AFTER instrument() · modern era')
  const recorder = createRecorder('probe:v2')
  const handler = createMcpHandler(
    () => {
      const server = new V2Server({ name: 'probe-v2', version: '1.0.0' }, { capabilities: { tools: {} } })
      instrument(server, recorder.client, { logger: recorder.logger })
      server.setRequestHandler('tools/list', listHandler)
      server.setRequestHandler('tools/call', callHandler)
      return server
    },
    { responseMode: 'json', onerror: (e) => recorder.logger(`handler error: ${e}`) }
  )
  const node = toNodeHandler(handler)
  const http = createServer((req, res) => node(req, res)).listen(0)
  await sleep(300)
  const port = http.address().port
  try {
    const call = await post(
      port,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'hi' }, _meta: MODERN_META },
      },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'echo' }
    )
    await sleep(200)

    check('instrument() logged no warning', recorder.warnings.length === 0, recorder.warnings.join(' | '))
    check('tool call answered', call.status === 200 && call.text.includes('hi'), `HTTP ${call.status}`)
    const calls = recorder.events.filter((e) => e.event === '$mcp_tool_call')
    check('$mcp_tool_call captured', calls.length === 1, `got ${calls.length}`)
    check(
      'tool name recorded',
      calls[0]?.properties?.$mcp_tool_name === 'echo',
      String(calls[0]?.properties?.$mcp_tool_name)
    )
  } finally {
    http.close()
    await sleep(150)
  }
}

// ── v1, low-level, no tools capability declared ─────────────────────────────
// PR 1 stops routing the fallback through setRequestHandler, which asserted the
// capability. This is the behaviour change it carries; it must not break v1.
async function probeV1NoCapability() {
  console.log('\nv1 low-level · server declares NO tools capability')
  const recorder = createRecorder('probe:v1-nocap')
  const server = new V1Server({ name: 'probe-v1', version: '1.0.0' }, { capabilities: {} })
  instrument(server, recorder.client, { logger: recorder.logger })
  check('instrument() logged no warning', recorder.warnings.length === 0, recorder.warnings.join(' | '))
  check('tools/call fallback registered', server._requestHandlers.has('tools/call'))
}

// ── v1, low-level, handlers registered after instrument() ───────────────────
async function probeV1Late() {
  console.log('\nv1 low-level · handlers registered AFTER instrument() · legacy era')
  const recorder = createRecorder('probe:v1-late')
  const server = new V1Server({ name: 'probe-v1-late', version: '1.0.0' }, { capabilities: { tools: {} } })
  instrument(server, recorder.client, { logger: recorder.logger })
  server.setRequestHandler(V1ListToolsRequestSchema, listHandler)
  server.setRequestHandler(V1CallToolRequestSchema, callHandler)

  // Stateful, like servers/v1.mjs: the transport mints Mcp-Session-Id and the
  // client replays it. Sessions are v1's model; this probe is about handler
  // registration order, so it uses the transport the way v1 intends.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const http = createServer((req, res) => transport.handleRequest(req, res)).listen(0)
  await sleep(300)
  const port = http.address().port
  try {
    const init = await post(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'probe', version: '1.0.0' },
      },
    })
    const session = init.sessionId ? { 'mcp-session-id': init.sessionId } : {}
    const call = await post(
      port,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'hi' } },
      },
      session
    )
    await sleep(200)

    check('instrument() logged no warning', recorder.warnings.length === 0, recorder.warnings.join(' | '))
    check(
      'tool call answered',
      call.status === 200 && call.text.includes('hi'),
      `HTTP ${call.status} ${call.text.slice(0, 200)}`
    )
    const calls = recorder.events.filter((e) => e.event === '$mcp_tool_call')
    check('$mcp_tool_call captured', calls.length === 1, `got ${calls.length}`)
  } finally {
    http.close()
    await sleep(150)
  }
}

const MAJOR = (() => {
  const i = process.argv.indexOf('--major')
  return i === -1 ? 'all' : process.argv[i + 1]
})()

if (MAJOR !== 'v2') {
  await probeV1NoCapability()
  await probeV1Late()
}
if (MAJOR !== 'v1') {
  await probeV2()
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
