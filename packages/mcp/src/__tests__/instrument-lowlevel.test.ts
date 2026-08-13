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
import type { MCPServerLike } from '../types'
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

async function setupLowLevelServer(realToolName?: string) {
  const server = new Server({ name: 'low-level test', version: '1.0.0' }, { capabilities: { tools: {} } })
  const tools = realToolName
    ? [
        ...TOOLS,
        {
          name: realToolName,
          description: 'A legitimate application tool',
          inputSchema: { type: 'object' as const, properties: { value: { type: 'string' } } },
        },
      ]
    : TOOLS

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  const receivedCalls: { name: string | undefined; arguments: unknown }[] = []
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name
    receivedCalls.push({ name, arguments: request.params?.arguments })
    if (name === realToolName) {
      const value = request.params?.arguments?.value
      if (value === 'explode') {
        throw new Error('real collision failed')
      }
      if (typeof value !== 'string') {
        throw new Error(`Invalid arguments for tool ${name}: value is required`)
      }
      return { content: [{ type: 'text' as const, text: `real handler: ${value}` }] }
    }
    if (name === 'explode') {
      throw new Error('boom')
    }
    if (name === 'soft_fail') {
      return { isError: true, content: [{ type: 'text', text: 'nope' }] }
    }
    if (name === 'echo') {
      const text = (request.params?.arguments?.text as string) ?? ''
      return { content: [{ type: 'text', text: `echo: ${text}` }] }
    }
    if (name === 'owned_reserved') {
      return { content: [{ type: 'text', text: 'ok' }] }
    }
    throw new Error(`Unknown tool: ${name}`)
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

/** Shaped like a handle we would have minted, so it is echoed rather than replaced. */
const ANALYTICS_CONVERSATION = '019fd2b0-3333-7333-8333-333333333333'

describe('Low-level Server reportMissing ownership (e2e)', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('runs a default-named real tool normally when reportMissing is disabled', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer('get_more_tools')
    try {
      instrument(server, fakePostHog(), { reportMissing: false })
      await connect()

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.filter((tool) => tool.name === 'get_more_tools')).toHaveLength(1)
      const result = await client.request(
        { method: 'tools/call', params: { name: 'get_more_tools', arguments: { value: 'disabled' } } },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toBe('real handler: disabled')
    } finally {
      await cleanup()
    }
  })

  it('warns and runs a default-named real tool normally when reportMissing is enabled', async () => {
    const logger = jest.fn()
    const { server, client, connect, cleanup } = await setupLowLevelServer('get_more_tools')
    try {
      instrument(server, fakePostHog(), { reportMissing: true, enableConversationId: true, logger })
      await connect()

      // The original dispatcher establishes ownership even before tools/list is called.
      const preListResult = await client.request(
        { method: 'tools/call', params: { name: 'get_more_tools', arguments: { value: 'before-list' } } },
        CallToolResultSchema
      )
      expect((preListResult.content as { text: string }[])[0].text).toBe('real handler: before-list')

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const collidingTools = tools.filter((tool) => tool.name === 'get_more_tools')
      expect(collidingTools).toHaveLength(1)
      expect(collidingTools[0].inputSchema.properties?.conversation_id).toBeDefined()
      expect(logger).toHaveBeenCalledWith(expect.stringContaining('real tool already uses that name'))
      const result = await client.request(
        { method: 'tools/call', params: { name: 'get_more_tools', arguments: { value: 'enabled' } } },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toBe('real handler: enabled')
    } finally {
      await cleanup()
    }
  })

  it('warns and runs a custom-named real tool normally when the configured name collides', async () => {
    const customName = 'posthog_find_tools'
    const logger = jest.fn()
    const { server, client, connect, cleanup } = await setupLowLevelServer(customName)
    try {
      instrument(server, fakePostHog(), { reportMissing: true, missingCapabilityToolName: customName, logger })
      await connect()

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.filter((tool) => tool.name === customName)).toHaveLength(1)
      expect(logger).toHaveBeenCalledWith(expect.stringContaining(`"${customName}"`))
      const result = await client.request(
        { method: 'tools/call', params: { name: customName, arguments: { value: 'custom' } } },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toBe('real handler: custom')
    } finally {
      await cleanup()
    }
  })

  it('handles a virtual call on a fresh pod after another pod advertised it', async () => {
    const podA = await setupLowLevelServer()
    const podB = await setupLowLevelServer()
    try {
      instrument(podA.server, fakePostHog(), { reportMissing: true, enableConversationId: true })
      instrument(podB.server, fakePostHog(), { reportMissing: true, enableConversationId: true })
      await Promise.all([podA.connect(), podB.connect()])

      const { tools } = await podA.client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.filter((tool) => tool.name === 'get_more_tools')).toHaveLength(1)

      const result = await podB.client.request(
        {
          method: 'tools/call',
          params: { name: 'get_more_tools', arguments: { context: 'Need a database tool' } },
        },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toContain('Unfortunately')
      expect(result.content).toHaveLength(1)
      await new Promise((resolve) => setTimeout(resolve, 50))
      const captures = eventCapture.findCapturesByEvent('$mcp_missing_capability')
      expect(captures).toHaveLength(1)
      expect(captures[0].properties.$mcp_conversation_id).toBeUndefined()
      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(0)
    } finally {
      await Promise.all([podA.cleanup(), podB.cleanup()])
    }
  })

  it('handles a custom-named virtual tool on a fresh instance', async () => {
    const customName = 'posthog_find_tools'
    const { server, client, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog(), { reportMissing: true, missingCapabilityToolName: customName })
      await connect()

      const result = await client.request(
        {
          method: 'tools/call',
          params: { name: customName, arguments: { context: 'Need a deployment tool' } },
        },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toContain('Unfortunately')
      await new Promise((resolve) => setTimeout(resolve, 50))
      const captures = eventCapture.findCapturesByEvent('$mcp_missing_capability')
      expect(captures).toHaveLength(1)
      expect(captures[0].properties.$mcp_resource_name).toBe(customName)
      expect(eventCapture.findCapturesByEvent('$mcp_tools_list')).toHaveLength(0)
    } finally {
      await cleanup()
    }
  })

  it('does not mutate a reused frozen tools array while injecting the virtual descriptor', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer()
    const frozenTools = Object.freeze([...TOOLS])
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: frozenTools as any }))
    try {
      instrument(server, fakePostHog(), { reportMissing: true, enableConversationId: true })
      await connect()

      const first = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const second = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const firstVirtual = first.tools.find((tool) => tool.name === 'get_more_tools')
      const secondVirtual = second.tools.find((tool) => tool.name === 'get_more_tools')

      expect(first.tools.filter((tool) => tool.name === 'get_more_tools')).toHaveLength(1)
      expect(second.tools.filter((tool) => tool.name === 'get_more_tools')).toHaveLength(1)
      // get_more_tools now carries the parameter like any other tool.
      expect((firstVirtual as any)?.inputSchema?.properties?.conversation_id).toBeDefined()
      expect((secondVirtual as any)?.inputSchema?.properties?.conversation_id).toBeDefined()
      expect(frozenTools.some((tool) => tool.name === 'get_more_tools')).toBe(false)
    } finally {
      await cleanup()
    }
  })

  it('does not swallow errors from a colliding real handler', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer('get_more_tools')
    try {
      instrument(server, fakePostHog(), { reportMissing: true })
      await connect()

      await expect(
        client.request(
          { method: 'tools/call', params: { name: 'get_more_tools', arguments: { value: 'explode' } } },
          CallToolResultSchema
        )
      ).rejects.toThrow('real collision failed')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(eventCapture.findCapturesByEvent('$mcp_missing_capability')).toHaveLength(0)
      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  it('fails open to a colliding real handler when the ownership probe fails', async () => {
    const logger = jest.fn()
    const { server, client, connect, cleanup } = await setupLowLevelServer('get_more_tools')
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      throw new Error('listing unavailable')
    })
    try {
      instrument(server, fakePostHog(), { reportMissing: true, logger })
      await connect()

      const result = await client.request(
        { method: 'tools/call', params: { name: 'get_more_tools', arguments: { value: 'fallback' } } },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toBe('real handler: fallback')
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('could not determine whether "get_more_tools" is advertised')
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(eventCapture.findCapturesByEvent('$mcp_missing_capability')).toHaveLength(0)
      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  it('fails open after the server removes its tools/list handler', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer('get_more_tools')
    try {
      instrument(server, fakePostHog(), { reportMissing: true })
      server.removeRequestHandler('tools/list')
      await connect()

      const result = await client.request(
        { method: 'tools/call', params: { name: 'get_more_tools', arguments: { value: 'after-remove' } } },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toBe('real handler: after-remove')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(eventCapture.findCapturesByEvent('$mcp_missing_capability')).toHaveLength(0)
      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  it('does not misclassify a colliding real tool validation failure as unknown', async () => {
    const { server, client, connect, cleanup } = await setupLowLevelServer('get_more_tools')
    try {
      instrument(server, fakePostHog(), { reportMissing: true })
      await connect()

      await expect(
        client.request(
          { method: 'tools/call', params: { name: 'get_more_tools', arguments: {} } },
          CallToolResultSchema
        )
      ).rejects.toThrow('Invalid arguments')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(eventCapture.findCapturesByEvent('$mcp_missing_capability')).toHaveLength(0)
      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })
})

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

  it.each(['context', 'conversation_id'] as const)(
    'preserves a tool-owned %s argument without consuming it as analytics metadata',
    async (reservedArgument) => {
      const { server, client, receivedCalls, connect, cleanup } = await setupLowLevelServer()
      try {
        instrument(server, fakePostHog(), { context: true, enableConversationId: true })
        await connect()
        await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

        const suppliedArguments = { [reservedArgument]: 'application value', value: 'kept' }
        const result = await client.request(
          {
            method: 'tools/call',
            params: { name: 'owned_reserved', arguments: suppliedArguments },
          },
          CallToolResultSchema
        )

        expect(receivedCalls.at(-1)).toEqual({ name: 'owned_reserved', arguments: suppliedArguments })
        expect(
          (result.content as { text?: string }[]).some((content) => content.text?.includes('conversation_id='))
        ).toBe(false)

        await new Promise((resolve) => setTimeout(resolve, 50))
        const events = eventCapture.getEvents().filter((event) => event.resourceName === 'owned_reserved')
        expect(events).toHaveLength(1)
        expect(events[0].userIntent).toBeUndefined()
        expect(events[0].conversationId).toBeUndefined()
      } finally {
        await cleanup()
      }
    }
  )

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
            arguments: { context: 'analytics intent', conversation_id: ANALYTICS_CONVERSATION, text: 'hi' },
          },
        },
        CallToolResultSchema
      )

      expect(receivedCalls.at(-1)).toEqual({ name: 'echo', arguments: { text: 'hi' } })
      await new Promise((resolve) => setTimeout(resolve, 50))
      const event = eventCapture.getEvents().find((candidate) => candidate.resourceName === 'echo')
      expect(event?.userIntent).toBe('analytics intent')
      expect(event?.conversationId).toBe(ANALYTICS_CONVERSATION)
    } finally {
      await cleanup()
    }
  })

  it('captures intent, but strips nothing, before low-level ownership is learned from tools/list', async () => {
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
      // Ownership is unknown here — this instance never served a `tools/list`,
      // which on a stateless server is every instance. Unknown no longer means
      // "throw the intent away": the argument arrived because some advertised
      // listing asked for it. Nothing is stripped and no handle is minted, since
      // both of those can damage the customer's call and stay fail-closed.
      expect(event?.userIntent).toBe('unknown context')
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
            arguments: { context: 'analytics context', conversation_id: ANALYTICS_CONVERSATION, value: 'kept' },
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
      expect(analyticsEvent?.conversationId).toBe(ANALYTICS_CONVERSATION)
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

  it('instruments a tools/call handler registered after instrument()', async () => {
    const server = new Server({ name: 'late low-level', version: '1.0.0' }, { capabilities: { tools: {} } })

    instrument(server, fakePostHog(), { reportMissing: true })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => ({
      content: [{ type: 'text', text: `echo: ${request.params?.arguments?.text ?? ''}` }],
    }))

    const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

      const result = await client.request(
        { method: 'tools/call', params: { name: 'get_more_tools', arguments: { context: 'Need SQL' } } },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toContain('Unfortunately')

      await new Promise((r) => setTimeout(r, 50))
      expect(eventCapture.findCapturesByEvent('$mcp_missing_capability')).toHaveLength(1)
      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(0)
    } finally {
      await clientTransport.close?.()
      await serverTransport.close?.()
    }
  })

  it('captures late-handler result validation failures as failed tool calls', async () => {
    const server = new Server({ name: 'late low-level', version: '1.0.0' }, { capabilities: { tools: {} } })

    instrument(server, fakePostHog())
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
    server.setRequestHandler(CallToolRequestSchema, async () => null as any)

    const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

      await expect(
        client.request(
          { method: 'tools/call', params: { name: 'echo', arguments: { text: 'invalid' } } },
          CallToolResultSchema
        )
      ).rejects.toThrow('Invalid tools/call result')

      await new Promise((r) => setTimeout(r, 50))
      const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].properties.$mcp_is_error).toBe(true)
    } finally {
      await clientTransport.close?.()
      await serverTransport.close?.()
    }
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

