import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('Basic Server Test', () => {
  it('should be able to call tools without tracking', async () => {
    resetTodos()
    const { client, cleanup } = await setupTestServerAndClient()

    try {
      // List tools first to ensure they're available
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      expect(toolsResponse.tools).toBeDefined()
      expect(toolsResponse.tools.length).toBeGreaterThan(0)

      // Call add_todo
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test todo',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
      expect(result.content[0].text).toContain('Added todo')
    } finally {
      await cleanup()
    }
  })

  it('should be able to access server info from regular Server instance', async () => {
    const { server, cleanup } = await setupTestServerAndClient()

    try {
      // McpServer stores server info in the underlying server.server property
      const underlyingServer = (server as any).server || server
      const serverInfo = (underlyingServer as any)._serverInfo

      expect(serverInfo).toBeDefined()
      expect(serverInfo.name).toBe('test server')
      expect(serverInfo.version).toBe('1.0')
    } finally {
      await cleanup()
    }
  })

  it('should be able to access server info with McpServer if available', async () => {
    // Try to import McpServer
    let McpServer: any
    let hasCompatibleVersion = false

    try {
      const { McpServer: ImportedMcpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
      McpServer = ImportedMcpServer
      hasCompatibleVersion = true
    } catch {
      // McpServer not available in this version
      hasCompatibleVersion = false
    }

    if (!hasCompatibleVersion) {
      console.log('Skipping McpServer server info test - requires @modelcontextprotocol/sdk v1.3.0 or higher')
      return
    }

    // Create McpServer instance
    const mcpServer = new McpServer({
      name: 'test-mcp-server-info',
      version: '2.0.0',
    })

    // Access server info from the underlying server
    const underlyingServer = mcpServer.server
    const serverInfo = (underlyingServer as any)._serverInfo

    expect(serverInfo).toBeDefined()
    expect(serverInfo.name).toBe('test-mcp-server-info')
    expect(serverInfo.version).toBe('2.0.0')
  })

  it('should verify that server info is used by isCompatibleServerType', async () => {
    const { server, cleanup } = await setupTestServerAndClient()

    try {
      // Import our compatibility function
      const { isCompatibleServerType } = await import('../extensions/compatibility')

      // This should not throw since our test server has proper _serverInfo
      const result = isCompatibleServerType(server)
      expect(result).toBe(server)

      // Verify we can still access server info after compatibility check
      // McpServer stores server info in the underlying server.server property
      const underlyingServer = (result as any).server || result
      const serverInfo = (underlyingServer as any)._serverInfo
      expect(serverInfo).toBeDefined()
      expect(serverInfo.name).toBe('test server')
    } finally {
      await cleanup()
    }
  })

  it('should properly trace tools added after instrument() is called', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Import instrument function
      const { instrument } = await import('../index')

      // Call instrument first with a project ID
      await instrument(server, {
        posthog: fakePostHog(),
        context: true,
        enableTracing: true,
      })

      // Add a new tool after instrument() has been called using server.tool()
      server.tool(
        'new_tool_after_track',
        'A tool added after instrument() was called',
        {
          data: z.string().optional().describe('Optional data parameter'),
        },
        async (args) => ({
          content: [
            {
              type: 'text',
              text: `New tool called with data: ${args.data || 'no data'}`,
            },
          ],
        })
      )

      // List tools to verify the new tool appears with context parameter
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      const newTool = toolsResponse.tools.find((t) => t.name === 'new_tool_after_track')
      expect(newTool).toBeDefined()
      expect(newTool?.inputSchema).toBeDefined()

      // Verify that the context parameter was injected
      const inputSchema = newTool?.inputSchema as any
      expect(inputSchema.properties?.context).toBeDefined()
      expect(inputSchema.properties?.context.type).toBe('string')

      // Verify the original data parameter is still there
      expect(inputSchema.properties?.data).toBeDefined()

      // Call the new tool with context to verify it works
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'new_tool_after_track',
            arguments: {
              context: 'Testing new tool after track',
              data: 'test data',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result).toBeDefined()
      expect(result.content[0].text).toContain('test data')
    } finally {
      await cleanup()
    }
  })

  it('should handle tools with shorthand Zod schema syntax (reproduces context injection issue)', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      // Import instrument function
      const { instrument } = await import('../index')

      // Call instrument first with a project ID
      await instrument(server, {
        posthog: fakePostHog(),
        context: true,
        enableTracing: true,
      })

      // Add a tool using shorthand Zod schema syntax (without description string)
      // This mimics the user's code pattern: server.tool("add", { a: z.number(), b: z.number() }, handler)
      server.tool('calculator_add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
        content: [{ type: 'text', text: String(a + b) }],
      }))

      // List tools to verify the new tool appears with context parameter
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      const calculatorTool = toolsResponse.tools.find((t) => t.name === 'calculator_add')
      expect(calculatorTool).toBeDefined()
      expect(calculatorTool?.inputSchema).toBeDefined()

      // Verify that the context parameter was injected
      const inputSchema = calculatorTool?.inputSchema as any
      expect(inputSchema.properties?.context).toBeDefined()
      expect(inputSchema.properties?.context.type).toBe('string')

      // Verify the original parameters are still there
      expect(inputSchema.properties?.a).toBeDefined()
      expect(inputSchema.properties?.b).toBeDefined()

      // Call the tool with context to verify it works
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'calculator_add',
            arguments: {
              context: 'Testing calculator with shorthand syntax',
              a: 5,
              b: 3,
            },
          },
        },
        CallToolResultSchema
      )

      expect(result).toBeDefined()
      expect(result.content[0].text).toBe('8')
    } finally {
      await cleanup()
    }
  })

  it('should publish events only once (no duplicates)', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()

    // Set up event capture
    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      // Import instrument function
      const { instrument } = await import('../index')

      // Call instrument with tracing enabled
      await instrument(server, {
        posthog: fakePostHog(),
        context: true,
        enableTracing: true,
      })

      // Make multiple tool calls to generate events with unique IDs
      const timestamp1 = Date.now()
      const timestamp2 = timestamp1 + 1

      const toolCalls = [
        {
          name: 'add_todo',
          arguments: {
            context: 'test context 1',
            text: `First todo with unique ID: ${timestamp1}`,
          },
        },
        {
          name: 'add_todo',
          arguments: {
            context: 'test context 2',
            text: `Second todo with unique ID: ${timestamp2}`,
          },
        },
        { name: 'list_todos', arguments: { context: 'test context 3' } },
      ]

      for (const toolCall of toolCalls) {
        await client.request(
          {
            method: 'tools/call',
            params: toolCall,
          },
          CallToolResultSchema
        )
      }

      // Wait a bit for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Get captured events
      const events = eventCapture.getEvents()

      // Filter for tool call events
      const toolCallEvents = events.filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

      // Verify we captured some events
      expect(toolCallEvents.length).toBeGreaterThan(0)

      // Check for duplicates by creating a unique ID for each event
      const eventIds = new Set<string>()
      let duplicateFound = false

      for (const event of toolCallEvents) {
        // Create a unique ID based on event properties
        const eventId = `${event.eventType}_${event.resourceName}_${JSON.stringify(event.parameters)}`

        if (eventIds.has(eventId)) {
          duplicateFound = true
          console.error('Duplicate event detected:', eventId)
        } else {
          eventIds.add(eventId)
        }
      }

      // Verify no duplicates were found
      expect(duplicateFound).toBe(false)

      // Verify each tool call resulted in exactly one event
      const addTodoEvents = toolCallEvents.filter((e) => e.resourceName === 'add_todo')
      const listTodosEvents = toolCallEvents.filter((e) => e.resourceName === 'list_todos')

      expect(addTodoEvents.length).toBe(2)
      expect(listTodosEvents.length).toBe(1)

      // Verify unique text in each add_todo event
      const todoTexts = addTodoEvents.map((e) => (e.parameters as any)?.request?.params?.arguments?.text)
      expect(new Set(todoTexts).size).toBe(2) // Should have 2 unique texts

      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })

  it('should handle tools defined BEFORE instrument() with shorthand Zod schema', async () => {
    resetTodos()

    // Create server instance
    const server = new McpServer({
      name: 'test calculator server',
      version: '1.0.0',
    })

    // Define tools BEFORE calling instrument() - exactly like the user's code
    server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))

    server.tool(
      'calculate',
      {
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number(),
        b: z.number(),
      },
      async ({ operation, a, b }) => {
        let result: number
        switch (operation) {
          case 'add':
            result = a + b
            break
          case 'subtract':
            result = a - b
            break
          case 'multiply':
            result = a * b
            break
          case 'divide':
            if (b === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Error: Cannot divide by zero',
                  },
                ],
              }
            }
            result = a / b
            break
          default:
            throw new Error(`Unsupported operation: ${operation}`)
        }
        return {
          content: [{ type: 'text', text: String(result) }],
        }
      }
    )

    // Create client instance
    const client = new Client(
      {
        name: 'test client',
        version: '1.0',
      },
      {
        capabilities: {
          sampling: {},
        },
      }
    )

    // Create transport pair and connect
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await Promise.all([client.connect(clientTransport), server.server.connect(serverTransport)])

    try {
      // Import instrument function
      const { instrument } = await import('../index')

      // NOW call instrument - after tools are already defined
      await instrument(server, {
        posthog: fakePostHog(),
        context: true,
        enableTracing: true,
      })

      // List tools to verify they have context parameter injected
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      // Check the "add" tool
      const addTool = toolsResponse.tools.find((t) => t.name === 'add')
      expect(addTool).toBeDefined()
      expect(addTool?.inputSchema).toBeDefined()

      const addSchema = addTool?.inputSchema as any
      expect(addSchema.properties?.context).toBeDefined()
      expect(addSchema.properties?.context.type).toBe('string')
      expect(addSchema.properties?.a).toBeDefined()
      expect(addSchema.properties?.b).toBeDefined()

      // Check the "calculate" tool
      const calculateTool = toolsResponse.tools.find((t) => t.name === 'calculate')
      expect(calculateTool).toBeDefined()
      expect(calculateTool?.inputSchema).toBeDefined()

      const calculateSchema = calculateTool?.inputSchema as any
      expect(calculateSchema.properties?.context).toBeDefined()
      expect(calculateSchema.properties?.operation).toBeDefined()

      // Call the tools to verify they work
      const addResult = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add',
            arguments: {
              context: 'Testing add with context',
              a: 5,
              b: 3,
            },
          },
        },
        CallToolResultSchema
      )

      expect(addResult).toBeDefined()
      expect(addResult.content[0].text).toBe('8')

      const calcResult = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'calculate',
            arguments: {
              context: 'Testing calculate with context',
              operation: 'multiply',
              a: 4,
              b: 7,
            },
          },
        },
        CallToolResultSchema
      )

      expect(calcResult).toBeDefined()
      expect(calcResult.content[0].text).toBe('28')
    } finally {
      await clientTransport.close?.()
      await serverTransport.close?.()
    }
  })

  it('captures the tool description on tool call events', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()
    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, {
        posthog: fakePostHog(),
        enableTracing: true,
      })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: { text: 'with description' },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 50))

      const toolCallEvent = eventCapture
        .getEvents()
        .find((event) => event.eventType === MCPAnalyticsEventType.mcpToolsCall && event.resourceName === 'add_todo')

      expect(toolCallEvent?.toolDescription).toBe('Add a new todo item')
      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })

  it('captures listed tool names on mcp_tools_list events', async () => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()
    const eventCapture = new EventCapture()
    await eventCapture.start()

    try {
      const { instrument } = await import('../index')
      await instrument(server, {
        posthog: fakePostHog(),
        enableTracing: true,
      })

      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const listEvent = eventCapture.getEvents().find((event) => event.eventType === MCPAnalyticsEventType.mcpToolsList)

      expect(listEvent?.listedToolNames).toEqual(expect.arrayContaining(['add_todo', 'list_todos', 'complete_todo']))
      await eventCapture.stop()
    } finally {
      await cleanup()
    }
  })
})
