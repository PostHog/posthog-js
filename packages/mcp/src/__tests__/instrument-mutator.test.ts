import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrumentMutator } from '../index'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * `instrumentMutator` is the point-free form for framework `serverMutator` hooks
 * (e.g. `@rekog/mcp-nest`). The two things that matter: it returns the *server*
 * (not the analytics handle), and the returned server is actually instrumented.
 */
describe('instrumentMutator', () => {
  it('returns the same server it was handed', () => {
    // The footgun this guards against: returning instrument()'s handle would
    // replace the server and break the module.
    const server = new McpServer({ name: 'mutator', version: '1.0.0' }, { capabilities: { tools: {} } })
    expect(instrumentMutator(fakePostHog())(server)).toBe(server)
  })

  it('instruments the server it returns (tool calls are captured)', async () => {
    const eventCapture = new EventCapture()
    await eventCapture.start()

    // Mirror the nest-mcp shape: mutate a bare server, then register handlers after.
    const server = new McpServer({ name: 'mutator', version: '1.0.0' }, { capabilities: { tools: {} } })
    const instrumented = instrumentMutator(fakePostHog())(server)

    instrumented.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'echo',
          description: 'echo',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ],
    }))
    instrumented.server.setRequestHandler(CallToolRequestSchema, async (request) => ({
      content: [{ type: 'text', text: `echo: ${(request.params?.arguments?.text as string) ?? ''}` }],
    }))

    const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([client.connect(clientTransport), instrumented.server.connect(serverTransport)])

      await client.request(
        { method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } },
        CallToolResultSchema
      )
      await new Promise((r) => setTimeout(r, 50))

      const calls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(calls).toHaveLength(1)
      expect(calls[0].properties.$mcp_tool_name).toBe('echo')
    } finally {
      await clientTransport.close?.()
      await serverTransport.close?.()
      await eventCapture.stop()
    }
  })
})
