import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { track } from '../index'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'
import { EventCapture } from './test-utils'

describe('Error Capture Integration Tests', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    resetTodos()
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('should capture stack traces when tool throws Error', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Track the server with mcpAnalytics (uses default settings including context parameters)
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call a tool that throws an error (complete_todo with invalid ID)
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: {
              id: 'nonexistent-id',
              context: 'Testing error capture',
            },
          },
        },
        CallToolResultSchema
      )

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true)

      // Wait for event to be captured
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName('complete_todo')
      expect(events.length).toBeGreaterThan(0)

      const errorEvent = events.find((e) => e.isError)
      expect(errorEvent).toBeDefined()
      expect(errorEvent!.isError).toBe(true)

      // Verify error structure
      expect(errorEvent!.error).toBeDefined()
      expect(errorEvent!.error!.message).toContain('not found')

      // Make sure execution error is properly recognized as an error
      expect(errorEvent!.error!.type).toBe('Error')
      expect(errorEvent!.error!.stack).toBeDefined()
      expect(errorEvent!.error!.frames).toBeDefined()
      expect(errorEvent!.error!.frames!.length).toBeGreaterThan(0)
    } finally {
      await cleanup()
    }
  })

  it('should capture Error.cause chains', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Add a tool that throws an error with a cause
      server.tool('error_with_cause', 'Throws error with cause', {}, async () => {
        const rootCause = new Error('Root cause error')
        const wrapperError = new Error('Wrapper error', { cause: rootCause })
        throw wrapperError
      })

      // Track the server
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call the error-throwing tool
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'error_with_cause',
            arguments: {
              context: 'Testing error.cause chains',
            },
          },
        },
        CallToolResultSchema
      )

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true)

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName('error_with_cause')
      expect(events.length).toBeGreaterThan(0)

      const errorEvent = events.find((e) => e.isError)
      expect(errorEvent).toBeDefined()

      // Ensure we get the real Error type
      expect(errorEvent!.error!.type).toBe('Error')
      expect(errorEvent!.error!.message).toContain('Wrapper error')

      // Verify we captured the full error with stack trace
      expect(errorEvent!.error!.stack).toBeDefined()
      expect(errorEvent!.error!.frames).toBeDefined()

      // Error.cause chains should be captured
      expect(errorEvent!.error!.chained_errors).toBeDefined()
      expect(errorEvent!.error!.chained_errors!.length).toBe(1)
      expect(errorEvent!.error!.chained_errors![0].message).toBe('Root cause error')
    } finally {
      await cleanup()
    }
  })

  it('should capture TypeError with correct type', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Add a tool that throws a TypeError
      server.tool('type_error_tool', 'Throws TypeError', {}, async () => {
        const obj: any = null
        return obj.property // This will throw TypeError
      })

      // Track the server
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call the error-throwing tool
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'type_error_tool',
            arguments: {
              context: 'Testing TypeError capture',
            },
          },
        },
        CallToolResultSchema
      )

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true)

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName('type_error_tool')
      const errorEvent = events.find((e) => e.isError)

      expect(errorEvent).toBeDefined()
      // With callback-level capture, we preserve the specific error type
      expect(errorEvent!.error!.type).toBe('TypeError')
      expect(errorEvent!.error!.message).toContain('null')
      expect(errorEvent!.error!.stack).toBeDefined()
      expect(errorEvent!.error!.frames).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('should capture non-Error thrown values', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Add a tool that throws a string
      server.tool('throw_string', 'Throws string', {}, async () => {
        await Promise.reject('This is a string error')
      })

      // Track the server
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call the error-throwing tool
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'throw_string',
            arguments: {
              context: 'Testing non-Error thrown values',
            },
          },
        },
        CallToolResultSchema
      )

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true)

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName('throw_string')
      const errorEvent = events.find((e) => e.isError)

      expect(errorEvent).toBeDefined()
      expect(errorEvent!.error!.type).toBeUndefined()
      expect(errorEvent!.error!.message).toContain('This is a string error')
      // Non-Error throws don't have stack traces
      // (SDK converts them, we can't capture at callback level)
      expect(errorEvent!.error!.stack).toBeUndefined()
      expect(errorEvent!.error!.frames).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it.skip('should detect in_app frames correctly', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Track the server
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call a tool that throws an error
      const result = await client.request({
        method: 'tools/call',
        params: {
          name: 'complete_todo',
          arguments: {
            id: 'bad-id',
            context: 'Testing in_app frame detection',
          },
        },
        CallToolResultSchema,
      })

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true)

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.findEventsByResourceName('complete_todo')
      const errorEvent = events.find((e) => e.isError)

      expect(errorEvent).toBeDefined()
      expect(errorEvent!.error!.frames).toBeDefined()

      // Check that we have both in_app and library frames
      const hasInAppFrame = errorEvent!.error!.frames!.some((frame) => frame.in_app)
      const hasLibraryFrame = errorEvent!.error!.frames!.some((frame) => !frame.in_app)

      // At least one frame should be from user code
      expect(hasInAppFrame).toBe(true)
      expect(typeof hasLibraryFrame).toBe('boolean')
    } finally {
      await cleanup()
    }
  })

  it('should still propagate errors to MCP client', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Track the server
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Verify that the error is still returned to the client
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: {
              id: 'invalid',
              context: 'Testing error propagation',
            },
          },
        },
        CallToolResultSchema
      )

      // MCP returns errors as tool results with isError: true
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not found')
    } finally {
      await cleanup()
    }
  })

  it('should NOT publish identify events when identify function throws', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Track with an identify function that throws
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async () => {
          throw new Error('Identify error')
        },
      })

      // Make a tool call to trigger identify
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: {
              context: 'Testing identify error capture',
            },
          },
        },
        CallToolResultSchema
      )

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify NO identify event was published (errors in identify should only be logged, not published)
      const events = eventCapture.getEvents()
      const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

      expect(identifyEvent).toBeUndefined()

      // Verify the tool call event was still published
      const toolCallEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)
      expect(toolCallEvent).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('should handle successful tool calls without errors', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Track the server
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Make a successful tool call
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test todo',
              context: 'Testing successful tool calls',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result).toBeDefined()

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.findEventsByResourceName('add_todo')
      expect(events.length).toBeGreaterThan(0)

      const successEvent = events.at(-1)
      expect(successEvent?.isError).toBe(false)
      expect(successEvent?.duration).toEqual(expect.any(Number))
      expect(successEvent?.error).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('should capture validation errors for invalid enum values', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Add a tool with enum validation
      server.tool(
        'calculate',
        'Perform calculations',
        {
          operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
          a: z.number(),
          b: z.number(),
        },
        async (args) => ({
          content: [{ type: 'text', text: `Result: ${args.a}` }],
        })
      )

      // Track the server
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call with invalid enum value - should throw before callback executes
      try {
        await client.request(
          {
            method: 'tools/call',
            params: {
              name: 'calculate',
              arguments: {
                operation: 'modulo', // Invalid enum value
                a: 10,
                b: 3,
                context: 'Testing validation error capture',
              },
            },
          },
          CallToolResultSchema
        )
        expect.fail('Should have thrown validation error')
      } catch (error: any) {
        // MCP SDK throws validation errors, doesn't return CallToolResult
        expect(error).toBeDefined()
      }

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName('calculate')
      expect(events.length).toBeGreaterThan(0)

      const errorEvent = events.find((e) => e.isError)
      expect(errorEvent).toBeDefined()

      // Verify error captured
      expect(errorEvent!.error).toBeDefined()
      expect(errorEvent!.error!.message).toContain('Invalid')

      // Type can vary by SDK version
      // SDK 1.11.5: "McpError" (actual Error), SDK 1.21.0+: undefined (CallToolResult)
      expect(['McpError', 'Error', undefined]).toContain(errorEvent!.error!.type)

      // Stack trace may be present (older SDK) or not (newer SDK)
      // Don't require it but verify format if present
      if (errorEvent!.error!.stack) {
        expect(errorEvent!.error!.stack!.length).toBeGreaterThan(0)
      }

      // Frames may be present
      if (errorEvent!.error!.frames) {
        expect(errorEvent!.error!.frames!.length).toBeGreaterThan(0)
      }
    } finally {
      await cleanup()
    }
  })

  it('should capture errors for unknown tool names', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Track the server
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call non-existent tool
      try {
        await client.request(
          {
            method: 'tools/call',
            params: {
              name: 'nonexistent_tool',
              arguments: {
                context: 'Testing unknown tool error',
              },
            },
          },
          CallToolResultSchema
        )
        expect.fail('Should have thrown unknown tool error')
      } catch (error: any) {
        // SDK throws error for unknown tools
        expect(error).toBeDefined()
      }

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Find the tool call event
      const events = eventCapture.findEventsByResourceName('nonexistent_tool')
      expect(events.length).toBeGreaterThan(0)

      const errorEvent = events.find((e) => e.isError)
      expect(errorEvent).toBeDefined()

      // Verify error captured
      expect(errorEvent!.error!.message).toContain('not found')

      // Type can vary by SDK version
      // SDK 1.11.5: "McpError" (actual Error), SDK 1.21.0+: undefined (CallToolResult)
      expect(['McpError', 'Error', undefined]).toContain(errorEvent!.error!.type)

      // Stack trace may be present (verify if present)
      if (errorEvent!.error!.stack) {
        expect(errorEvent!.error!.stack!.length).toBeGreaterThan(0)
      }
      if (errorEvent!.error!.frames) {
        expect(errorEvent!.error!.frames!.length).toBeGreaterThan(0)
      }
    } finally {
      await cleanup()
    }
  })

  it('should capture validation errors for missing required parameters', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // add_todo requires 'text' parameter
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call without required parameter
      try {
        await client.request(
          {
            method: 'tools/call',
            params: {
              name: 'add_todo',
              arguments: {
                context: 'Testing missing parameter',
                // 'text' parameter is missing
              },
            },
          },
          CallToolResultSchema
        )
        expect.fail('Should have thrown validation error')
      } catch (error: any) {
        expect(error).toBeDefined()
      }

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      const events = eventCapture.findEventsByResourceName('add_todo')
      const errorEvent = events.find((e) => e.isError)

      expect(errorEvent).toBeDefined()
      expect(errorEvent!.error!.message).toContain('Invalid')

      // Type can vary by SDK version
      // SDK 1.11.5: "McpError" (actual Error), SDK 1.21.0+: undefined (CallToolResult)
      expect(['McpError', 'Error', undefined]).toContain(errorEvent!.error!.type)

      // Stack trace may be present (verify if present)
      if (errorEvent!.error!.stack) {
        expect(errorEvent!.error!.stack!.length).toBeGreaterThan(0)
      }
    } finally {
      await cleanup()
    }
  })

  it('should publish exactly one event per tool call', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Make a successful tool call
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: {
              context: 'Testing single event publishing',
            },
          },
        },
        CallToolResultSchema
      )

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Verify exactly one event for this call
      const events = eventCapture.findEventsByResourceName('list_todos')
      const successEvents = events.filter((e) => !e.isError)

      // Should be exactly 1 event, not 2 (which would indicate double publishing)
      expect(successEvents.length).toBe(1)
    } finally {
      await cleanup()
    }
  })
})
