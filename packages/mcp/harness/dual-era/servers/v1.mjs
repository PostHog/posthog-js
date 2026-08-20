// SDK v1 (@modelcontextprotocol/sdk) — the legacy era.
//
//   PORT=0 (default)   bind an ephemeral port; the chosen port is printed as
//                      `MCP_HARNESS_LISTENING port=<n>` for the orchestrator.
//                      Set PORT explicitly for the single-cell debug flow.
//   LEVEL=high|low     high-level McpServer  or  low-level Server
//   MODE=stateful      one server + one transport; the TRANSPORT mints Mcp-Session-Id
//   MODE=stateless     a fresh server + transport PER REQUEST; @posthog/mcp mints its
//                      own self-encoded Mcp-Session-Id token at initialize, and the
//                      client replays it so each new instance recovers the session
//
// The stateless mode is what exercises session-token.ts. It is also the v1 analogue
// of v2's per-request factory: instrument() runs again on every request, so the
// WeakMap is empty each time and only the replayed token holds the session together.
// PR 8 changes this path.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '@posthog/mcp'
import { TOOLS, TOOL_BY_NAME } from '../shared/tools.mjs'
import { createRecorder, handleInspectionRoute } from '../shared/posthog.mjs'

const PORT = Number(process.env.PORT ?? 0)
const LEVEL = process.env.LEVEL === 'low' ? 'low' : 'high'
const MODE = process.env.MODE === 'stateless' ? 'stateless' : 'stateful'
const CONVERSATION_ID = process.env.CONVERSATION_ID === '1'

const recorder = createRecorder(`v1:${LEVEL}:${MODE}`)

function buildServer() {
  if (LEVEL === 'high') {
    const server = new McpServer({ name: 'testbed-v1', version: '1.0.0' })
    for (const t of TOOLS) {
      server.registerTool(t.name, { description: t.description, inputSchema: t.inputShape }, t.handler)
    }
    return server
  }
  const server = new Server({ name: 'testbed-v1', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOL_BY_NAME[request.params.name]
    if (!tool) throw new Error(`Unknown tool: ${request.params.name}`)
    return tool.handler(request.params.arguments ?? {})
  })
  return server
}

function instrumented() {
  const server = buildServer()
  instrument(server, recorder.client, { logger: recorder.logger, enableConversationId: CONVERSATION_ID })
  return server
}

async function readBody(req) {
  if (req.method !== 'POST') return undefined
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

// ── stateful: one server for the whole process ──────────────────────────────
let sharedTransport
if (MODE === 'stateful') {
  const server = instrumented()
  sharedTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  })
  await server.connect(sharedTransport)
}

createServer(async (req, res) => {
  if (handleInspectionRoute(req, res, recorder)) return
  let body
  try {
    body = await readBody(req)
  } catch {
    res.writeHead(400).end('bad json')
    return
  }

  if (MODE === 'stateful') {
    await sharedTransport.handleRequest(req, res, body)
    return
  }

  // stateless: everything per request, as the v1 SDK prescribes.
  // sessionIdGenerator: undefined + enableJsonResponse: true is the combination
  // in which @posthog/mcp mints its own token into the response header.
  const server = instrumented()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  res.on('close', () => {
    transport.close?.()
    server.close?.()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}).listen(PORT, function () {
  const port = this.address().port
  console.log(`MCP_HARNESS_LISTENING port=${port}`)
  console.log(`v1 ${LEVEL}/${MODE} on http://localhost:${port}/mcp  conversationId=${CONVERSATION_ID}`)
})
