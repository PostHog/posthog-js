import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { EventCapture } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('E2E Truncation - real MCP tool calls', () => {
  it('should truncate tool responses with text exceeding 32KB', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { track } = await import('../index')
      await track(server, {
        apiKey: 'test-truncation',
        context: false,
        enableTracing: true,
      })

      // Register a tool that returns a very large text response
      server.tool('get_large_report', 'Returns a large report', { topic: z.string() }, async (args) => ({
        content: [
          {
            type: 'text',
            text: `Report on ${args.topic}: ${'x'.repeat(50_000)}`,
          },
        ],
      }))

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_large_report',
            arguments: { topic: 'quarterly sales' },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.getEvents()
      const toolEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_large_report'
      )

      expect(toolEvent).toBeDefined()
      const text = toolEvent!.response.content[0].text
      // Text should be capped at 32KB + "..."
      expect(text.length).toBeLessThanOrEqual(32_768 + 3)
      expect(text.endsWith('...')).toBe(true)

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })

  it('should keep total event size under 100KB for oversized parameters', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { track } = await import('../index')
      await track(server, {
        apiKey: 'test-truncation-params',
        context: false,
        enableTracing: true,
      })

      // Register a tool that accepts very large parameters
      server.tool(
        'process_bulk_data',
        'Processes a bulk data payload',
        {
          dataset: z.string().describe('Large dataset string'),
          metadata: z.string().describe('Metadata string'),
        },
        async () => ({
          content: [{ type: 'text', text: 'Processed successfully' }],
        })
      )

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'process_bulk_data',
            arguments: {
              dataset: 'd'.repeat(80_000),
              metadata: 'm'.repeat(40_000),
            },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.getEvents()
      const toolEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'process_bulk_data'
      )

      expect(toolEvent).toBeDefined()
      const eventSize = new TextEncoder().encode(JSON.stringify(toolEvent)).length
      expect(eventSize).toBeLessThanOrEqual(102_400)

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })

  it('should preserve normal todo responses while truncating large ones', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { track } = await import('../index')
      await track(server, {
        apiKey: 'test-truncation-mixed',
        context: false,
        enableTracing: true,
      })

      server.tool('get_verbose_log', 'Returns a huge log dump', {}, async () => ({
        content: [{ type: 'text', text: `LOG: ${'entry '.repeat(10_000)}` }],
      }))

      // Normal todo call
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: { text: 'Write tests' },
          },
        },
        CallToolResultSchema
      )

      // Oversized call
      await client.request(
        {
          method: 'tools/call',
          params: { name: 'get_verbose_log', arguments: {} },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.getEvents()
      const toolCallEvents = events.filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

      // Normal add_todo response should be fully preserved
      const addTodoEvent = toolCallEvents.find((e) => e.resourceName === 'add_todo')
      expect(addTodoEvent).toBeDefined()
      expect(addTodoEvent!.response.content[0].text).toContain('Added todo')

      // Verbose log response should be truncated
      const logEvent = toolCallEvents.find((e) => e.resourceName === 'get_verbose_log')
      expect(logEvent).toBeDefined()
      const logText = logEvent!.response.content[0].text
      expect(logText.length).toBeLessThanOrEqual(32_768 + 3)

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })

  it('should handle both sanitization and truncation in the same tool call', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { track } = await import('../index')
      await track(server, {
        apiKey: 'test-sanitize-then-truncate',
        context: false,
        enableTracing: true,
      })

      // Tool that returns both an image block AND a huge text block
      server.tool(
        'get_annotated_screenshot',
        'Returns a screenshot with annotations',
        { page: z.string() },
        async () => ({
          content: [
            { type: 'text', text: 'long text '.repeat(5000) },
            {
              type: 'image',
              data: 'iVBORw0KGgo=',
              mimeType: 'image/png',
            },
          ],
        })
      )

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_annotated_screenshot',
            arguments: { page: 'dashboard' },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.getEvents()
      const toolEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_annotated_screenshot'
      )

      expect(toolEvent).toBeDefined()
      const content = toolEvent!.response.content

      // Text block should be truncated
      expect(content[0].text.length).toBeLessThanOrEqual(32_768 + 3)
      expect(content[0].text.endsWith('...')).toBe(true)

      // Image block should be sanitized
      expect(content[1]).toEqual({
        type: 'text',
        text: '[image content redacted - not supported by PostHog MCP analytics]',
      })

      // Total event size should still be under 100KB
      const eventSize = new TextEncoder().encode(JSON.stringify(toolEvent)).length
      expect(eventSize).toBeLessThanOrEqual(102_400)

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })
})
