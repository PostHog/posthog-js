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
 * End-to-end coverage for the low-level `Server` path (`instrument-lowlevel.ts` →
 * `instrumentation.ts`). These assert on the real PostHog payloads handed to
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
  {
    name: 'owned_reserved',
    description: 'Owns the reserved analytics argument names',
    inputSchema: {
      type: 'object',
      _def: { annotation: 'custom JSON Schema keyword' },
      properties: {
        context: { type: 'string' },
        conversation_id: { type: 'string' },
        value: { type: 'string' },
      },
    },
  },
]

async function setupLowLevelServer() {
  const server = new Server({ name: 'low-level test', version: '1.0.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  const receivedCalls: { name: string | undefined; arguments: unknown }[] = []
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name
    receivedCalls.push({ name, arguments: request.params?.arguments })
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
    receivedCalls,
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

  it('preserves tool-owned reserved arguments without consuming them as analytics metadata', async () => {
    const { server, client, receivedCalls, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog(), { context: true, enableConversationId: true })
      await connect()
      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      const suppliedResult = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'owned_reserved',
            arguments: {
              context: 'application state',
              conversation_id: 'application conversation',
              value: 'first',
            },
          },
        },
        CallToolResultSchema
      )
      const omittedResult = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'owned_reserved',
            arguments: { context: 'application state', value: 'second' },
          },
        },
        CallToolResultSchema
      )

      expect(receivedCalls.slice(-2)).toEqual([
        {
          name: 'owned_reserved',
          arguments: {
            context: 'application state',
            conversation_id: 'application conversation',
            value: 'first',
          },
        },
        {
          name: 'owned_reserved',
          arguments: { context: 'application state', value: 'second' },
        },
      ])
      for (const result of [suppliedResult, omittedResult]) {
        expect(
          (result.content as { text?: string }[]).some((content) => content.text?.includes('conversation_id='))
        ).toBe(false)
      }

      await new Promise((resolve) => setTimeout(resolve, 50))
      const events = eventCapture.getEvents().filter((event) => event.resourceName === 'owned_reserved')
      expect(events).toHaveLength(2)
      for (const event of events) {
        expect(event.userIntent).toBeUndefined()
        expect(event.conversationId).toBeUndefined()
      }
    } finally {
      await cleanup()
    }
  })

  it('strips and captures analytics-owned reserved arguments on the low-level path', async () => {
    const { server, client, receivedCalls, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog(), { context: true, enableConversationId: true })
      await connect()
      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { context: 'analytics intent', conversation_id: 'analytics conversation', text: 'hi' },
          },
        },
        CallToolResultSchema
      )

      expect(receivedCalls.at(-1)).toEqual({ name: 'echo', arguments: { text: 'hi' } })
      await new Promise((resolve) => setTimeout(resolve, 50))
      const event = eventCapture.getEvents().find((candidate) => candidate.resourceName === 'echo')
      expect(event?.userIntent).toBe('analytics intent')
      expect(event?.conversationId).toBe('analytics conversation')
    } finally {
      await cleanup()
    }
  })

  it('preserves reserved arguments before low-level ownership is learned from tools/list', async () => {
    const { server, client, receivedCalls, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog(), { context: true, enableConversationId: true })
      await connect()

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { context: 'unknown context', conversation_id: 'unknown conversation', text: 'hi' },
          },
        },
        CallToolResultSchema
      )

      expect(receivedCalls.at(-1)).toEqual({
        name: 'echo',
        arguments: { context: 'unknown context', conversation_id: 'unknown conversation', text: 'hi' },
      })
      expect(
        (result.content as { text?: string }[]).some((content) => content.text?.includes('conversation_id='))
      ).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 50))
      const event = eventCapture.getEvents().find((candidate) => candidate.resourceName === 'echo')
      expect(event?.userIntent).toBeUndefined()
      expect(event?.conversationId).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('preserves ownership metadata across paginated tools/list responses', async () => {
    const server = new Server({ name: 'paginated low-level', version: '1.0.0' }, { capabilities: { tools: {} } })
    const receivedCalls: { name: string | undefined; arguments: unknown }[] = []
    server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      if (request.params?.cursor === 'page-2') {
        return {
          tools: [
            {
              name: 'page_two_owned',
              inputSchema: {
                type: 'object',
                properties: { context: { type: 'string' }, conversation_id: { type: 'string' } },
              },
            },
          ],
        }
      }
      return {
        tools: [
          {
            name: 'page_one_analytics',
            inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
          },
        ],
        nextCursor: 'page-2',
      }
    })
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      receivedCalls.push({ name: request.params?.name, arguments: request.params?.arguments })
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      instrument(server, fakePostHog(), { context: true, enableConversationId: true })
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      await client.request({ method: 'tools/list', params: { cursor: 'page-2' } }, ListToolsResultSchema)

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'page_one_analytics',
            arguments: { context: 'analytics context', conversation_id: 'analytics conversation', value: 'kept' },
          },
        },
        CallToolResultSchema
      )
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'page_two_owned',
            arguments: { context: 'application context', conversation_id: 'application conversation' },
          },
        },
        CallToolResultSchema
      )

      expect(receivedCalls).toEqual([
        { name: 'page_one_analytics', arguments: { value: 'kept' } },
        {
          name: 'page_two_owned',
          arguments: { context: 'application context', conversation_id: 'application conversation' },
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 50))
      const analyticsEvent = eventCapture.getEvents().find((event) => event.resourceName === 'page_one_analytics')
      expect(analyticsEvent?.userIntent).toBe('analytics context')
      expect(analyticsEvent?.conversationId).toBe('analytics conversation')
      const ownedEvent = eventCapture.getEvents().find((event) => event.resourceName === 'page_two_owned')
      expect(ownedEvent?.userIntent).toBeUndefined()
      expect(ownedEvent?.conversationId).toBeUndefined()
    } finally {
      await clientTransport.close?.()
      await serverTransport.close?.()
    }
  })

  it('stamps $mcp_client_name on every tool call, not just the first', async () => {
    // Regression: getSessionInfo() cached the client name but then overwrote the
    // cache with `undefined` on the next event, so consecutive tool calls
    // alternated between having and lacking $mcp_client_name.
    const { server, client, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog())
      await connect()

      for (let i = 0; i < 4; i++) {
        await client.request(
          { method: 'tools/call', params: { name: 'echo', arguments: { text: `hi ${i}` } } },
          CallToolResultSchema
        )
      }
      await new Promise((r) => setTimeout(r, 50))

      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(4)
      // The InMemory client identifies itself as 'test client' (see setupLowLevelServer).
      for (const call of toolCalls) {
        expect(call.properties.$mcp_client_name).toBe('test client')
      }
    } finally {
      await cleanup()
    }
  })
})

/**
 * The low-level path also instruments handlers registered *after* instrument()
 * (via `patchRequestHandlers`' setRequestHandler interceptor) — the same
 * late-registration support the high-level/mcp-nest path relies on.
 */
describe('Low-level Server — late handler registration', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('instruments a tools/list handler registered after instrument()', async () => {
    const server = new Server({ name: 'late low-level', version: '1.0.0' }, { capabilities: { tools: {} } })

    // instrument() runs first; the tools/list handler is registered afterwards.
    instrument(server, fakePostHog(), { context: true })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

    const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      // The injected `context` param proves the late-registered handler was wrapped.
      expect(tools.find((t) => t.name === 'echo')?.inputSchema?.properties?.context).toBeDefined()

      await new Promise((r) => setTimeout(r, 50))
      const listings = eventCapture.findCapturesByEvent('$mcp_tools_list')
      expect(listings).toHaveLength(1)
      expect(listings[0].properties.$mcp_listed_tool_names).toEqual(expect.arrayContaining(['echo']))
    } finally {
      await clientTransport.close?.()
      await serverTransport.close?.()
    }
  })
})
