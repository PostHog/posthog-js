import { randomUUID } from 'node:crypto'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { track } from '../index'
import { DEFAULT_CONTEXT_PARAMETER_DESCRIPTION } from '../extensions/constants'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { getServerTrackingData } from '../extensions/internal'
import { EventCapture } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('Report Missing Tool', () => {
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

  describe('1. Tool Injection Tests', () => {
    it('should add report_missing to tools list when reportMissing is true', async () => {
      // Enable tracking with report_missing enabled
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
      })

      // Get the tools list
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      // Find report_missing tool
      const reportMissingTool = toolsResponse.tools.find((tool: any) => tool.name === 'get_more_tools')

      // Verify the tool exists with correct properties
      expect(reportMissingTool).toBeDefined()
      expect(reportMissingTool.name).toBe('get_more_tools')
      expect(reportMissingTool.description).toContain('Check for additional tools')

      // Verify context is required
      expect(reportMissingTool.inputSchema.required).toContain('context')
    })

    it('should NOT add get_more_tools when reportMissing is false', async () => {
      // Enable tracking with get_more_tools disabled
      track(server, {
        apiKey: 'test-project',
        reportMissing: false,
        enableTracing: true,
      })

      // Get the tools list
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      // Verify report_missing is not in the list
      const reportMissingTool = toolsResponse.tools.find((tool: any) => tool.name === 'get_more_tools')

      expect(reportMissingTool).toBeUndefined()
    })

    it('should add report_missing WITHOUT context injection even when context is true', async () => {
      // Enable tracking with both features enabled
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        context: true,
        enableTracing: true,
      })

      // Get the tools list
      const toolsResponse = await client.request(
        {
          method: 'tools/list',
          params: {},
        },
        ListToolsResultSchema
      )

      // Find report_missing tool
      const reportMissingTool = toolsResponse.tools.find((tool: any) => tool.name === 'get_more_tools')

      // Verify context is NOT required
      expect(reportMissingTool.inputSchema.required).toContain('context')

      // Check that other tools DO have injected context
      const addTodoTool = toolsResponse.tools.find((tool: any) => tool.name === 'add_todo')
      expect(addTodoTool.inputSchema.properties.context).toEqual({
        type: 'string',
        description: DEFAULT_CONTEXT_PARAMETER_DESCRIPTION,
      })
      expect(addTodoTool.inputSchema.required).toContain('context')
    })
  })

  describe('2. Tool Execution Tests', () => {
    it('should successfully call get_more_tools with only context', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
      })

      const missingDescription = 'Need a database query tool for SQL operations'

      // Call report_missing with only description
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_more_tools',
            arguments: {
              context: missingDescription,
            },
          },
        },
        CallToolResultSchema
      )

      // Verify response
      expect(result.content[0].text).toContain('Unfortunately')

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify event was published
      const events = eventCapture.getEvents()
      const reportEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_more_tools'
      )

      expect(reportEvent).toBeDefined()
      expect(reportEvent?.userIntent).toBe(missingDescription)

      await eventCapture.stop()
    })

    it('should successfully call get_more_tools with description and optional context', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
      })

      const additionalContext = 'User wants to fetch data from external REST APIs'

      // Call report_missing with both parameters
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_more_tools',
            arguments: {
              context: additionalContext,
            },
          },
        },
        CallToolResultSchema
      )

      // Verify response acknowledges the feedback
      expect(result.content[0].text).toContain('Unfortunately')

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify both parameters were captured in the event
      const events = eventCapture.getEvents()
      const reportEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_more_tools'
      )

      expect(reportEvent).toBeDefined()
      expect(reportEvent?.userIntent).toBe(additionalContext)

      await eventCapture.stop()
    })

    it('should handle missing description parameter gracefully', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
      })

      // Call report_missing without required description
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_more_tools',
            arguments: {
              context: 'Some context without description',
            } as any,
          },
        },
        CallToolResultSchema
      )

      // The function handles undefined gracefully
      expect(result.content[0].text).toContain('Unfortunately')

      await eventCapture.stop()
    })
  })

  describe('3. Event Tracking Tests', () => {
    it('should track report_missing events with proper structure', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, { apiKey: 'proj_abc123xyz' })

      const context = 'User wants to monitor file changes in real-time'

      // Call report_missing
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_more_tools',
            arguments: {
              context,
            },
          },
        },
        CallToolResultSchema
      )

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Get the event
      const events = eventCapture.getEvents()
      const reportEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_more_tools'
      )

      // Verify event structure
      expect(reportEvent).toBeDefined()
      expect(reportEvent?.sessionId).toBeDefined()
      expect(reportEvent?.sessionId).not.toBe('')
      expect(reportEvent?.resourceName).toBe('get_more_tools')
      expect(reportEvent?.parameters).toBeDefined()
      expect((reportEvent?.parameters as any).request.params.name).toBe('get_more_tools')
      expect((reportEvent?.parameters as any).request.params.arguments).toEqual({})
      expect(reportEvent?.userIntent).toBe(context)

      await eventCapture.stop()
    })
  })

  describe('4. Integration Tests', () => {
    it('should maintain session continuity when calling report_missing between other tools', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
      })

      // Call add_todo
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'First todo',
              context: 'Adding first todo to test session continuity',
            },
          },
        },
        CallToolResultSchema
      )

      // Call report_missing
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_more_tools',
            arguments: {
              context: 'Need a bulk todo import tool',
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
              context: 'Listing todos after reporting missing tool',
            },
          },
        },
        CallToolResultSchema
      )

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Get all tool call events
      const events = eventCapture.getEvents()
      const toolCallEvents = events.filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

      // Should have 3 events
      expect(toolCallEvents.length).toBe(3)

      // All should have the same session ID
      const sessionIds = toolCallEvents.map((e) => e.sessionId)
      expect(new Set(sessionIds).size).toBe(1)

      // Verify the order and tool names
      expect(toolCallEvents[0].resourceName).toBe('add_todo')
      expect(toolCallEvents[1].resourceName).toBe('get_more_tools')
      expect(toolCallEvents[2].resourceName).toBe('list_todos')

      await eventCapture.stop()
    })

    it('should work correctly with user identification', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const testUserId = `report-user-${randomUUID()}`
      const testUserData = {
        name: `Report Test User ${randomUUID()}`,
        role: 'Developer',
      }

      // Enable tracking with identify
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
        identify: async () => ({
          userId: testUserId,
          userData: testUserData,
        }),
      })

      // Call report_missing (should trigger identify on first tool call)
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_more_tools',
            arguments: {
              context: 'Need GraphQL query builder',
            },
          },
        },
        CallToolResultSchema
      )

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify identify event was triggered
      const events = eventCapture.getEvents()
      const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

      expect(identifyEvent).toBeDefined()
      expect(identifyEvent?.resourceName).toBe('get_more_tools')

      // Verify user identity was stored
      const data = getServerTrackingData(server.server)
      const sessionId = data?.sessionId
      const storedIdentity = data?.identifiedSessions.get(sessionId!)

      expect(storedIdentity).toEqual({
        userId: testUserId,
        userData: testUserData,
      })

      await eventCapture.stop()
    })
  })

  describe('6. Analytics Value Tests', () => {
    it('should provide actionable insights for missing tool reports', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
      })

      // Simulate multiple reports for similar missing tools
      const reports = [
        {
          context: 'Want to query PostgreSQL database',
        },
        {
          context: 'Need to construct complex queries',
        },
        {
          context: 'Managing schema changes',
        },
      ]

      // Submit all reports
      for (const report of reports) {
        await client.request(
          {
            method: 'tools/call',
            params: {
              name: 'get_more_tools',
              arguments: report,
            },
          },
          CallToolResultSchema
        )
      }

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Analyze the events
      const events = eventCapture.getEvents()
      const reportEvents = events.filter(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_more_tools'
      )

      // Verify we captured all reports with useful data
      expect(reportEvents.length).toBe(3)

      // Each event should have structured data for analysis
      reportEvents.forEach((event, index) => {
        expect(event.userIntent).toBe(reports[index].context)
        expect(event.sessionId).toBeDefined()
        expect(event.timestamp).toBeDefined()
      })

      // This data structure allows for:
      // - Grouping by similar keywords (database, SQL)
      // - Time-based analysis
      // - Session-based patterns

      await eventCapture.stop()
    })

    it('should track get_more_tools across different sessions', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // First session
      {
        const setup1 = await setupTestServerAndClient()
        track(setup1.server, {
          apiKey: 'test-project',
          reportMissing: true,
          enableTracing: true,
        })

        await setup1.client.request(
          {
            method: 'tools/call',
            params: {
              name: 'get_more_tools',
              arguments: {
                context: 'Need OAuth integration tool',
              },
            },
          },
          CallToolResultSchema
        )

        await setup1.cleanup()
      }

      // Second session
      {
        const setup2 = await setupTestServerAndClient()
        track(setup2.server, {
          apiKey: 'test-project',
          reportMissing: true,
          enableTracing: true,
        })

        await setup2.client.request(
          {
            method: 'tools/call',
            params: {
              name: 'get_more_tools',
              arguments: {
                context: 'Need OAuth2 authentication tool',
              },
            },
          },
          CallToolResultSchema
        )

        await setup2.cleanup()
      }

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Analyze cross-session patterns
      const events = eventCapture.getEvents()
      const reportEvents = events.filter(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_more_tools'
      )

      // Should have 2 events from different sessions
      expect(reportEvents.length).toBe(2)

      // Different session IDs
      const sessionIds = reportEvents.map((e) => e.sessionId)
      expect(new Set(sessionIds).size).toBe(2)

      // Similar content (OAuth) from different sessions indicates a pattern
      const contexts = reportEvents.map((e) => e.userIntent)
      expect(contexts[0]).toContain('OAuth')
      expect(contexts[1]).toContain('OAuth')

      await eventCapture.stop()
    })

    it('should handle multiple missing tool reports in same session', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking
      track(server, {
        apiKey: 'test-project',
        reportMissing: true,
        enableTracing: true,
      })

      // Simulate a user discovering multiple missing tools during their workflow
      const missingTools = [
        {
          context: 'Importing data from spreadsheets',
        },
        {
          context: 'Need to validate imported data',
        },
        {
          context: 'Process large datasets',
        },
      ]

      // Report all missing tools in sequence
      for (const tool of missingTools) {
        await client.request(
          {
            method: 'tools/call',
            params: {
              name: 'get_more_tools',
              arguments: tool,
            },
          },
          CallToolResultSchema
        )
      }

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Analyze the pattern
      const events = eventCapture.getEvents()
      const reportEvents = events.filter(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'get_more_tools'
      )

      // All from same session
      expect(reportEvents.length).toBe(3)
      const sessionIds = reportEvents.map((e) => e.sessionId)
      expect(new Set(sessionIds).size).toBe(1)

      // The sequence shows a workflow pattern:
      // Import -> Validate -> Process
      // This provides valuable insight into user needs

      await eventCapture.stop()
    })
  })
})
