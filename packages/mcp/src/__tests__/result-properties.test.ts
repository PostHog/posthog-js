import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
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

function callTool(server: MCPServerLike, name = 'search'): Promise<unknown> {
  const handler = server._requestHandlers.get('tools/call')!
  return handler({ method: 'tools/call', params: { name, arguments: {} } }, undefined)
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

  it('is not called when the tool throws', async () => {
    const resultProperties = vi.fn(() => ({ search_status: 'unexpected' }))
    const server = createServer({ resultProperties }, async () => {
      throw new Error('boom')
    })

    await expect(callTool(server)).rejects.toThrow('boom')
    await flushCaptures()

    expect(resultProperties).not.toHaveBeenCalled()
    expect(toolCallProperties()).not.toHaveProperty('search_status')
  })

  it.each([
    [
      'throws',
      () => {
        throw new Error('callback failed')
      },
    ],
    ['returns an array', () => ['no_results'] as any],
    ['returns a promise', async () => ({ search_status: 'no_results' }) as any],
    ['returns null', () => null],
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
    expect(toolCallProperties()).not.toHaveProperty('0')
    const logged = messages.some((message) => message.includes('resultProperties'))
    expect(logged).toBe(behaviour !== 'returns null')
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
