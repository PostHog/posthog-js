import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from '../extensions/constants'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const SUBMIT_FEEDBACK = 'submit_feedback'

describe('collectFeedback (submit_feedback virtual tool)', () => {
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
    it('adds submit_feedback with its structured schema when collectFeedback is true', async () => {
      instrument(server, fakePostHog(), { collectFeedback: true })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const tool = tools.find((t: any) => t.name === SUBMIT_FEEDBACK)

      expect(tool).toBeDefined()
      expect(tool.description).toContain('feedback')
      expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['feedback_type', 'sentiment', 'summary']))
      expect(tool.inputSchema.properties.sentiment.enum).toContain('negative')
    })

    it('omits submit_feedback when collectFeedback is false', async () => {
      instrument(server, fakePostHog(), { collectFeedback: false })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === SUBMIT_FEEDBACK)).toBeUndefined()
    })

    it('does not inject the analytics context param into submit_feedback', async () => {
      instrument(server, fakePostHog(), { collectFeedback: true, context: true })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const feedback = tools.find((t: any) => t.name === SUBMIT_FEEDBACK)
      const addTodo = tools.find((t: any) => t.name === 'add_todo')

      // The feedback tool carries its own self-contained schema, not the injected context param.
      expect(feedback.inputSchema.properties.context).toBeUndefined()
      // Regular tools still get the injected default-description context param.
      expect(addTodo.inputSchema.properties.context.description).toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
    })
  })

  describe('tools/call', () => {
    it('captures a $mcp_feedback event with $mcp_-prefixed properties', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: SUBMIT_FEEDBACK,
            arguments: {
              feedback_type: 'mcp',
              sentiment: 'negative',
              summary: 'The list_todos response is hard to parse',
              category: 'tool_output_format',
              suggested_improvement: 'Return structured JSON instead of a text blob',
              task_completed: false,
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Thank you for the feedback')

      await new Promise((r) => setTimeout(r, 50))

      const [feedback] = capture.findCapturesByEvent('$mcp_feedback')
      expect(feedback).toBeDefined()
      expect(feedback.properties.$mcp_feedback_type).toBe('mcp')
      expect(feedback.properties.$mcp_sentiment).toBe('negative')
      expect(feedback.properties.$mcp_summary).toBe('The list_todos response is hard to parse')
      expect(feedback.properties.$mcp_category).toBe('tool_output_format')
      expect(feedback.properties.$mcp_suggested_improvement).toBe('Return structured JSON instead of a text blob')
      expect(feedback.properties.$mcp_task_completed).toBe(false)

      // It's feedback, not a tool invocation.
      expect(capture.findCapturesByEvent('$mcp_feedback')).toHaveLength(1)
      expect(
        capture.findCapturesByEvent('$mcp_tool_call').some((c) => c.properties.$mcp_tool_name === SUBMIT_FEEDBACK)
      ).toBe(false)

      await capture.stop()
    })

    it('omits properties for fields the agent did not supply', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: SUBMIT_FEEDBACK,
            arguments: { feedback_type: 'product', sentiment: 'positive', summary: 'Love the new dashboard' },
          },
        },
        CallToolResultSchema
      )

      await new Promise((r) => setTimeout(r, 50))

      const [feedback] = capture.findCapturesByEvent('$mcp_feedback')
      expect(feedback.properties.$mcp_summary).toBe('Love the new dashboard')
      expect(feedback.properties).not.toHaveProperty('$mcp_category')
      expect(feedback.properties).not.toHaveProperty('$mcp_task_completed')

      await capture.stop()
    })

    it('shares one session across submit_feedback and the surrounding tool calls', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true })

      const calls = [
        { name: 'add_todo', arguments: { text: 'First', context: 'Adding first todo' } },
        { name: SUBMIT_FEEDBACK, arguments: { feedback_type: 'mcp', sentiment: 'mixed', summary: 'Mostly good' } },
        { name: 'list_todos', arguments: { context: 'Reviewing after feedback' } },
      ]

      for (const params of calls) {
        await client.request({ method: 'tools/call', params }, CallToolResultSchema)
      }

      await new Promise((r) => setTimeout(r, 50))
      const captured = capture
        .getEvents()
        .filter(
          (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall || e.eventType === MCPAnalyticsEventType.mcpFeedback
        )

      expect(captured.map((e) => e.resourceName)).toEqual(['add_todo', SUBMIT_FEEDBACK, 'list_todos'])
      expect(new Set(captured.map((e) => e.sessionId)).size).toBe(1)

      await capture.stop()
    })
  })

  describe('custom feedbackToolName', () => {
    const CUSTOM = 'posthog_feedback'

    it('advertises and handles the virtual tool under the custom name', async () => {
      const capture = new EventCapture()
      await capture.start()
      instrument(server, fakePostHog(), { collectFeedback: true, feedbackToolName: CUSTOM })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.find((t: any) => t.name === CUSTOM)).toBeDefined()
      expect(tools.find((t: any) => t.name === SUBMIT_FEEDBACK)).toBeUndefined()

      const result = await client.request(
        {
          method: 'tools/call',
          params: { name: CUSTOM, arguments: { feedback_type: 'other', sentiment: 'neutral', summary: 'Just a note' } },
        },
        CallToolResultSchema
      )
      expect(result.content[0].text).toContain('Thank you for the feedback')

      await new Promise((r) => setTimeout(r, 50))
      const event = capture
        .getEvents()
        .find((e) => e.eventType === MCPAnalyticsEventType.mcpFeedback && e.resourceName === CUSTOM)
      expect(event?.properties?.$mcp_summary).toBe('Just a note')

      await capture.stop()
    })
  })
})
