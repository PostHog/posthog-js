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
// The probe also runs with `collectFeedback: true`: the virtual send_feedback
// tool must appear on exactly the first page (a compliant client concatenates
// every page, so a per-page append duplicates it — and the first page is the
// one every client reads), and calling it must return the acknowledgement
// instead of reaching a real handler.
//
// A second, colliding catalogue puts a real send_feedback on the first page:
// the SDK must not inject its own, and the real owner must keep its calls.
// Collisions are only detected on the first page — a real owner on a later
// page is the host's responsibility, fixed by renaming the SDK's tool with
// `collectFeedback: { toolName }`.
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

const FEEDBACK_ARGS = { feedback_type: 'praise', summary: 'Probe feedback.' }

const REAL_FEEDBACK_TOOL = [
  { name: 'send_feedback', description: 'A real application tool that owns the name', inputSchema: { type: 'object' } },
]

/** The first page owns the virtual tool's name, so the SDK must not inject its own. */
const collidingListPage = (cursor) =>
  cursor === 'page-2' ? { tools: PAGE_TWO } : { tools: REAL_FEEDBACK_TOOL, nextCursor: 'page-2' }

/** Page one hands out an empty-string cursor, which the spec calls valid. */
const emptyCursorListPage = (cursor) => (cursor === '' ? { tools: PAGE_TWO } : { tools: PAGE_ONE, nextCursor: '' })

const feedbackCount = (page) => page?.tools?.filter((t) => t.name === 'send_feedback').length ?? -1

/** Read as "no cursor", the empty string puts the virtual tool on both pages. */
function assertEmptyCursor(label, firstPage, secondPage) {
  check(
    `${label} · empty-string cursor · send_feedback is listed once, on the first page`,
    feedbackCount(firstPage) === 1 && feedbackCount(secondPage) === 0,
    JSON.stringify({
      pageOne: firstPage?.tools?.map((t) => t.name),
      pageTwo: secondPage?.tools?.map((t) => t.name),
    })
  )
}

