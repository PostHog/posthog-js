// MCP Apps compatibility probe.
//
// This is deliberately a wire-level fixture rather than a browser host. The
// server-facing contract that @posthog/mcp can affect is the tool/resource
// envelope: instrumenting must preserve the app URI, resource metadata,
// structured result, and result metadata while still capturing the tool call.
// Rendering and app-to-host postMessage traffic happen after these responses
// leave the server and belong in a host-side playground.
//
// Both eras run the same app shape:
//   - SDK v1 over an in-memory transport (2025-11-25)
//   - SDK v2 over real HTTP with raw 2026-07-28 JSON-RPC
//
//   node probe-mcp-apps.mjs
//   node probe-mcp-apps.mjs --major v1
//   node probe-mcp-apps.mjs --major v2
import { createServer as createHttpServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer as V1McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { McpServer as V2McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { instrument } from '@posthog/mcp'
import { z } from 'zod4'
import { createRecorder, handleInspectionRoute } from './shared/posthog.mjs'

const APP_TOOL = 'weather_app'
const APP_URI = 'ui://weather/app.html'
const APP_MIME_TYPE = 'text/html;profile=mcp-app'
const MODEL = 'probe-model-2026'
const CONTEXT = 'Showing an interactive weather result so the user can inspect the requested city forecast.'
const RESULT_META_KEY = 'com.posthog/probe-result'
const APP_HTML = '<!doctype html><html><body data-mcp-app="weather">Weather</body></html>'

const TOOL_META = {
  ui: { resourceUri: APP_URI },
  // MCP Apps 2026-01-26 prefers ui.resourceUri, while older hosts still read
  // the flat key. Real servers such as n8n publish both.
  'ui/resourceUri': APP_URI,
}
const RESOURCE_META = {
  ui: {
    prefersBorder: true,
    csp: { connectDomains: ['https://api.example.com'] },
  },
}

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${name}${detail ? `  ${detail}` : ''}`)
}

function registerWeatherApp(server) {
  server.registerTool(
    APP_TOOL,
    {
      title: 'Weather app',
      description: 'Shows a weather result in an MCP App.',
      inputSchema: { city: z.string() },
      _meta: TOOL_META,
    },
    async (args) => {
      const receivedKeys = Object.keys(args ?? {}).sort()
      return {
        content: [{ type: 'text', text: `Weather for ${String(args?.city)}` }],
        structuredContent: { city: args?.city, temperatureC: 22, receivedKeys },
        _meta: { [RESULT_META_KEY]: { kept: true } },
      }
    }
  )

  server.registerResource(
    'Weather app UI',
    APP_URI,
    {
      description: 'Interactive weather view.',
      mimeType: APP_MIME_TYPE,
      _meta: RESOURCE_META,
    },
    async () => ({
      contents: [
        {
          uri: APP_URI,
          mimeType: APP_MIME_TYPE,
          text: APP_HTML,
          _meta: RESOURCE_META,
        },
      ],
    })
  )
}

function instrumentApp(server, recorder) {
  registerWeatherApp(server)
  instrument(server, recorder.client, {
    captureModel: true,
    logger: recorder.logger,
  })
  return server
}

function assertAppFlow(label, { tools, call, resources, read, recorder, protocolVersion }) {
  const tool = tools?.tools?.find((candidate) => candidate.name === APP_TOOL)
  check(
    `${label} · app URI survives tools/list`,
    tool?._meta?.ui?.resourceUri === APP_URI && tool?._meta?.['ui/resourceUri'] === APP_URI,
    JSON.stringify(tool?._meta)
  )
  check(
    `${label} · model parameter is advertised`,
    tool?.inputSchema?.properties?.llm_model?.type === 'string' && tool?.inputSchema?.required?.includes('llm_model')
  )
  check(
    `${label} · structured result and _meta survive tools/call`,
    call?.structuredContent?.city === 'Berlin' && call?._meta?.[RESULT_META_KEY]?.kept === true,
    JSON.stringify({ structuredContent: call?.structuredContent, _meta: call?._meta })
  )
  check(
    `${label} · injected model never reaches the app handler`,
    JSON.stringify(call?.structuredContent?.receivedKeys) === JSON.stringify(['city']),
    JSON.stringify(call?.structuredContent?.receivedKeys)
  )

  const resource = resources?.resources?.find((candidate) => candidate.uri === APP_URI)
  check(
    `${label} · app metadata survives resources/list`,
    resource?.mimeType === APP_MIME_TYPE && resource?._meta?.ui?.prefersBorder === true,
    JSON.stringify(resource)
  )
  const content = read?.contents?.find((candidate) => candidate.uri === APP_URI)
  check(
    `${label} · app HTML and CSP survive resources/read`,
    content?.mimeType === APP_MIME_TYPE &&
      content?.text === APP_HTML &&
      content?._meta?.ui?.csp?.connectDomains?.[0] === 'https://api.example.com'
  )

  const event = recorder.events.find(
    (candidate) => candidate.event === '$mcp_tool_call' && candidate.properties?.$mcp_tool_name === APP_TOOL
  )
  check(
    `${label} · app tool call is captured with model`,
    event?.properties?.$mcp_llm_model === MODEL &&
      event?.properties?.$mcp_llm_model_source === 'self_reported' &&
      event?.properties?.$mcp_intent === CONTEXT &&
      event?.properties?.$mcp_protocol_version === protocolVersion,
    JSON.stringify({
      model: event?.properties?.$mcp_llm_model,
      source: event?.properties?.$mcp_llm_model_source,
      intent: event?.properties?.$mcp_intent,
      protocol: event?.properties?.$mcp_protocol_version,
    })
  )
  check(
    `${label} · captured response retains app result _meta`,
    event?.properties?.$mcp_response?._meta?.[RESULT_META_KEY]?.kept === true
  )
  check(`${label} · instrumentation reports no warnings`, recorder.warnings.length === 0, recorder.warnings.join('; '))

  const resourceEvents = recorder.events.filter((candidate) =>
    ['$mcp_resources_list', '$mcp_resource_read'].includes(candidate.event)
  )
  console.log(
    `  ${DIM}observed resource analytics events: ${resourceEvents.length} (tracking is a follow-up; this probe gates compatibility)${RESET}`
  )
}

async function probeV1() {
  console.log('\nv1 · high-level · legacy protocol · MCP App')
  const recorder = createRecorder('probe:apps:v1')
  const server = instrumentApp(new V1McpServer({ name: 'apps-v1', version: '1.0.0' }), recorder)
  const client = new Client(
    { name: 'apps-probe', version: '1.0.0' },
    {
      capabilities: {
        extensions: {
          'io.modelcontextprotocol/ui': { mimeTypes: [APP_MIME_TYPE] },
        },
      },
    }
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    const tools = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    const call = await client.request(
      {
        method: 'tools/call',
        params: { name: APP_TOOL, arguments: { city: 'Berlin', context: CONTEXT, llm_model: MODEL } },
      },
      CallToolResultSchema
    )
    const resources = await client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema)
    const read = await client.request({ method: 'resources/read', params: { uri: APP_URI } }, ReadResourceResultSchema)
    assertAppFlow('v1', { tools, call, resources, read, recorder, protocolVersion: '2025-11-25' })
  } finally {
    await clientTransport.close?.()
    await serverTransport.close?.()
  }
}

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'apps-probe', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {
    extensions: {
      'io.modelcontextprotocol/ui': { mimeTypes: [APP_MIME_TYPE] },
    },
  },
}

async function postModern(port, id, method, params, name) {
  const response = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(name ? { 'mcp-name': name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: { ...params, _meta: MODERN_META },
    }),
  })
  const body = await response.json()
  if (!response.ok || body.error) {
    throw new Error(`${method} failed (${response.status}): ${JSON.stringify(body.error ?? body)}`)
  }
  return body.result
}

async function probeV2() {
  console.log('\nv2 · high-level · per-request · 2026-07-28 · MCP App')
  const recorder = createRecorder('probe:apps:v2')
  const { http, port } = await startV2Server(recorder, 0)
  try {
    const tools = await postModern(port, 1, 'tools/list', {})
    const call = await postModern(
      port,
      2,
      'tools/call',
      { name: APP_TOOL, arguments: { city: 'Berlin', context: CONTEXT, llm_model: MODEL } },
      APP_TOOL
    )
    const resources = await postModern(port, 3, 'resources/list', {})
    const read = await postModern(port, 4, 'resources/read', { uri: APP_URI }, APP_URI)
    assertAppFlow('v2', { tools, call, resources, read, recorder, protocolVersion: '2026-07-28' })
  } finally {
    await closeServer(http)
  }
}

async function startV2Server(recorder, requestedPort) {
  const handler = createMcpHandler(
    () => instrumentApp(new V2McpServer({ name: 'apps-v2', version: '1.0.0' }), recorder),
    { responseMode: 'json', onerror: (error) => recorder.logger(`handler error: ${error}`) }
  )
  const nodeHandler = toNodeHandler(handler)
  const http = createHttpServer(async (request, response) => {
    if (handleInspectionRoute(request, response, recorder)) return
    await nodeHandler(request, response)
  })
  await new Promise((resolve) => http.listen(requestedPort, resolve))
  const port = http.address().port
  return { http, port }
}

async function closeServer(http) {
  await new Promise((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())))
}

async function servePlayground() {
  const recorder = createRecorder('playground:apps:v2')
  const requestedPort = Number(process.env.PORT ?? 3001)
  const { http, port } = await startV2Server(recorder, requestedPort)
  console.log(`MCP Apps playground listening at http://localhost:${port}/mcp`)
  console.log(`Captured events: http://localhost:${port}/__events`)
  console.log('Press Ctrl-C to stop.')

  await new Promise((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, resolve)
    }
  })
  await closeServer(http)
}

const major = (() => {
  const index = process.argv.indexOf('--major')
  return index === -1 ? 'all' : process.argv[index + 1]
})()

if (process.argv.includes('--serve')) {
  await servePlayground()
} else {
  if (major !== 'v2') await probeV1()
  if (major !== 'v1') await probeV2()

  const passed = results.filter((result) => result.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  process.exit(passed === results.length ? 0 : 1)
}
