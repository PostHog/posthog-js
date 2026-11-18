// Vercel's mcp-handler, set up the way its README and our docs show. It builds a
// fresh SDK v2 McpServer per request and calls our callback with it.
//
//   ORDER=first|last   instrument() before or after the tools are registered
//   WRAP=0             skip withMcpSessionHeader, to pin what it fixes
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { instrument, withMcpSessionHeader } from '@posthog/mcp'
import { TOOLS } from '../../dual-era/shared/tools.mjs'
import { createRecorder, handleInspectionRoute } from '../../dual-era/shared/posthog.mjs'

const ORDER = process.env.ORDER === 'last' ? 'last' : 'first'
const WRAP = process.env.WRAP !== '0'
const recorder = createRecorder(`mcp-handler:${ORDER}${WRAP ? '' : ':unwrapped'}`)

const instrumentServer = (server) =>
  instrument(server, recorder.client, {
    logger: recorder.logger,
    identify: (_request, extra) => {
      const token = extra?.http?.authInfo?.token
      return token ? { distinctId: `user_${token}` } : null
    },
  })

const mcpHandler = createMcpHandler((server) => {
  if (ORDER === 'first') instrumentServer(server)
  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputShape }, t.handler)
  }
  if (ORDER === 'last') instrumentServer(server)
})

// The order the README shows: auth outermost.
const handler = withMcpAuth(
  WRAP ? withMcpSessionHeader(mcpHandler) : mcpHandler,
  async (_request, token) => token && { token, clientId: 'harness', scopes: [] }
)

// What Next.js does for a route handler: a web Request in, a web Response out.
createServer(async (req, res) => {
  if (handleInspectionRoute(req, res, recorder)) return
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const response = await handler(
    new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: 'half',
    })
  )
  res.writeHead(response.status, Object.fromEntries(response.headers))
  if (response.body) for await (const chunk of response.body) res.write(chunk)
  res.end()
}).listen(Number(process.env.PORT ?? 0), function () {
  console.log(`MCP_HARNESS_LISTENING port=${this.address().port}`)
})
