import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * Regression coverage for adapters that register their request handlers *after*
 * `instrument()` runs — most notably `@rekog/mcp-nest`, which builds a bare
 * `McpServer`, hands it to `instrument()` through `serverMutator`, and only then
 * registers `tools/list` / `tools/call` directly at the low level (bypassing the
 * high-level `registerTool`, so the `_registeredTools` proxy never fires).
 *
 * Before the fix, tools/list instrumentation bailed out when no `tools/list`
 * handler existed at instrument-time, so the late handler was never wrapped:
 * listings were not captured and the injected `context` parameter never appeared.
 * Now a late-registered tools/list handler is wrapped as it lands, just like
 * tools/call already was.
 *
 * The order below is the faithful reproduction: capability declared up front
 * (mcp-nest configures it before the mutator runs), `instrument()` on the bare
 * server, then handlers attached at `server.server` afterwards.
 */

const TOOLS = [
  {
    name: 'get_trends',
    description: 'Return a trends time series for an event.',
    inputSchema: {
      type: 'object',
      properties: { event: { type: 'string' } },
      required: ['event'],
    },
  },
]

async function setupLateRegisteredServer() {
  // Capability is declared at construction — mcp-nest does this before the
  // serverMutator (where instrument runs) is invoked.
  const server = new McpServer({ name: 'late-reg test', version: '1.0.0' }, { capabilities: { tools: {} } })

  instrument(server, fakePostHog(), { context: true })

  // Handlers registered AFTER instrument(), directly at the low level — this is
  // the path mcp-nest takes and the case the fix targets.
  const lowLevel = server.server
  lowLevel.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  lowLevel.setRequestHandler(CallToolRequestSchema, async (request) => {
    const event = (request.params?.arguments?.event as string) ?? ''
    return { content: [{ type: 'text', text: `trends for ${event}` }] }
  })

  const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  return {
    server,
    client,
    async connect() {
      await Promise.all([client.connect(clientTransport), server.server.connect(serverTransport)])
    },
    async cleanup() {
      await clientTransport.close?.()
      await serverTransport.close?.()
    },
  }
}

describe('Late handler registration (mcp-nest ordering)', () => {
  let eventCapture: EventCapture
  let client: Client
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()

    const setup = await setupLateRegisteredServer()
    client = setup.client
    cleanup = setup.cleanup
    await setup.connect()
  })

  afterEach(async () => {
    await cleanup()
    await eventCapture.stop()
  })

  it('injects the context parameter into a tools/list handler registered after instrument()', async () => {
    const response = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    const tool = response.tools.find((t) => t.name === 'get_trends')

    // The injected `context` parameter is the user-visible symptom of the fix:
    // without the late-registration watcher the handler runs unwrapped and `context` is absent.
    expect(tool?.inputSchema?.properties?.context).toBeDefined()
    expect((tool?.inputSchema?.properties?.context as { type?: string })?.type).toBe('string')
  })

  it('captures $mcp_tools_list for a handler registered after instrument()', async () => {
    await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    await new Promise((r) => setTimeout(r, 50))

    const listings = eventCapture.findCapturesByEvent('$mcp_tools_list')
    expect(listings).toHaveLength(1)
    expect(listings[0].properties.$mcp_listed_tool_names).toEqual(expect.arrayContaining(['get_trends']))
  })

  it('captures $mcp_tool_call for a tools/call handler registered after instrument()', async () => {
    const result = await client.request(
      { method: 'tools/call', params: { name: 'get_trends', arguments: { event: 'pageview' } } },
      CallToolResultSchema
    )
    await new Promise((r) => setTimeout(r, 50))

    expect((result.content as { text: string }[])[0].text).toBe('trends for pageview')

    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_tool_name).toBe('get_trends')
    expect(toolCalls[0].properties.$mcp_is_error).toBe(false)
  })
})