/** The assertions, identical on both majors — only the transport differs. */
function assertEnumeration(label, firstPage, secondPage, callText, feedbackCallText) {
  check(`${label} · page one keeps nextCursor`, firstPage?.nextCursor === 'page-2', String(firstPage?.nextCursor))
  check(
    `${label} · page two is reachable`,
    secondPage?.tools?.some((t) => t.name === 'page_two_tool') === true,
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
  check(
    `${label} · send_feedback appears only on the first page, once`,
    feedbackCount(firstPage) === 1 && feedbackCount(secondPage) === 0,
    JSON.stringify({ pageOne: feedbackCount(firstPage), pageTwo: feedbackCount(secondPage) })
  )
  check(
    `${label} · a send_feedback call returns the acknowledgement`,
    /feedback was recorded/.test(feedbackCallText ?? ''),
    feedbackCallText?.slice(0, 120)
  )
}

/**
 * The colliding-catalogue assertions: the real first-page owner blocks
 * injection everywhere, and a send_feedback call must reach the real handler,
 * not the acknowledgement.
 */
function assertCollision(label, pages, feedbackCallText) {
  check(
    `${label} · colliding catalogue · only the real send_feedback is listed, on the first page`,
    feedbackCount(pages[0]) === 1 && feedbackCount(pages[1]) === 0,
    JSON.stringify(pages.map((page) => page?.tools?.map((t) => t.name)))
  )
  check(
    `${label} · colliding catalogue · the real owner keeps its calls`,
    /called: send_feedback/.test(feedbackCallText ?? ''),
    feedbackCallText?.slice(0, 160)
  )
}

// ── v1, low-level, in-memory ────────────────────────────────────────────────
async function callTool(client, name, args) {
  try {
    const result = await client.request(
      { method: 'tools/call', params: { name, arguments: args } },
      CallToolResultSchema
    )
    return JSON.stringify(result)
  } catch (error) {
    return `error: ${error}`
  }
}

async function connectV1(listHandler, recorder) {
  const server = new V1Server({ name: 'probe-v1', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async (request) => listHandler(request.params?.cursor))
  server.setRequestHandler(CallToolRequestSchema, async (request) => callResult(request.params.name))
  instrument(server, recorder.client, { logger: recorder.logger, collectFeedback: true })

  const client = new Client({ name: 'probe', version: '1.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return {
    client,
    async cleanup() {
      await clientTransport.close?.()
      await serverTransport.close?.()
    },
  }
}

async function listBothPagesV1(client) {
  const firstPage = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
  const secondPage = await client.request(
    { method: 'tools/list', params: { cursor: firstPage.nextCursor } },
    ListToolsResultSchema
  )
  return [firstPage, secondPage]
}

async function probeV1() {
  console.log('\nv1 · low-level · paginated catalogue')
  const recorder = createRecorder('probe:pagination:v1')
  const { client, cleanup } = await connectV1(listPage, recorder)
  try {
    const [firstPage, secondPage] = await listBothPagesV1(client)
    const callText = await callTool(client, 'page_two_tool', {})
    const feedbackCallText = await callTool(client, 'send_feedback', FEEDBACK_ARGS)
    assertEnumeration('v1', firstPage, secondPage, callText, feedbackCallText)
  } finally {
    await cleanup()
  }
}

async function probeCollisionV1() {
  console.log('\nv1 · low-level · colliding paginated catalogue')
  const recorder = createRecorder('probe:pagination:collision:v1')
  const { client, cleanup } = await connectV1(collidingListPage, recorder)
  try {
    const pages = await listBothPagesV1(client)
    const feedbackCallText = await callTool(client, 'send_feedback', FEEDBACK_ARGS)
    assertCollision('v1', pages, feedbackCallText)
  } finally {
    await cleanup()
  }
}

async function probeEmptyCursorV1() {
  console.log('\nv1 · low-level · catalogue paginated by an empty-string cursor')
  const recorder = createRecorder('probe:pagination:empty-cursor:v1')
  const { client, cleanup } = await connectV1(emptyCursorListPage, recorder)
  try {
    const [firstPage, secondPage] = await listBothPagesV1(client)
    assertEmptyCursor('v1', firstPage, secondPage)
  } finally {
    await cleanup()
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

const postFeedbackCall = (port) =>
  post(
    port,
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'send_feedback', arguments: FEEDBACK_ARGS, _meta: MODERN_META },
    },
    { 'mcp-method': 'tools/call', 'mcp-name': 'send_feedback' }
  )

/** A per-request factory: a fresh instrumented instance serves every request. */
async function startV2(listHandler, recorder) {
  const handler = createMcpHandler(
    () => {
      const server = new V2Server({ name: 'probe-v2', version: '1.0.0' }, { capabilities: { tools: {} } })
      server.setRequestHandler('tools/list', async (request) => listHandler(request.params?.cursor))
      server.setRequestHandler('tools/call', async (request) => callResult(request.params.name))
      instrument(server, recorder.client, { logger: recorder.logger, collectFeedback: true })
      return server
    },
    { responseMode: 'json', onerror: (e) => recorder.logger(`handler error: ${e}`) }
  )
  const node = toNodeHandler(handler)
  const http = createServer((req, res) => node(req, res)).listen(0)
  await sleep(300)
  return {
    port: http.address().port,
    async cleanup() {
      http.close()
      await sleep(150)
    },
  }
}

async function listBothPagesV2(port) {
  const first = await post(
    port,
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: MODERN_META } },
    { 'mcp-method': 'tools/list' }
  )
  const second = await post(
    port,
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { cursor: first.result?.nextCursor, _meta: MODERN_META } },
    { 'mcp-method': 'tools/list' }
  )
  return [first, second]
}

async function probeV2() {
  console.log('\nv2 · low-level · per-request · modern era · paginated catalogue')
  const recorder = createRecorder('probe:pagination:v2')
  const { port, cleanup } = await startV2(listPage, recorder)
  try {
    const [first, second] = await listBothPagesV2(port)
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
    const feedbackCall = await postFeedbackCall(port)
    await sleep(200)
    assertEnumeration('v2', first.result, second.result, call.text, feedbackCall.text)
  } finally {
    await cleanup()
  }
}

async function probeCollisionV2() {
  console.log('\nv2 · low-level · per-request · colliding paginated catalogue')
  const recorder = createRecorder('probe:pagination:collision:v2')
  const { port, cleanup } = await startV2(collidingListPage, recorder)
  try {
    const [first, second] = await listBothPagesV2(port)
    const feedbackCall = await postFeedbackCall(port)
    await sleep(200)
    assertCollision('v2', [first.result, second.result], feedbackCall.text)
  } finally {
    await cleanup()
  }
}

async function probeEmptyCursorV2() {
  console.log('\nv2 · low-level · per-request · catalogue paginated by an empty-string cursor')
  const recorder = createRecorder('probe:pagination:empty-cursor:v2')
  const { port, cleanup } = await startV2(emptyCursorListPage, recorder)
  try {
    const [first, second] = await listBothPagesV2(port)
    await sleep(200)
    assertEmptyCursor('v2', first.result, second.result)
  } finally {
    await cleanup()
  }
}

const MAJOR = (() => {
  const i = process.argv.indexOf('--major')
  return i === -1 ? 'all' : process.argv[i + 1]
})()

if (MAJOR !== 'v2') {
  await probeV1()
  await probeCollisionV1()
  await probeEmptyCursorV1()
}
if (MAJOR !== 'v1') {
  await probeV2()
  await probeCollisionV2()
  await probeEmptyCursorV2()
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
