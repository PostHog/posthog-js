import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolResultSchema, ListToolsRequestSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import type { MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

/** `sendToolsListEvent: false` sends no `$mcp_tools_list`, and nothing else changes. */
describe('sendToolsListEvent', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it.each([true, false])('sendToolsListEvent: %s controls only the listing event', async (sendToolsListEvent) => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()
    try {
      instrument(server, fakePostHog(), { sendToolsListEvent })

      const listing = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      await client.request(
        { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 'milk', context: 'adding' } } },
        CallToolResultSchema
      )
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(eventCapture.findCapturesByEvent('$mcp_tools_list')).toHaveLength(sendToolsListEvent ? 1 : 0)
      // The listing itself is unchanged: the SDK still injects `context`.
      const addTodo = listing.tools.find((tool) => tool.name === 'add_todo')
      expect(addTodo?.inputSchema.properties).toHaveProperty('context')
      const calls = eventCapture.findCapturesByEvent('$mcp_tool_call')
      expect(calls).toHaveLength(1)
      expect(calls[0].properties.$mcp_intent).toBe('adding')
    } finally {
      await cleanup()
    }
  })

  it('also drops a failed listing and its $exception', async () => {
    const server = new Server({ name: 'failing-listing', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      throw new Error('listing failed')
    })
    instrument(server, fakePostHog(), { sendToolsListEvent: false })

    const handler = (server as unknown as MCPServerLike)._requestHandlers.get('tools/list')
    await expect(handler?.({ method: 'tools/list', params: {} }, undefined)).rejects.toThrow('listing failed')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(eventCapture.findCapturesByEvent('$mcp_tools_list')).toHaveLength(0)
    expect(eventCapture.findCapturesByEvent('$exception')).toHaveLength(0)
  })
})
