import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { track } from '../index'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from '../extensions/constants'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { EventCapture } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('Custom Context Description', () => {
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

  it('should use custom description instead of default for JSON Schema tools', async () => {
    const customDescription = 'Explain your reasoning for this action'

    // Enable tracking with custom context description
    track(server, {
      apiKey: 'test-project',
      context: { description: customDescription },
    })

    // Get the tools list
    const toolsResponse = await client.request(
      {
        method: 'tools/list',
        params: {},
      },
      ListToolsResultSchema
    )

    // Find the add_todo tool (uses shorthand Zod syntax)
    const addTodoTool = toolsResponse.tools.find((tool: any) => tool.name === 'add_todo')

    expect(addTodoTool).toBeDefined()
    expect(addTodoTool.inputSchema.properties.context).toBeDefined()
    expect(addTodoTool.inputSchema.properties.context.description).toBe(customDescription)
    expect(addTodoTool.inputSchema.properties.context.description).not.toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
  })

  it('should use custom description for Zod object schemas', async () => {
    const customDescription = "Provide context about why you're doing this"

    // Enable tracking with custom context description
    track(server, {
      apiKey: 'test-project',
      context: { description: customDescription },
    })

    // Get the tools list
    const toolsResponse = await client.request(
      {
        method: 'tools/list',
        params: {},
      },
      ListToolsResultSchema
    )

    // Find the complete_todo tool (uses registerTool with Zod schema)
    const completeTodoTool = toolsResponse.tools.find((tool: any) => tool.name === 'complete_todo')

    expect(completeTodoTool).toBeDefined()
    expect(completeTodoTool.inputSchema.properties.context).toBeDefined()
    expect(completeTodoTool.inputSchema.properties.context.description).toBe(customDescription)
  })

  it('should apply custom description to all tools when listing', async () => {
    const customDescription = 'Why are you calling this tool?'

    // Enable tracking with custom context description
    track(server, {
      apiKey: 'test-project',
      context: { description: customDescription },
    })

    // Get the tools list
    const toolsResponse = await client.request(
      {
        method: 'tools/list',
        params: {},
      },
      ListToolsResultSchema
    )

    // Check all original tools (exclude PostHog MCP analytics-added tools)
    const originalTools = ['add_todo', 'list_todos', 'complete_todo']
    const toolsToCheck = toolsResponse.tools.filter((tool: any) => originalTools.includes(tool.name))

    expect(toolsToCheck.length).toBe(3)

    for (const tool of toolsToCheck) {
      expect(tool.inputSchema.properties.context).toBeDefined()
      expect(tool.inputSchema.properties.context.description).toBe(customDescription)
    }
  })

  it('should capture tool calls with custom description configured', async () => {
    const customDescription = "Tell me what you're trying to accomplish"
    const eventCapture = new EventCapture()
    await eventCapture.start()

    // Enable tracking with custom context description
    track(server, {
      apiKey: 'test-project',
      context: { description: customDescription },
      enableTracing: true,
    })

    // Call a tool with context
    const contextString = 'I need to add a task to my list'
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

    // Wait for events to be processed
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Verify that the event was captured with the user intent
    const events = eventCapture.getEvents()
    const toolCallEvent = events.find(
      (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'add_todo'
    )

    expect(toolCallEvent).toBeDefined()
    expect(toolCallEvent?.userIntent).toBe(contextString)

    await eventCapture.stop()
  })

  it('should use default description when custom context description is not provided', async () => {
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

    // Find the add_todo tool
    const addTodoTool = toolsResponse.tools.find((tool: any) => tool.name === 'add_todo')

    expect(addTodoTool).toBeDefined()
    expect(addTodoTool.inputSchema.properties.context).toBeDefined()
    expect(addTodoTool.inputSchema.properties.context.description).toBe(DEFAULT_CONTEXT_PARAMETER_DESCRIPTION)
  })

  it('should work end-to-end with custom description and multiple tool calls', async () => {
    const customDescription = 'Explain your intent for this operation'
    const eventCapture = new EventCapture()
    await eventCapture.start()

    // Enable tracking with custom context description
    track(server, {
      apiKey: 'test-project',
      context: { description: customDescription },
      enableTracing: true,
    })

    // Verify tools list has custom description
    const toolsResponse = await client.request(
      {
        method: 'tools/list',
        params: {},
      },
      ListToolsResultSchema
    )

    const addTodoTool = toolsResponse.tools.find((tool: any) => tool.name === 'add_todo')
    expect(addTodoTool.inputSchema.properties.context.description).toBe(customDescription)

    // Call add_todo
    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            text: 'First task',
            context: 'Setting up my first task',
          },
        },
      },
      CallToolResultSchema
    )

    // Call complete_todo
    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'complete_todo',
          arguments: {
            id: '1',
            context: 'Finishing the first task',
          },
        },
      },
      CallToolResultSchema
    )

    // Call list_todos
    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'list_todos',
          arguments: {
            context: 'Checking my progress',
          },
        },
      },
      CallToolResultSchema
    )

    // Wait for events to be processed
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Verify all events were captured with user intent
    const events = eventCapture.getEvents()
    const toolCallEvents = events.filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

    expect(toolCallEvents.length).toBeGreaterThanOrEqual(3)

    const addEvent = toolCallEvents.find((e) => e.resourceName === 'add_todo')
    const completeEvent = toolCallEvents.find((e) => e.resourceName === 'complete_todo')
    const listEvent = toolCallEvents.find((e) => e.resourceName === 'list_todos')

    expect(addEvent?.userIntent).toBe('Setting up my first task')
    expect(completeEvent?.userIntent).toBe('Finishing the first task')
    expect(listEvent?.userIntent).toBe('Checking my progress')

    await eventCapture.stop()
  })

  it('should use custom description even with long descriptions', async () => {
    const customDescription =
      'Please provide a comprehensive explanation of your reasoning, including the broader context of this action within your workflow, the expected outcomes, and how this contributes to your overall objectives. Be as detailed as possible.'

    // Enable tracking with long custom context description
    track(server, {
      apiKey: 'test-project',
      context: { description: customDescription },
    })

    // Get the tools list
    const toolsResponse = await client.request(
      {
        method: 'tools/list',
        params: {},
      },
      ListToolsResultSchema
    )

    const addTodoTool = toolsResponse.tools.find((tool: any) => tool.name === 'add_todo')

    expect(addTodoTool.inputSchema.properties.context.description).toBe(customDescription)
  })

  it('should use custom description with special characters', async () => {
    const customDescription = 'Why? (explain in detail) - "Be specific!"'

    // Enable tracking with special characters in description
    track(server, {
      apiKey: 'test-project',
      context: { description: customDescription },
    })

    // Get the tools list
    const toolsResponse = await client.request(
      {
        method: 'tools/list',
        params: {},
      },
      ListToolsResultSchema
    )

    const addTodoTool = toolsResponse.tools.find((tool: any) => tool.name === 'add_todo')

    expect(addTodoTool.inputSchema.properties.context.description).toBe(customDescription)
  })
})
