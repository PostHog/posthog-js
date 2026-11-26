import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer as V1McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpServer as V2McpServer } from '@modelcontextprotocol/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { instrument } from '../index'
import type { MCPAnalyticsOptions, MCPRequestLike, MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'
import { setupTestServerAndClient } from './test-utils/client-server-factory'

/**
 * `resultProperties` adds properties derived from a tool's result to its `$mcp_tool_call`
 * event, independent of `$mcp_response` (https://github.com/PostHog/posthog-js/issues/5661).
 */

type ToolHandler = (request: MCPRequestLike) => Promise<unknown>

function createServer(options: MCPAnalyticsOptions, handler: ToolHandler): MCPServerLike {
  const server = new Server({ name: 'result-properties-test', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(CallToolRequestSchema, handler as any)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'search', description: 'Searches bookings', inputSchema: { type: 'object' } }],
  }))
  instrument(server, fakePostHog(), { enableConversationId: false, ...options })
  return server as unknown as MCPServerLike
}

function callTool(server: MCPServerLike, name = 'search', args: Record<string, unknown> = {}): Promise<unknown> {
  const handler = server._requestHandlers.get('tools/call')!
  return handler({ method: 'tools/call', params: { name, arguments: args } }, undefined)
}

/** Dispatches through a McpServer's own `tools/call` handler, unknown tools included. */
async function callHighLevelTool(
  server: V1McpServer | V2McpServer,
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const handler = (server.server as unknown as MCPServerLike)._requestHandlers.get('tools/call')!
  const extra = { mcpReq: { requestState: () => undefined } } as any
  try {
    return await handler({ method: 'tools/call', params: { name, arguments: args } }, extra)
  } catch (error) {
    return error
  }
}

const flushCaptures = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

const searchResult = {
  content: [{ type: 'text', text: 'No slots' }],
  structuredContent: { status: 'no_results', items: [] as unknown[] },
}

