// tools/list envelope probe — the case no fixture in this harness covered.
//
// MCP paginates tools/list. A server whose catalogue spans pages returns page one
// plus a `nextCursor`, and the client enumerates until the cursor is absent. Our
// listing wrapper injects the analytics parameters into the advertised schemas and
// — before the fix — returned a freshly built `{ tools }`, dropping every other
// field the application's handler had put on the response.
//
// So the client saw no cursor, stopped after page one, and every tool on a later
// page became uncallable the moment instrument() was applied. No error on either
// side: the client believes it has the whole catalogue.
//
// This is the SDK removing behaviour the customer's server produced, which is why
// it needs a fixture of its own — the matrix asserts on captured events, and a
// catalogue that fits on one page can never show the loss. The same reason applies
// to `ttlMs` / `cacheScope` (the caching SEP-2549 added on 2026-07-28) and to
// result `_meta`: all three ride the same envelope.
//
// Both majors, because the defect is in our wrapper and not in either SDK.
//
//   node probe-pagination.mjs
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server as V1Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { Server as V2Server, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { instrument } from '@posthog/mcp'
import { createRecorder } from './shared/posthog.mjs'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${name}${detail ? `  ${detail}` : ''}`)
}

const PAGE_ONE = [{ name: 'page_one_tool', description: 'On page one', inputSchema: { type: 'object' } }]
const PAGE_TWO = [{ name: 'page_two_tool', description: 'On page two', inputSchema: { type: 'object' } }]

/** Page one advertises the cursor and the 2026 cache directives; page two ends the enumeration. */
const listPage = (cursor) =>
  cursor === 'page-2'
    ? { tools: PAGE_TWO }
    : {
        tools: PAGE_ONE,
        nextCursor: 'page-2',
        ttlMs: 60_000,
        cacheScope: 'public',
        _meta: { 'com.posthog/probe': 'kept' },
      }

const callResult = (name) => ({ content: [{ type: 'text', text: `called: ${name}` }] })

/** The four assertions, identical on both majors — only the transport differs. */
function assertEnumeration(label, firstPage, secondPage, callText) {
  check(`${label} · page one keeps nextCursor`, firstPage?.nextCursor === 'page-2', String(firstPage?.nextCursor))
  check(
    `${label} · page two is reachable`,
    secondPage?.tools?.length === 1 && secondPage.tools[0].name === 'page_two_tool',
    JSON.stringify(secondPage?.tools?.map((t) => t.name))
  )
  // Enumeration is only worth anything if the tools it reaches are callable.
  check(`${label} · a page-two tool can be called`, /called: page_two_tool/.test(callText ?? ''))
  check(
    `${label} · cache directives and result _meta survive`,
    firstPage?.ttlMs === 60_000 &&
      firstPage?.cacheScope === 'public' &&
      firstPage?._meta?.['com.posthog/probe'] === 'kept',
    JSON.stringify({ ttlMs: firstPage?.ttlMs, cacheScope: firstPage?.cacheScope, _meta: firstPage?._meta })
  )
}

// ── v1, low-level, in-memory ────────────────────────────────────────────────
async function probeV1() {
  console.log('\nv1 · low-level · paginated catalogue')
  const recorder = createRecorder('probe:pagination:v1')
  const server = new V1Server({ name: 'probe-v1', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async (request) => listPage(request.params?.cursor))
  server.setRequestHandler(CallToolRequestSchema, async (request) => callResult(request.params.name))
  instrument(server, recorder.client, { logger: recorder.logger })

  const client = new Client({ name: 'probe', version: '1.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    const firstPage = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    const secondPage = await client.request(
      { method: 'tools/list', params: { cursor: firstPage.nextCursor } },
      ListToolsResultSchema
    )
    let callText = ''
    try {
      const result = await client.request(
        { method: 'tools/call', params: { name: 'page_two_tool', arguments: {} } },
        CallToolResultSchema
      )
      callText = JSON.stringify(result)
    } catch (error) {
      callText = `error: ${error}`
    }
    assertEnumeration('v1', firstPage, secondPage, callText)
  } finally {
    await clientTransport.close?.()
    await serverTransport.close?.()
  }
}

// ── v2, low-level, per-request factory, modern era, raw JSON-RPC ────────────
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
      'mcp-protocol-version': '2026-07-28',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { text, result: JSON.parse(text)?.result }
}

async function probeV2() {
  console.log('\nv2 · low-level · per-request · modern era · paginated catalogue')
  const recorder = createRecorder('probe:pagination:v2')
  const handler = createMcpHandler(
    () => {
      const server = new V2Server({ name: 'probe-v2', version: '1.0.0' }, { capabilities: { tools: {} } })
      server.setRequestHandler('tools/list', async (request) => listPage(request.params?.cursor))
      server.setRequestHandler('tools/call', async (request) => callResult(request.params.name))
      instrument(server, recorder.client, { logger: recorder.logger })
      return server
    },
    { responseMode: 'json', onerror: (e) => recorder.logger(`handler error: ${e}`) }
  )
  const node = toNodeHandler(handler)
  const http = createServer((req, res) => node(req, res)).listen(0)
  await sleep(300)
  const port = http.address().port
  try {
    const first = await post(
      port,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: MODERN_META },
      },
      { 'mcp-method': 'tools/list' }
    )
    const second = await post(
      port,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: { cursor: first.result?.nextCursor, _meta: MODERN_META },
      },
      { 'mcp-method': 'tools/list' }
    )
    const call = await post(
      port,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'page_two_tool', arguments: {}, _meta: MODERN_META },
      },
      { 'mcp-method': 'tools/call', 'mcp-name': 'page_two_tool' }
    )
    await sleep(200)
    assertEnumeration('v2', first.result, second.result, call.text)
  } finally {
    http.close()
    await sleep(150)
  }
}

const MAJOR = (() => {
  const i = process.argv.indexOf('--major')
  return i === -1 ? 'all' : process.argv[i + 1]
})()

if (MAJOR !== 'v2') await probeV1()
if (MAJOR !== 'v1') await probeV2()

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
