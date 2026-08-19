// SDK v2 (@modelcontextprotocol/server) — the 2026-07-28 era.
//
//   PORT=0 (default)     bind an ephemeral port; the chosen port is printed as
//                        `MCP_HARNESS_LISTENING port=<n>` for the orchestrator.
//                        Set PORT explicitly for the single-cell debug flow.
//   LEVEL=high|low       high-level McpServer  or  low-level Server
//   MODE=perrequest      createMcpHandler — a FRESH server per HTTP request, with
//                        instrument() inside the factory. The 2026 topology.
//   MODE=longlived       one server for the process on NodeStreamableHTTPServerTransport.
//
// The longlived mode is the control. Without it, every v2 failure is confounded:
// you cannot tell whether a result is caused by the SDK major or by the server
// being rebuilt each request. Run both and the difference is the answer.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer, Server, createMcpHandler } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport, toNodeHandler } from '@modelcontextprotocol/node'
import { instrument } from '@posthog/mcp'
import { TOOLS, TOOL_BY_NAME } from '../shared/tools.mjs'
import { createRecorder, handleInspectionRoute } from '../shared/posthog.mjs'

const PORT = Number(process.env.PORT ?? 0)
const LEVEL = process.env.LEVEL === 'low' ? 'low' : 'high'
const MODE = process.env.MODE === 'longlived' ? 'longlived' : 'perrequest'
const CONVERSATION_ID = process.env.CONVERSATION_ID === '1'
// Registers a custom method through v2's 3-argument form AFTER instrument().
// This is the standing regression assertion: today it throws and takes the
// server's request down with it.
const CUSTOM_3ARG = process.env.CUSTOM_3ARG === '1'
// longlived only: mint a transport session id (the legacy stateful deployment).
const STATEFUL = process.env.STATEFUL === '1'

const recorder = createRecorder(`v2:${LEVEL}:${MODE}`)

function buildServer() {
    if (LEVEL === 'high') {
        const server = new McpServer({ name: 'testbed-v2', version: '1.0.0' })
        for (const t of TOOLS) {
            server.registerTool(t.name, { description: t.description, inputSchema: t.inputShape }, t.handler)
        }
        return server
    }
    const server = new Server({ name: 'testbed-v2', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler('tools/list', async () => ({
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema })),
    }))
    server.setRequestHandler('tools/call', async (request) => {
        const tool = TOOL_BY_NAME[request.params.name]
        if (!tool) throw new Error(`Unknown tool: ${request.params.name}`)
        return tool.handler(request.params.arguments ?? {})
    })
    return server
}

function instrumented() {
    const server = buildServer()
    instrument(server, recorder.client, { logger: recorder.logger, enableConversationId: CONVERSATION_ID })
    if (CUSTOM_3ARG) {
        // Must survive instrument(). Our patched setRequestHandler forwards only
        // two arguments, so v2's 3-argument custom form is rejected.
        const low = server.server ?? server
        low.setRequestHandler(
            'testbed/custom',
            { paramsSchema: undefined, resultSchema: undefined },
            async () => ({ ok: true })
        )
    }
    return server
}

let mcp
if (MODE === 'perrequest') {
    const handler = createMcpHandler(instrumented, {
        responseMode: 'json',
        onerror: (e) => recorder.logger(`handler error: ${e}`),
    })
    mcp = toNodeHandler(handler)
} else {
    // One server for the process. sessionIdGenerator gives it the legacy stateful
    // behaviour a v2 operator opts into — the only way ctx.sessionId is ever set.
    const server = instrumented()
    const transport = new NodeStreamableHTTPServerTransport({
        // undefined ⇒ stateless: no handshake required, so the modern era works
        // with a long-lived server. That is the control for the per-request case.
        sessionIdGenerator: STATEFUL ? () => randomUUID() : undefined,
        responseMode: 'json',
    })
    await server.connect(transport)
    mcp = (req, res) => transport.handleRequest(req, res)
}

createServer(async (req, res) => {
    if (handleInspectionRoute(req, res, recorder)) return
    await mcp(req, res)
}).listen(PORT, function () {
    const port = this.address().port
    console.log(`MCP_HARNESS_LISTENING port=${port}`)
    console.log(
        `v2 ${LEVEL}/${MODE} on http://localhost:${port}/  conversationId=${CONVERSATION_ID} custom3arg=${CUSTOM_3ARG}`
    )
})