describe('resultProperties', () => {
  let capture: EventCapture

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
  })

  afterEach(async () => {
    await capture.stop()
  })

  const toolCallProperties = (): Record<string, unknown> => {
    const [toolCall] = capture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCall).toBeDefined()
    return toolCall.properties as Record<string, unknown>
  }

  it('merges properties derived from the result into the tool call event', async () => {
    const resultProperties = vi.fn((_toolName: string, result: any) => ({
      search_status: result.structuredContent.status,
      result_count: result.structuredContent.items.length,
    }))
    const server = createServer({ resultProperties }, async () => searchResult)

    const result = await callTool(server)
    await flushCaptures()

    expect(result).toEqual(searchResult)
    expect(resultProperties).toHaveBeenCalledTimes(1)
    expect(resultProperties).toHaveBeenCalledWith('search', searchResult)
    expect(toolCallProperties()).toMatchObject({ search_status: 'no_results', result_count: 0 })
  })

  it("does not count the callback's time as the tool's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const resultProperties = () => {
        vi.setSystemTime(Date.now() + 60_000)
        return { search_status: 'no_results' }
      }

      const tool = async (): Promise<unknown> => {
        vi.setSystemTime(Date.now() + 5_000)
        return searchResult
      }

      await callTool(createServer({ resultProperties }, tool))
      await flushCaptures()
    } finally {
      vi.useRealTimers()
    }

    expect(toolCallProperties()).toMatchObject({ search_status: 'no_results', $mcp_duration_ms: 5_000 })
  })

  it('is available to beforeSend, which can drop $mcp_response without parsing it', async () => {
    const seen: Record<string, unknown>[] = []
    const server = createServer(
      {
        resultProperties: () => ({ search_status: 'no_results' }),
        beforeSend: (event) => {
          seen.push({ ...event.properties })
          delete event.properties.$mcp_response
          return event
        },
      },
      async () => searchResult
    )

    await callTool(server)
    await flushCaptures()

    expect(seen.find((properties) => '$mcp_tool_name' in properties)).toMatchObject({ search_status: 'no_results' })
    expect(toolCallProperties()).toMatchObject({ search_status: 'no_results' })
    expect(toolCallProperties()).not.toHaveProperty('$mcp_response')
  })

  it('also runs for an isError result', async () => {
    const resultProperties = vi.fn(() => ({ search_status: 'upstream_down' }))
    const server = createServer({ resultProperties }, async () => ({
      content: [{ type: 'text', text: 'Upstream unavailable' }],
      isError: true,
    }))

    await callTool(server)
    await flushCaptures()

    expect(resultProperties).toHaveBeenCalledTimes(1)
    expect(toolCallProperties()).toMatchObject({ search_status: 'upstream_down', $mcp_is_error: true })
  })

  it('is not called when a low-level tool throws, since the client gets no result', async () => {
    const resultProperties = vi.fn(() => ({ search_status: 'unexpected' }))
    const server = createServer({ resultProperties }, async () => {
      throw new Error('boom')
    })

    await expect(callTool(server)).rejects.toThrow('boom')
    await flushCaptures()

    expect(resultProperties).not.toHaveBeenCalled()
    expect(toolCallProperties()).not.toHaveProperty('search_status')
  })

  it.each(
    (['v1', 'v2'] as const).flatMap((major) => [[major, 'before', true] as const, [major, 'after', false] as const])
  )(
    'runs for the isError result a %s McpServer builds from a throw (tool registered %s instrument())',
    async (major, _when, early) => {
      const resultProperties = vi.fn((_toolName: string, result: any) => ({ is_error_result: result.isError }))
      const server =
        major === 'v1'
          ? new V1McpServer({ name: 'throwing', version: '1.0.0' })
          : new V2McpServer({ name: 'throwing', version: '1.0.0' })
      const register = (): void => {
        ;(server as V1McpServer).registerTool('search', { description: 'Searches bookings' }, async () => {
          throw new TypeError('boom')
        })
      }
      if (early) register()
      instrument(server, fakePostHog(), { resultProperties })
      if (!early) register()

      const result = await callHighLevelTool(server, 'search')
      await flushCaptures()

      expect(result).toMatchObject({ isError: true })
      expect(resultProperties).toHaveBeenCalledTimes(1)
      expect(resultProperties).toHaveBeenCalledWith('search', expect.objectContaining({ isError: true }))
      expect(toolCallProperties()).toMatchObject({ is_error_result: true, $mcp_is_error: true })
      // The original error still reaches `$exception`, with the properties.
      const [exception] = capture.findCapturesByEvent('$exception')
      expect((exception.properties as any).$exception_list[0]).toMatchObject({ type: 'TypeError', value: 'boom' })
      expect(exception.properties).toMatchObject({ is_error_result: true })
    }
  )

  it.each(['v1', 'v2'] as const)('runs for an isError result a %s McpServer tool returned', async (major) => {
    const resultProperties = vi.fn(() => ({ search_status: 'upstream_down' }))
    const server =
      major === 'v1'
        ? new V1McpServer({ name: 'failing', version: '1.0.0' })
        : new V2McpServer({ name: 'failing', version: '1.0.0' })
    ;(server as V1McpServer).registerTool('search', { description: 'Searches bookings' }, async () => ({
      content: [{ type: 'text' as const, text: 'Upstream unavailable' }],
      isError: true,
    }))
    instrument(server, fakePostHog(), { resultProperties })

    await callHighLevelTool(server, 'search')
    await flushCaptures()

    expect(resultProperties).toHaveBeenCalledTimes(1)
    expect(toolCallProperties()).toMatchObject({ search_status: 'upstream_down', $mcp_is_error: true })
    const [exception] = capture.findCapturesByEvent('$exception')
    expect(exception.properties).toMatchObject({ search_status: 'upstream_down' })
  })

  it('gets the result before the conversation handle is written into it', async () => {
    const seen: unknown[] = []
    const server = createServer(
      {
        enableConversationId: true,
        resultProperties: (_toolName, result) => {
          seen.push(structuredClone(result))
          return null
        },
      },
      async () => structuredClone(searchResult)
    )
    // Listing first, so the SDK owns `conversation_id` on this tool.
    await server._requestHandlers.get('tools/list')!({ method: 'tools/list', params: {} }, undefined)

    const result = await callTool(server)
    await flushCaptures()

    expect(result).not.toEqual(searchResult)
    expect(seen).toEqual([searchResult])
  })

  it.each([
    ['get_more_tools', { context: 'Need a calendar tool' }],
    ['send_feedback', { category: 'other', summary: 'Works', context: 'Testing' }],
    ['not_a_tool', {}],
  ])('is not called for %s', async (name, args) => {
    const resultProperties = vi.fn(() => ({ search_status: 'unexpected' }))
    const server = new V1McpServer({ name: 'virtual', version: '1.0.0' })
    server.registerTool('search', { description: 'Searches bookings' }, async () => ({ content: [] }))
    instrument(server, fakePostHog(), { reportMissing: true, collectFeedback: true, resultProperties })

    await callHighLevelTool(server, name, args)
    await flushCaptures()

    expect(resultProperties).not.toHaveBeenCalled()
    expect(capture.findCapturesByEvent('$mcp_tool_call')).toEqual([])
    expect(capture.getEvents().length).toBeGreaterThan(0)
  })

  it.each([
    ['throws', () => Promise.reject(new Error('no such tool'))],
    ['returns an isError result', async () => ({ content: [{ type: 'text', text: 'No such tool' }], isError: true })],
  ])('is not called for an unknown tool a low-level Server dispatcher %s for', async (_, dispatch) => {
    const resultProperties = vi.fn(() => ({ search_status: 'unexpected' }))
    const server = createServer(
      {
        resultProperties,
        resolveOriginalTool: (name) => (name === 'search' ? { inputSchema: { type: 'object' } } : undefined),
      },
      async (request) => (request.params?.name === 'search' ? searchResult : dispatch())
    )

    await callTool(server, 'not_a_tool').catch(() => undefined)
    await flushCaptures()

    expect(resultProperties).not.toHaveBeenCalled()
    expect(capture.findCapturesByEvent('$mcp_unknown_tool')).toHaveLength(1)
    expect(capture.findCapturesByEvent('$mcp_tool_call')).toEqual([])
    for (const event of capture.getEvents()) {
      expect(event.properties ?? {}).not.toHaveProperty('search_status')
    }
  })

  it.each([
    ['rejects', () => Promise.reject(new Error('async failure'))],
    ['resolves', () => Promise.resolve({ search_status: 'no_results' })],
  ])('ignores a promise from an async callback that %s, without an unhandled rejection', async (_, callback) => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const messages: string[] = []
      const server = createServer(
        { resultProperties: callback as any, logger: (message: string) => messages.push(message) },
        async () => searchResult
      )

      expect(await callTool(server)).toEqual(searchResult)
      await flushCaptures()

      expect(unhandled).toEqual([])
      expect(messages.some((message) => message.includes('resultProperties returned a promise'))).toBe(true)
      expect(toolCallProperties()).toMatchObject({ $mcp_tool_name: 'search' })
      expect(toolCallProperties()).not.toHaveProperty('search_status')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('wins over eventProperties on the same key and keeps the others', async () => {
    const server = createServer(
      {
        eventProperties: () => ({ search_status: 'from request', tenant: 'acme' }),
        resultProperties: () => ({ search_status: 'from result' }),
      },
      async () => searchResult
    )

    await callTool(server, 'search', { query: 'tomorrow' })
    await flushCaptures()

    expect(toolCallProperties()).toMatchObject({ search_status: 'from result', tenant: 'acme' })
    expect(toolCallProperties().$mcp_input_keys).toHaveLength(1)
  })

  it.each([
    [
      'throws',
      () => {
        throw new Error('callback failed')
      },
    ],
    ['returns null', () => null],
    ['returns undefined', () => undefined],
  ])('captures the event unchanged when the callback %s', async (behaviour, resultProperties) => {
    const messages: string[] = []
    const server = createServer(
      { resultProperties, logger: (message: string) => messages.push(message) },
      async () => searchResult
    )

    const result = await callTool(server)
    await flushCaptures()

    expect(result).toEqual(searchResult)
    expect(toolCallProperties()).not.toHaveProperty('search_status')
    const logged = messages.some((message) => message.includes('resultProperties'))
    expect(logged).toBe(!['returns null', 'returns undefined'].includes(behaviour))
  })

  it('works on a high-level McpServer', async () => {
    const resultProperties = vi.fn((toolName: string) => ({ derived_from: toolName }))
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      instrument(server, fakePostHog(), { resultProperties })
      await client.request(
        { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 'Count me' } } },
        CallToolResultSchema
      )
      await flushCaptures()

      expect(resultProperties).toHaveBeenCalledWith('add_todo', expect.objectContaining({ content: expect.any(Array) }))
      expect(toolCallProperties()).toMatchObject({ derived_from: 'add_todo' })
    } finally {
      await cleanup()
    }
  })
})
