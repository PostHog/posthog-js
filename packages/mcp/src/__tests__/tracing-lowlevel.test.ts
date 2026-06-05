import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { EventCapture, fakePostHog } from './test-utils'

/**
 * End-to-end coverage for the low-level `Server` path (`tracing.ts` →
 * `tracing-core.ts`). These assert on the real PostHog payloads handed to
 * `posthog.capture()` via `EventCapture.getCaptures()`, so they cover the unified
 * tool-call lifecycle the high-level tests don't reach.
 */

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the input',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
    },
  },
  {
    name: 'explode',
    description: 'Always throws',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'soft_fail',
    description: 'Returns an isError result without throwing',
    inputSchema: { type: 'object', properties: {} },
  },
]

async function setupLowLevelServer() {
  const server = new Server({ name: 'low-level test', version: '1.0.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name
    if (name === 'explode') {
      throw new Error('boom')
    }
    if (name === 'soft_fail') {
      return { isError: true, content: [{ type: 'text', text: 'nope' }] }
    }
    const text = (request.params?.arguments?.text as string) ?? ''
    return { content: [{ type: 'text', text: `echo: ${text}` }] }
  })

  const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  return {
    server,
    client,
    async connect() {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    },
    async cleanup() {
      await clientTransport.close?.()
      await serverTransport.close?.()
    },
  }
}

describe('Low-level Server tracing (e2e)', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('captures a single $mcp_tool_call for a successful call', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog())
      await connect()

      const result = await client.request(
        { method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } },
        CallToolResultSchema
      )
      await new Promise((r) => setTimeout(r, 50))

      expect((result.content as { text: string }[])[0].text).toBe('echo: hi')

      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      const props = toolCalls[0].properties
      expect(props.$mcp_tool_name).toBe('echo')
      expect(props.$mcp_resource_name).toBe('echo')
      expect(props.$mcp_is_error).toBe(false)
      expect(props.$mcp_duration_ms).toEqual(expect.any(Number))
      expect(props.$session_id).toBeDefined()
      // No identify configured → distinct_id falls back to the session id.
      expect(toolCalls[0].distinct_id).toBe(props.$session_id)

      // No exception sibling for a successful call.
      expect(eventCapture.findCapturesByEvent('$exception')).toHaveLength(0)
    } finally {
      await cleanup()
    }
  })

  it('emits $mcp_tool_call + a single $exception sibling when a tool throws', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog())
      await connect()

      await expect(
        client.request({ method: 'tools/call', params: { name: 'explode', arguments: {} } }, CallToolResultSchema)
      ).rejects.toThrow()
      await new Promise((r) => setTimeout(r, 50))

      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$mcp_is_error).toBe(true)

      const exceptions = eventCapture.findCapturesByEvent('$exception')
      expect(exceptions).toHaveLength(1)
      expect(exceptions[0].properties.$exception_list).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('treats an isError result as a failure (tool_call + $exception)', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog())
      await connect()

      await client.request({ method: 'tools/call', params: { name: 'soft_fail', arguments: {} } }, CallToolResultSchema)
      await new Promise((r) => setTimeout(r, 50))

      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$mcp_is_error).toBe(true)
      expect(eventCapture.findCapturesByEvent('$exception')).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  it('respects enableExceptionAutocapture: false (no $exception sibling)', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog(), { enableExceptionAutocapture: false })
      await connect()

      await expect(
        client.request({ method: 'tools/call', params: { name: 'explode', arguments: {} } }, CallToolResultSchema)
      ).rejects.toThrow()
      await new Promise((r) => setTimeout(r, 50))

      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
      expect(eventCapture.findCapturesByEvent('$exception')).toHaveLength(0)
    } finally {
      await cleanup()
    }
  })

  it('captures $mcp_tools_list with the listed tool names', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog())
      await connect()

      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      await new Promise((r) => setTimeout(r, 50))

      const listings = eventCapture.findCapturesByEvent('$mcp_tools_list')
      expect(listings).toHaveLength(1)
      expect(listings[0].properties.$mcp_listed_tool_names).toEqual(
        expect.arrayContaining(['echo', 'explode', 'soft_fail'])
      )
    } finally {
      await cleanup()
    }
  })
})
