import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { EventCapture } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('E2E Sanitization - real MCP tool calls', () => {
  it('should sanitize image content blocks in tool responses', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, {
        projectToken: 'test-sanitization',
        context: false,
        enableTracing: true,
        // Off: the prompt-back appended on first mint would add an extra
        // content block and break this test's response-shape assertions.
        enableConversationId: false,
      })

      // Register a tool that returns an image content block
      server.tool(
        'get_attachment',
        'Returns an image attachment',
        { id: z.string().describe('Attachment ID') },
        async () => ({
          content: [
            { type: 'text', text: 'Here is the attachment:' },
            {
              type: 'image',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
              mimeType: 'image/png',
            },
          ],
        })
      )

      await client.request(
        {
          method: 'tools/call',
          params: { name: 'get_attachment', arguments: { id: 'att_1' } },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.getEvents()
      const toolEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_attachment'
      )

      expect(toolEvent).toBeDefined()
      const content = toolEvent!.response.content
      expect(content).toHaveLength(2)
      // Text block preserved
      expect(content[0]).toEqual({
        type: 'text',
        text: 'Here is the attachment:',
      })
      // Image block redacted to text
      expect(content[1]).toEqual({
        type: 'text',
        text: '[image content redacted - not supported by PostHog MCP analytics]',
      })

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })

  it('should sanitize audio content blocks in tool responses', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, {
        projectToken: 'test-sanitization-audio',
        context: false,
        enableTracing: true,
      })

      server.tool('get_audio_clip', 'Returns an audio clip', { clipId: z.string() }, async () => ({
        content: [
          {
            type: 'audio',
            data: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEA',
            mimeType: 'audio/wav',
          },
        ],
      }))

      await client.request(
        {
          method: 'tools/call',
          params: { name: 'get_audio_clip', arguments: { clipId: 'clip_1' } },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.getEvents()
      const toolEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_audio_clip'
      )

      expect(toolEvent).toBeDefined()
      expect(toolEvent!.response.content[0]).toEqual({
        type: 'text',
        text: '[audio content redacted - not supported by PostHog MCP analytics]',
      })

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })

  it('should sanitize large base64 strings in tool call parameters', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, {
        projectToken: 'test-sanitization-base64',
        context: false,
        enableTracing: true,
      })

      server.tool(
        'upload_file',
        'Upload a file as base64',
        {
          filename: z.string(),
          data: z.string().describe('Base64-encoded file data'),
        },
        async (args) => ({
          content: [{ type: 'text', text: `Uploaded ${args.filename} successfully` }],
        })
      )

      // Create a large base64 string (>10KB to trigger the size gate)
      const largeBase64 = `${'A'.repeat(12_000)}=`

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'upload_file',
            arguments: { filename: 'photo.png', data: largeBase64 },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.getEvents()
      const toolEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'upload_file'
      )

      expect(toolEvent).toBeDefined()
      // The base64 param should be redacted in the captured event's parameters
      const args = toolEvent!.parameters?.request?.params?.arguments
      expect(args.data).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
      // Non-base64 params should be preserved
      expect(args.filename).toBe('photo.png')

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })

  it('should preserve normal todo tool calls while sanitizing problematic ones', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, {
        projectToken: 'test-sanitization-mixed',
        context: false,
        enableTracing: true,
      })

      // Register a tool with image response alongside existing todo tools
      server.tool('get_todo_screenshot', 'Returns a screenshot of todos', {}, async () => ({
        content: [
          { type: 'text', text: 'Screenshot of current todos:' },
          {
            type: 'image',
            data: 'iVBORw0KGgo=',
            mimeType: 'image/png',
          },
        ],
      }))

      // Call a normal todo tool
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: { text: 'Buy groceries' },
          },
        },
        CallToolResultSchema
      )

      // Call the image-returning tool
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_todo_screenshot',
            arguments: {},
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.getEvents()
      const toolCallEvents = events.filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

      // Normal add_todo event should have its text response preserved
      const addTodoEvent = toolCallEvents.find((e) => e.resourceName === 'add_todo')
      expect(addTodoEvent).toBeDefined()
      expect(addTodoEvent!.response.content[0].type).toBe('text')
      expect(addTodoEvent!.response.content[0].text).toContain('Added todo')

      // Screenshot event should have its image block sanitized
      const screenshotEvent = toolCallEvents.find((e) => e.resourceName === 'get_todo_screenshot')
      expect(screenshotEvent).toBeDefined()
      expect(screenshotEvent!.response.content[0]).toEqual({
        type: 'text',
        text: 'Screenshot of current todos:',
      })
      expect(screenshotEvent!.response.content[1]).toEqual({
        type: 'text',
        text: '[image content redacted - not supported by PostHog MCP analytics]',
      })

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })
})
