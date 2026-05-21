import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { track } from '../index'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from '../modules/constants'
import { addContextParameterToTools } from '../modules/context-parameters'
import { MCPAnalyticsEventType } from '../modules/event-types'
import { EventCapture } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('Context Parameters', () => {
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

  describe('addContextParameterToTools', () => {
    it('should add context parameter to tools without inputSchema', () => {
      const tools = [
        {
          name: 'simple_tool',
          description: 'A simple tool',
        },
      ]

      const modifiedTools = addContextParameterToTools(tools)

      expect(modifiedTools[0].inputSchema).toBeDefined()
      expect(modifiedTools[0].inputSchema.type).toBe('object')
      expect(modifiedTools[0].inputSchema.properties.context).toBeDefined()
      expect(modifiedTools[0].inputSchema.properties.context.type).toBe('string')
      expect(modifiedTools[0].inputSchema.required).toContain('context')
    })

    it('should add context parameter to tools with existing inputSchema', () => {
      const tools = [
        {
          name: 'existing_tool',
          description: 'A tool with existing schema',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Some text',
              },
            },
            required: ['text'],
          },
        },
      ]

      const modifiedTools = addContextParameterToTools(tools)

      expect(modifiedTools[0].inputSchema.properties.text).toBeDefined()
      expect(modifiedTools[0].inputSchema.properties.context).toBeDefined()
      expect(modifiedTools[0].inputSchema.properties.context.type).toBe('string')
      expect(modifiedTools[0].inputSchema.required).toContain('text')
      expect(modifiedTools[0].inputSchema.required).toContain('context')
    })

    it('should not duplicate context parameter if already exists', () => {
      const tools = [
        {
          name: 'tool_with_context',
          description: 'A tool that already has context',
          inputSchema: {
            type: 'object',
            properties: {
              context: {
                type: 'string',
                description: 'Existing context',
              },
            },
            required: ['context'],
          },
        },
      ]

      const modifiedTools = addContextParameterToTools(tools)

      expect(modifiedTools[0].inputSchema.properties.context.description).toBe('Existing context')
      expect(modifiedTools[0].inputSchema.required.filter((r: string) => r === 'context')).toHaveLength(1)
    })

    it('should handle tools with empty required array', () => {
      const tools = [
        {
          name: 'optional_tool',
          description: 'A tool with no required fields',
          inputSchema: {
            type: 'object',
            properties: {
              optional: {
                type: 'string',
              },
            },
            required: [],
          },
        },
      ]

      const modifiedTools = addContextParameterToTools(tools)

      expect(modifiedTools[0].inputSchema.required).toContain('context')
      expect(modifiedTools[0].inputSchema.required).toHaveLength(1)
    })
  })

  describe('Integration with MCP server tracking', () => {
    it('should capture context parameter when tools are called after tracking', async () => {
      // Set up event capture
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking on the server
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
        context: true,
      })

      // Call a tool with context
      const contextString = 'Testing context parameter injection for analytics'
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test todo item',
              context: contextString,
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Added todo')

      // Wait a bit for the event to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify that an event was published with the context as userIntent
      const events = eventCapture.getEvents()
      const toolCallEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'add_todo'
      )

      expect(toolCallEvent).toBeDefined()
      expect(toolCallEvent?.userIntent).toBe(contextString)

      await eventCapture.stop()
    })

    it('should work with tools that have context parameter', async () => {
      // Set up event capture
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, { apiKey: 'test-project', context: true })

      // Call complete_todo with context
      // First add a todo
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Todo to complete',
              context: 'Creating a todo to test completion',
            },
          },
        },
        CallToolResultSchema
      )

      // Then complete it with context
      const completionContext = 'Testing completion with context tracking'
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: {
              id: '1',
              context: completionContext,
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Completed todo')

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify the complete_todo event has the context as userIntent
      const events = eventCapture.getEvents()
      const completeEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'complete_todo'
      )

      expect(completeEvent).toBeDefined()
      expect(completeEvent?.userIntent).toBe(completionContext)

      await eventCapture.stop()
    })

    it('should capture userIntent only when context is provided', async () => {
      // Set up event capture
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, { apiKey: 'test-project', context: true })

      // Call list_todos without context - should succeed but have no userIntent
      // Note: Context is advertised as required in JSON Schema (for client/LLM),
      // but not enforced at SDK validation level (Zod schema is not modified)
      const result1 = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: {},
          },
        },
        CallToolResultSchema
      )
      expect(result1.content[0].text).toBeDefined()

      // Call with valid context - should succeed and capture userIntent
      const result2 = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: {
              context: 'Listing todos to check current status',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result2.content[0].text).toBeDefined()

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify events were published
      const events = eventCapture.getEvents()
      const listEvents = events.filter(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'list_todos'
      )

      // Should have at least 2 events (one without context, one with)
      expect(listEvents.length).toBeGreaterThanOrEqual(2)

      // Find event without context - should have no userIntent
      const eventWithoutContext = listEvents.find((e) => !e.userIntent)
      expect(eventWithoutContext).toBeDefined()

      // Find event with context - should have userIntent
      const eventWithContext = listEvents.find((e) => e.userIntent === 'Listing todos to check current status')
      expect(eventWithContext).toBeDefined()

      await eventCapture.stop()
    })

    it('should capture intent from intentFallback when context is missing', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      track(server, {
        apiKey: 'test-project',
        context: true,
        intentFallback: (request) => (request.params?.name === 'list_todos' ? 'Inspecting the todo list' : undefined),
      })

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: {},
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toBeDefined()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const event = eventCapture
        .getEvents()
        .find(
          (candidate) =>
            candidate.eventType === MCPAnalyticsEventType.mcpToolsCall && candidate.resourceName === 'list_todos'
        )

      expect(event?.userIntent).toBe('Inspecting the todo list')
      expect(event?.userIntentSource).toBe('inferred')

      await eventCapture.stop()
    })

    it('should prefer explicit context over intentFallback', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()
      const intentFallback = jest.fn(() => 'Fallback intent')

      track(server, {
        apiKey: 'test-project',
        context: true,
        intentFallback,
      })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: {
              context: 'Listing todos to inspect current work',
            },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 50))

      const event = eventCapture
        .getEvents()
        .find(
          (candidate) =>
            candidate.eventType === MCPAnalyticsEventType.mcpToolsCall && candidate.resourceName === 'list_todos'
        )

      expect(event?.userIntent).toBe('Listing todos to inspect current work')
      expect(event?.userIntentSource).toBe('context_parameter')
      expect(intentFallback).not.toHaveBeenCalled()

      await eventCapture.stop()
    })

    it('should inject context into tool schemas when listing tools', async () => {
      // Enable tracking
      track(server, { apiKey: 'test-project', context: true })

      // Get the tools list
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      // Apply context parameter injection to simulate what the client would see
      const modifiedTools = addContextParameterToTools(toolsResponse.tools)

      // The tracking might add additional tools like report_missing_tool
      // We should check for at least 3 tools (the original ones)
      expect(modifiedTools.length).toBeGreaterThanOrEqual(3)

      // Find the original tools
      const originalTools = ['add_todo', 'list_todos', 'complete_todo']
      const originalModifiedTools = modifiedTools.filter((tool: any) => originalTools.includes(tool.name))

      // Verify the original tools have context parameter in their schema
      expect(originalModifiedTools).toHaveLength(3)
      for (const tool of originalModifiedTools) {
        expect(tool.inputSchema.properties.context).toBeDefined()
        expect(tool.inputSchema.properties.context.type).toBe('string')
        expect(tool.inputSchema.properties.context.description).toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
      }
    })

    it('should use default context description when no custom description is provided', async () => {
      // Enable tracking WITHOUT custom context description
      track(server, { apiKey: 'test-project', context: true })

      // Get the tools list
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      // Find all original tools
      const originalTools = ['add_todo', 'list_todos', 'complete_todo']
      const toolsToCheck = toolsResponse.tools.filter((tool: any) => originalTools.includes(tool.name))

      expect(toolsToCheck.length).toBe(3)

      // Verify all tools use the default description
      for (const tool of toolsToCheck) {
        expect(tool.inputSchema.properties.context).toBeDefined()
        expect(tool.inputSchema.properties.context.description).toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
      }
    })

    it('should remove context parameter before calling tool callback', async () => {
      // Variable to capture what arguments the tool callback actually receives
      let capturedCallbackArguments: any = null

      // Register a test tool that captures its arguments
      const { z } = await import('zod')
      server.tool(
        'test_context_removal',
        'Test tool that captures callback arguments',
        {
          testParam: z.string().describe('A test parameter'),
        },
        async (args: any) => {
          // Capture exactly what arguments this callback receives
          capturedCallbackArguments = { ...args }
          return {
            content: [
              {
                type: 'text',
                text: 'Arguments captured',
              },
            ],
          }
        }
      )

      // Enable tracking with context parameters
      await track(server, {
        apiKey: 'test-project',
        enableTracing: true,
      })

      // Call the test tool WITH context parameter
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'test_context_removal',
            arguments: {
              testParam: 'test-value',
              context: 'This context should be removed before callback',
            },
          },
        },
        CallToolResultSchema
      )

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      // The tool call should succeed.
      expect(result).toBeDefined()
      expect(result.isError).not.toBe(true)

      // Verify that the callback received the testParam
      expect(capturedCallbackArguments).not.toBeNull()
      expect(capturedCallbackArguments).toHaveProperty('testParam')
      expect(capturedCallbackArguments.testParam).toBe('test-value')

      // This is the key assertion: context should NOT be in the arguments
      // that the tool callback received (it should have been removed by the wrapper)
      expect(capturedCallbackArguments).not.toHaveProperty('context')
    })
  })
})
