import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('E2E Sanitization - real MCP tool calls', () => {
  it('should sanitize image content blocks in tool responses', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, fakePostHog(), {
        context: false,
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
      await instrument(server, fakePostHog(), {
        context: false,
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

  it('should sanitize large binary encodings without redacting ordinary long text in tool call parameters', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, fakePostHog(), {
        context: false,
      })

      server.tool(
        'upload_file',
        'Upload a file as base64',
        {
          filename: z.string(),
          classicBase64: z.string().describe('Base64-encoded file data'),
          base64Url: z.string().describe('Base64url-encoded file data'),
          dataUrl: z.string().describe('Base64 data URL'),
          longText: z.string(),
        },
        async (args) => ({
          content: [{ type: 'text', text: `Uploaded ${args.filename} successfully` }],
        })
      )

      // Each binary representation exceeds the 10KB size gate.
      const classicBase64 = `${'A'.repeat(12_000)}=`
      const base64Url = Buffer.from(Array.from({ length: 9_000 }, (_, index) => index % 256)).toString('base64url')
      const wrappedPayload = `${'A'.repeat(11_999)}=`.match(/.{1,76}/g)!.join('\r\n')
      const dataUrl = `data:image/png;base64,${wrappedPayload}`
      const longText = 'This is ordinary long text with words and punctuation. '.repeat(250)

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'upload_file',
            arguments: { filename: 'photo.png', classicBase64, base64Url, dataUrl, longText },
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
      const args = toolEvent!.parameters?.request?.params?.arguments
      expect(args.classicBase64).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
      expect(args.base64Url).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
      expect(args.dataUrl).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
      expect(args.longText).toBe(longText)
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
      await instrument(server, fakePostHog(), {
        context: false,
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

describe('E2E payload personal data', () => {
  const accounts = '{"accounts":{"ada@example.com":{"plan":"pro"}},"card":4111111111111111,"count":3}'

  type Properties = Record<string, unknown>
  const text = (value: unknown) => JSON.stringify(value)
  const firstText = (properties: Properties) =>
    (properties.$mcp_response as { content: { text: string }[] }).content[0].text

  it.each([
    {
      scenario: 'personal data in arguments and results is redacted by default',
      options: {},
      args: { email: 'ada@example.com', limit: 5 },
      result: async () => ({
        content: [{ type: 'text' as const, text: 'Customer ada@example.com last seen from 203.0.113.7' }],
      }),
      check: (call: Properties) => {
        expect(text(call.$mcp_parameters)).not.toContain('ada@example.com')
        expect((call.$mcp_parameters as any).request.params.arguments).toEqual({ email: '[redacted]', limit: 5 })
        expect(text(call.$mcp_response)).not.toContain('ada@example.com')
        expect(text(call.$mcp_response)).not.toContain('203.0.113.7')
      },
    },
    {
      scenario: 'a personal key and a card number in a result are redacted and its JSON stays valid',
      options: {},
      args: {},
      result: async () => ({
        content: [{ type: 'text' as const, text: accounts }],
        structuredContent: JSON.parse(accounts),
      }),
      check: (call: Properties) => {
        expect(text(call.$mcp_response)).not.toContain('ada@example.com')
        expect(text(call.$mcp_response)).not.toContain('4111111111111111')
        expect(firstText(call)).toBe('{"accounts":{"[redacted]":{"plan":"pro"}},"card":"[redacted]","count":3}')
      },
    },
    {
      scenario: 'identifiers that only look like personal data are kept in payloads',
      options: {},
      args: {},
      result: async () => ({
        content: [
          {
            type: 'text' as const,
            text: 'Order 415-555-0142 built with v22.11.0.3, db at 127.0.0.1:5432, client ip:203.0.113.7, support +1 415 555 0142',
          },
        ],
      }),
      check: (call: Properties) => {
        expect(firstText(call)).toBe(
          'Order 415-555-0142 built with v22.11.0.3, db at 127.0.0.1:5432, client ip:[redacted], support [redacted]'
        )
      },
    },
    {
      scenario: 'turning the option off keeps personal data in payloads but not in intent',
      options: { redactPayloadPersonalData: false },
      args: { email: 'ada@example.com', context: 'look up ada@example.com' },
      result: async () => ({ content: [{ type: 'text' as const, text: 'Customer ada@example.com' }] }),
      check: (call: Properties) => {
        expect(text(call.$mcp_parameters)).toContain('ada@example.com')
        expect(text(call.$mcp_response)).toContain('ada@example.com')
        expect(call.$mcp_intent).toBe('look up [redacted]')
      },
    },
    {
      scenario: 'personal data in error text and exceptions is redacted by default',
      options: {},
      args: {},
      result: async (): Promise<never> => {
        throw new Error('No account for ada@example.com')
      },
      check: (call: Properties, everything: unknown) => {
        expect(call.$mcp_error_message).toBe('No account for [redacted]')
        expect(text(everything)).not.toContain('ada@example.com')
      },
    },
  ])('$scenario', async ({ options, args, result, check }) => {
    const { server, client, cleanup } = await setupTestServerAndClient()
    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, fakePostHog(), { enableConversationId: false, ...options })
      server.registerTool(
        'lookup',
        { inputSchema: { email: z.string().optional(), limit: z.number().optional() } },
        result as never
      )

      await client.request({ method: 'tools/call', params: { name: 'lookup', arguments: args } }, CallToolResultSchema)
      await new Promise((resolve) => setTimeout(resolve, 100))

      const [call] = eventCapture.findCapturesByEvent('$mcp_tool_call')
      check(call.properties, eventCapture.getCaptures())
    } finally {
      await eventCapture.stop()
      await cleanup()
    }
  })
})