/**
 * The synthetic `tools/call` fallback — what answers a call for a tool no
 * dispatcher claims — is written straight into `_requestHandlers` instead of
 * being registered through `setRequestHandler`. See
 * `registerFallbackRequestHandler` for why.
 */
describe('Low-level Server — synthetic tools/call fallback', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  /** `_requestHandlers` is TS-private on the real `Server`. */
  const handlersOf = (server: Server) => (server as unknown as MCPServerLike)._requestHandlers

  it('instruments a server that never declared a tools capability', async () => {
    // Registering through setRequestHandler asserted the capability first and
    // threw `Server does not support tools (required for tools/call)`, which
    // aborted instrumentLowLevelServer with setRequestHandler already patched —
    // instrumentation half-applied, and only a warning to show for it.
    const logger = jest.fn()
    const server = new Server({ name: 'no tools capability', version: '1.0.0' }, { capabilities: {} })

    instrument(server, fakePostHog(), { logger })

    expect(logger).not.toHaveBeenCalledWith(expect.stringContaining('does not support tools'))
    expect(logger).not.toHaveBeenCalledWith(expect.stringContaining('Failed to setup tool call instrumentation'))
    expect(handlersOf(server).has('tools/call')).toBe(true)
  })

  it('captures a call for an unclaimed tool and still reports it as unknown', async () => {
    const server = new Server({ name: 'no dispatcher', version: '1.0.0' }, { capabilities: { tools: {} } })
    instrument(server, fakePostHog())

    const fallback = handlersOf(server).get('tools/call')
    await expect(fallback?.({ method: 'tools/call', params: { name: 'nope', arguments: {} } })).rejects.toThrow(
      'Unknown tool: nope'
    )

    await new Promise((r) => setTimeout(r, 50))
    const toolCalls = eventCapture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].properties.$mcp_resource_name).toBe('nope')
    expect(toolCalls[0].properties.$mcp_is_error).toBe(true)
    expect(eventCapture.findCapturesByEvent('$exception')).toHaveLength(1)
  })

  it('does not displace a tools/call handler that already exists', async () => {
    const { server, client, receivedCalls, connect, cleanup } = await setupLowLevelServer()
    try {
      instrument(server, fakePostHog())
      await connect()

      const result = await client.request(
        { method: 'tools/call', params: { name: 'echo', arguments: { text: 'kept' } } },
        CallToolResultSchema
      )

      expect((result.content as { text: string }[])[0].text).toBe('echo: kept')
      expect(receivedCalls).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  it('is replaced by a dispatcher registered after instrument()', async () => {
    const server = new Server({ name: 'late dispatcher', version: '1.0.0' }, { capabilities: { tools: {} } })
    instrument(server, fakePostHog())
    server.setRequestHandler(CallToolRequestSchema, async (request) => ({
      content: [{ type: 'text' as const, text: `real: ${request.params?.name}` }],
    }))

    const client = new Client({ name: 'test client', version: '1.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

      const result = await client.request(
        { method: 'tools/call', params: { name: 'echo', arguments: {} } },
        CallToolResultSchema
      )
      expect((result.content as { text: string }[])[0].text).toBe('real: echo')

      await new Promise((r) => setTimeout(r, 50))
      expect(eventCapture.findCapturesByEvent('$mcp_tool_call')).toHaveLength(1)
    } finally {
      await clientTransport.close?.()
      await serverTransport.close?.()
    }
  })
})
