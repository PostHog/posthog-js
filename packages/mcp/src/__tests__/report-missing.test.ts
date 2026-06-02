import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from '../extensions/constants'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { getServerTrackingData } from '../extensions/internal'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const GET_MORE_TOOLS = 'get_more_tools'

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
      instrument(server, { posthog: fakePostHog(), reportMissing: true })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const tool = tools.find((t: any) => t.name === GET_MORE_TOOLS)

      expect(tool).toBeDefined()
      expect(tool.description).toContain('Check for additional tools')
      expect(tool.inputSchema.required).toContain('context')
    })

    it('omits get_more_tools when reportMissing is false', async () => {
      instrument(server, { posthog: fakePostHog(), reportMissing: false })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === GET_MORE_TOOLS)).toBeUndefined()
    })

    it('does not re-inject the context param into get_more_tools (it already has its own)', async () => {
      instrument(server, { posthog: fakePostHog(), reportMissing: true, context: true })

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

  describe('tools/call', () => {
    it('captures the report as a $mcp_tool_call event with context as userIntent', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, { posthog: fakePostHog(), reportMissing: true })

      const context = 'Need a database query tool for SQL operations'
      const result = await client.request(
        { method: 'tools/call', params: { name: GET_MORE_TOOLS, arguments: { context } } },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Unfortunately')

      await new Promise((r) => setTimeout(r, 50))
      const event = capture
        .getEvents()
        .find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === GET_MORE_TOOLS)

      expect(event?.userIntent).toBe(context)
      expect(event?.sessionId).toBeDefined()
      expect(event?.userIntentSource).toBe('context_parameter')

      await capture.stop()
    })

    it('shares one session across get_more_tools and the surrounding tool calls', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, { posthog: fakePostHog(), reportMissing: true })

      const calls = [
        { name: 'add_todo', arguments: { text: 'First', context: 'Adding first todo' } },
        { name: GET_MORE_TOOLS, arguments: { context: 'Need a bulk import tool' } },
        { name: 'list_todos', arguments: { context: 'Reviewing after reporting missing' } },
      ]

      for (const params of calls) {
        await client.request({ method: 'tools/call', params }, CallToolResultSchema)
      }

      await new Promise((r) => setTimeout(r, 50))
      const captured = capture.getEvents().filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

      expect(captured.map((e) => e.resourceName)).toEqual(['add_todo', GET_MORE_TOOLS, 'list_todos'])
      expect(new Set(captured.map((e) => e.sessionId)).size).toBe(1)

      await capture.stop()
    })

    it('triggers identify on the first get_more_tools call when identify is configured', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, {
        posthog: fakePostHog(),
        reportMissing: true,
        identify: async () => ({ userId: 'user-1', userData: { role: 'developer' } }),
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
        userId: 'user-1',
        userData: { role: 'developer' },
      })

      await capture.stop()
    })
  })
})
