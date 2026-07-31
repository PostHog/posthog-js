import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { instrument } from '../index'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from '../extensions/constants'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { getServerTrackingData } from '../extensions/internal'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const GET_MORE_TOOLS = 'get_more_tools'

function registerRealTool(server: any, name: string): any {
  return server.tool(
    name,
    'A legitimate application tool',
    { value: z.string() },
    async ({ value }: { value: string }) => ({
      content: [{ type: 'text' as const, text: `real handler: ${value}` }],
    })
  )
}

describe('reportMissing (get_more_tools virtual tool)', () => {
  let server: any
  let client: any
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    resetTodos()
    const setup = await setupTestServerAndClient()
    server = setup.server
    client = setup.client
    cleanup = setup.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('tools/list injection', () => {
    it('adds get_more_tools with required context when reportMissing is true', async () => {
      instrument(server, fakePostHog(), { reportMissing: true })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const tool = tools.find((t: any) => t.name === GET_MORE_TOOLS)

      expect(tool).toBeDefined()
      expect(tool.description).toContain('Check for additional tools')
      expect(tool.inputSchema.required).toContain('context')
    })

    it('omits get_more_tools when reportMissing is false', async () => {
      instrument(server, fakePostHog(), { reportMissing: false })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === GET_MORE_TOOLS)).toBeUndefined()
    })

    it('does not re-inject the context param into get_more_tools (it already has its own)', async () => {
      instrument(server, fakePostHog(), { reportMissing: true, context: true })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const reportMissing = tools.find((t: any) => t.name === GET_MORE_TOOLS)
      const addTodo = tools.find((t: any) => t.name === 'add_todo')

      // get_more_tools keeps its own context param (required, but not the default description)
      expect(reportMissing.inputSchema.required).toContain('context')
      expect(reportMissing.inputSchema.properties.context.description).not.toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)

      // Regular tools get the injected default-description context param
      expect(addTodo.inputSchema.properties.context.description).toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
    })
  })

  describe('real tool name collisions', () => {
    it('runs a default-named real tool normally when reportMissing is disabled', async () => {
      registerRealTool(server, GET_MORE_TOOLS)
      instrument(server, fakePostHog(), { reportMissing: false })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.filter((tool: any) => tool.name === GET_MORE_TOOLS)).toHaveLength(1)

      const result = await client.request(
        {
          method: 'tools/call',
          params: { name: GET_MORE_TOOLS, arguments: { value: 'disabled', context: 'Call the real tool' } },
        },
        CallToolResultSchema
      )
      expect(result.content[0].text).toBe('real handler: disabled')
    })

    it('warns and runs a default-named real tool normally when reportMissing is enabled', async () => {
      const logger = jest.fn()
      registerRealTool(server, GET_MORE_TOOLS)
      instrument(server, fakePostHog(), { reportMissing: true, enableConversationId: true, logger })

      // Registry ownership is available even before tools/list is called.
      const preListResult = await client.request(
        {
          method: 'tools/call',
          params: { name: GET_MORE_TOOLS, arguments: { value: 'before-list', context: 'Call the real tool' } },
        },
        CallToolResultSchema
      )
      expect(preListResult.content[0].text).toBe('real handler: before-list')

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const collidingTools = tools.filter((tool: any) => tool.name === GET_MORE_TOOLS)
      expect(collidingTools).toHaveLength(1)
      expect(collidingTools[0].inputSchema.properties.conversation_id).toBeDefined()
      expect(logger).toHaveBeenCalledWith(expect.stringContaining('real tool already uses that name'))

      const result = await client.request(
        {
          method: 'tools/call',
          params: { name: GET_MORE_TOOLS, arguments: { value: 'enabled', context: 'Call the real tool' } },
        },
        CallToolResultSchema
      )
      expect(result.content[0].text).toBe('real handler: enabled')
    })

    it('warns and runs a custom-named real tool normally when the configured name collides', async () => {
      const customName = 'posthog_find_tools'
      const logger = jest.fn()
      registerRealTool(server, customName)
      instrument(server, fakePostHog(), { reportMissing: true, missingCapabilityToolName: customName, logger })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.filter((tool: any) => tool.name === customName)).toHaveLength(1)
      expect(logger).toHaveBeenCalledWith(expect.stringContaining(`"${customName}"`))

      const result = await client.request(
        {
          method: 'tools/call',
          params: { name: customName, arguments: { value: 'custom', context: 'Call the custom real tool' } },
        },
        CallToolResultSchema
      )
      expect(result.content[0].text).toBe('real handler: custom')
    })

    it('uses the virtual tool when a colliding high-level registration is disabled', async () => {
      const registeredTool = registerRealTool(server, GET_MORE_TOOLS)
      registeredTool.disable()
      instrument(server, fakePostHog(), { reportMissing: true })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const matchingTools = tools.filter((tool: any) => tool.name === GET_MORE_TOOLS)
      expect(matchingTools).toHaveLength(1)
      expect(matchingTools[0].description).toContain('Check for additional tools')

      const result = await client.request(
        {
          method: 'tools/call',
          params: { name: GET_MORE_TOOLS, arguments: { context: 'Need a database tool' } },
        },
        CallToolResultSchema
      )
      expect(result.content[0].text).toContain('Unfortunately')
    })

    it('preserves validation failures from a colliding real tool', async () => {
      registerRealTool(server, GET_MORE_TOOLS)
      instrument(server, fakePostHog(), { reportMissing: true })

      const result = await client.request(
        {
          method: 'tools/call',
          params: { name: GET_MORE_TOOLS, arguments: { context: 'Missing the required real-tool value' } },
        },
        CallToolResultSchema
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/Invalid|required/i)
      expect(result.content[0].text).not.toContain('Unfortunately')
    })
  })

  describe('tools/call', () => {
    it('handles a fresh-instance call without a prior tools/list request', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { reportMissing: true, enableConversationId: true })

      const context = 'Need a database query tool for SQL operations'
      const result = await client.request(
        { method: 'tools/call', params: { name: GET_MORE_TOOLS, arguments: { context } } },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Unfortunately')
      expect(result.content).toHaveLength(1)

      await new Promise((r) => setTimeout(r, 50))
      const event = capture
        .getEvents()
        .find((e) => e.eventType === MCPAnalyticsEventType.mcpMissingCapability && e.resourceName === GET_MORE_TOOLS)

      expect(event?.userIntent).toBe(context)
      expect(event?.sessionId).toBeDefined()
      expect(event?.userIntentSource).toBe('context_parameter')
      expect(event?.conversationId).toBeUndefined()

      // It's a capability gap, not a tool invocation.
      expect(capture.findCapturesByEvent('$mcp_missing_capability')).toHaveLength(1)
      expect(
        capture.findCapturesByEvent('$mcp_tool_call').some((c) => c.properties.$mcp_tool_name === GET_MORE_TOOLS)
      ).toBe(false)

      await capture.stop()
    })

    it('shares one session across get_more_tools and the surrounding tool calls', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { reportMissing: true })

      const calls = [
        { name: 'add_todo', arguments: { text: 'First', context: 'Adding first todo' } },
        { name: GET_MORE_TOOLS, arguments: { context: 'Need a bulk import tool' } },
        { name: 'list_todos', arguments: { context: 'Reviewing after reporting missing' } },
      ]

      for (const params of calls) {
        await client.request({ method: 'tools/call', params }, CallToolResultSchema)
      }

      await new Promise((r) => setTimeout(r, 50))
      const captured = capture
        .getEvents()
        .filter(
          (e) =>
            e.eventType === MCPAnalyticsEventType.mcpToolsCall ||
            e.eventType === MCPAnalyticsEventType.mcpMissingCapability
        )

      expect(captured.map((e) => e.resourceName)).toEqual(['add_todo', GET_MORE_TOOLS, 'list_todos'])
      expect(new Set(captured.map((e) => e.sessionId)).size).toBe(1)

      await capture.stop()
    })

    it('triggers identify on the first get_more_tools call when identify is configured', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), {
        reportMissing: true,
        identify: async () => ({ distinctId: 'user-1', properties: { role: 'developer' } }),
      })

      await client.request(
        { method: 'tools/call', params: { name: GET_MORE_TOOLS, arguments: { context: 'Need GraphQL tool' } } },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))

      const identifyEvent = capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.identify)
      expect(identifyEvent?.resourceName).toBe(GET_MORE_TOOLS)

      const data = getServerTrackingData(server.server)
      expect(data?.identifiedSessions.get(data.sessionId)).toEqual({
        distinctId: 'user-1',
        properties: { role: 'developer' },
      })

      await capture.stop()
    })
  })

  describe('custom missingCapabilityToolName', () => {
    const CUSTOM = 'posthog_find_tools'

    it('advertises and handles the virtual tool under the custom name', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { reportMissing: true, missingCapabilityToolName: CUSTOM })

      // Detected + captured on a fresh instance before any tools/list request.
      const result = await client.request(
        { method: 'tools/call', params: { name: CUSTOM, arguments: { context: 'Need a deploy tool' } } },
        CallToolResultSchema
      )
      expect(result.content[0].text).toContain('Unfortunately')

      // Advertised under the custom name, not the default.
      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === CUSTOM)).toBeDefined()
      expect(tools.find((t: any) => t.name === GET_MORE_TOOLS)).toBeUndefined()

      await new Promise((r) => setTimeout(r, 50))
      const event = capture
        .getEvents()
        .find((e) => e.eventType === MCPAnalyticsEventType.mcpMissingCapability && e.resourceName === CUSTOM)
      expect(event?.userIntent).toBe('Need a deploy tool')

      await capture.stop()
    })
  })
})
