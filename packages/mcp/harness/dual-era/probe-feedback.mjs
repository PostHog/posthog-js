// send_feedback listing probe — the simple case, on real servers of both majors.
//
// A server instrumented with `collectFeedback: true` must advertise the virtual
// send_feedback tool in tools/list next to the application's own tools, with the
// descriptor agents key off: the two required fields, the enum'd feedback_type,
// and the read-only/idempotent annotations that make agents willing to call it.
// The unit suite proves this against the in-memory v1 server only; this probe
// proves it against a real server of each major (paginated catalogues have
// their own fixture in probe-pagination.mjs).
//
//   node probe-feedback.mjs
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server as V1Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
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

const APP_TOOLS = [{ name: 'app_tool', description: 'A real application tool', inputSchema: { type: 'object' } }]

/** The assertions, identical on both majors — only the transport differs. */
function assertListing(label, tools) {
  const names = tools?.map((t) => t.name) ?? []
  check(
    `${label} · send_feedback is advertised exactly once`,
    names.filter((n) => n === 'send_feedback').length === 1,
    JSON.stringify(names)
  )
  check(`${label} · the application tool is still advertised`, names.includes('app_tool'))

  const descriptor = tools?.find((t) => t.name === 'send_feedback')
  const required = descriptor?.inputSchema?.required
  check(
    `${label} · feedback_type and summary are the required fields`,
    Array.isArray(required) &&
      required.length === 2 &&
      required.includes('feedback_type') &&
      required.includes('summary'),
    JSON.stringify(required)
  )
  const properties = descriptor?.inputSchema?.properties ?? {}
  const core = [
    'feedback_type',
    'summary',
    'details',
    'friction_points',
    'suggested_improvement',
    'tool_name',
    'sentiment',
    'task_completed',
  ]
  check(
    `${label} · the core schema properties are advertised`,
    core.every((key) => key in properties),
    JSON.stringify(Object.keys(properties))
  )
  check(
    `${label} · feedback_type enumerates the four categories`,
    JSON.stringify(properties.feedback_type?.enum) ===
      JSON.stringify(['missing_capability', 'issue', 'praise', 'other'])
  )
  const annotations = descriptor?.annotations
  check(
    `${label} · annotations mark it read-only, idempotent, non-destructive`,
    annotations?.readOnlyHint === true &&
      annotations?.idempotentHint === true &&
      annotations?.destructiveHint === false,
    JSON.stringify(annotations)
  )
}

// ── v1, low-level, in-memory ────────────────────────────────────────────────
async function probeV1() {
  console.log('\nv1 · low-level · collectFeedback listing')
  const recorder = createRecorder('probe:feedback:v1')
  const server = new V1Server({ name: 'probe-v1', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: APP_TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: `called: ${request.params.name}` }],
  }))
  instrument(server, recorder.client, { logger: recorder.logger, collectFeedback: true })

  const client = new Client({ name: 'probe', version: '1.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    const listing = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    assertListing('v1', listing.tools)
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

async function probeV2() {
  console.log('\nv2 · low-level · per-request · modern era · collectFeedback listing')
  const recorder = createRecorder('probe:feedback:v2')
  const handler = createMcpHandler(
    () => {
      const server = new V2Server({ name: 'probe-v2', version: '1.0.0' }, { capabilities: { tools: {} } })
      server.setRequestHandler('tools/list', async () => ({ tools: APP_TOOLS }))
      server.setRequestHandler('tools/call', async (request) => ({
        content: [{ type: 'text', text: `called: ${request.params.name}` }],
      }))
      instrument(server, recorder.client, { logger: recorder.logger, collectFeedback: true })
      return server
    },
    { responseMode: 'json', onerror: (e) => recorder.logger(`handler error: ${e}`) }
  )
  const node = toNodeHandler(handler)
  const http = createServer((req, res) => node(req, res))
  await new Promise((resolve) => http.listen(0, resolve))
  const port = http.address().port
  try {
    // A transport or parse failure is a probe result, not a crash: report it
    // through `check` so the run still prints a legible tally and exits 1.
    let listing
    let failure
    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/list',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: MODERN_META } }),
      })
      listing = JSON.parse(await res.text())?.result
    } catch (error) {
      failure = String(error)
    }
    // No settle delay: every assertion below reads `listing`, which is already
    // resolved — this probe never inspects the recorder's captured events.
    check('v2 · the tools/list request returns a result', listing !== undefined, failure ?? '')
    if (listing) {
      assertListing('v2', listing.tools)
    }
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
