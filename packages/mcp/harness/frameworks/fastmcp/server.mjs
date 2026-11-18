// FastMCP (punkpeye/fastmcp) over HTTP Stream, set up the way our docs show:
// instrumentFastMCP on the module before the server starts. FastMCP builds a
// low-level SDK v1 server per session, or per request when stateless.
//
//   MODE=stateful|stateless|json   json = stateless with enableJsonResponse
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import * as fastmcp from 'fastmcp'
import { getRequestHeaders, instrumentFastMCP } from '@posthog/mcp'
import { z } from 'zod4'
import { createRecorder, handleInspectionRoute } from '../../dual-era/shared/posthog.mjs'

const MODE = process.env.MODE ?? 'stateful'
const recorder = createRecorder(`fastmcp:${MODE}`)

instrumentFastMCP(fastmcp, recorder.client, {
  logger: recorder.logger,
  identify: (_request, extra) => {
    const auth = getRequestHeaders(extra)?.authorization
    return auth ? { distinctId: `user_${auth.replace(/^Bearer\s+/i, '')}` } : null
  },
})

const server = new fastmcp.FastMCP({ name: 'fastmcp-acceptance', version: '1.0.0' })
server.addTool({
  name: 'echo',
  description: 'Echoes the text back. The happy path.',
  // Strict, so an SDK argument that reaches FastMCP's own validation fails the call.
  parameters: z.strictObject({ text: z.string() }),
  execute: async ({ text }) => text,
})
server.addTool({
  name: 'fail_always',
  description: 'Always throws. Exercises error capture.',
  parameters: z.object({}),
  execute: async () => {
    throw new Error('intentional failure')
  },
})

// FastMCP binds the port it is given and does not report one it picked, so ask the OS for a free one.
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

const port = Number(process.env.PORT) || (await freePort())
await server.start({
  transportType: 'httpStream',
  httpStream: { port, stateless: MODE !== 'stateful', enableJsonResponse: MODE === 'json' },
})
createHttpServer((req, res) => handleInspectionRoute(req, res, recorder) || res.writeHead(404).end()).listen(
  0,
  function () {
    console.log(`MCP_HARNESS_LISTENING port=${port} inspect=${this.address().port}`)
  }
)
