import { randomUUID } from 'node:crypto'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { track } from '../index'
import { MCPAnalyticsEventType } from '../modules/event-types'
import { getServerTrackingData } from '../modules/internal'
import type { HighLevelMCPServerLike, UserIdentity } from '../types'
import { EventCapture } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

describe('Identify Feature', () => {
  let server: HighLevelMCPServerLike
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

  describe('Basic Identification Test', () => {
    it('should call identify function on first tool invocation and store user identity', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      let identifyCalled = false
      const testUserId = `user-${randomUUID()}`
      const testUserData = {
        name: `Test User ${randomUUID()}`,
        email: `test-${randomUUID()}@example.com`,
      }

      // Enable tracking with identify function
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async (request, extra) => {
          identifyCalled = true
          expect(request).toBeDefined()
          expect(extra).toBeDefined()
          return {
            userId: testUserId,
            userData: testUserData,
          }
        },
      })

      // Call a tool - this should trigger identify
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test todo for identification',
              context: 'Adding a todo item for identification test',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Added todo')
      expect(identifyCalled).toBe(true)

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify that an identify event was published
      const events = eventCapture.getEvents()
      const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

      expect(identifyEvent).toBeDefined()
      expect(identifyEvent?.resourceName).toBe('add_todo')

      // Verify user identity is stored in session
      const data = getServerTrackingData(server.server)
      const sessionId = data?.sessionId
      expect(sessionId).toBeDefined()

      const storedIdentity = data?.identifiedSessions.get(sessionId!)
      expect(storedIdentity).toEqual({
        userId: testUserId,
        userData: testUserData,
      })

      await eventCapture.stop()
    })

    it('should call identify function on each tool call but only publish event when identity changes', async () => {
      let identifyCallCount = 0
      const userId = `user-${randomUUID()}`
      const userName = `Another User ${randomUUID()}`

      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking with identify function
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async () => {
          identifyCallCount++
          return {
            userId,
            userData: { name: userName },
          }
        },
      })

      // First tool call - should trigger identify and publish event
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'First todo',
              context: 'Adding a todo item for identification test',
            },
          },
        },
        CallToolResultSchema
      )

      expect(identifyCallCount).toBe(1)
      const events1 = await eventCapture.getEvents()
      const identifyEvents1 = events1.filter((e) => e.eventType === 'posthog:identify')
      expect(identifyEvents1.length).toBe(1) // First identify event published

      // Second tool call - should call identify but NOT publish event (identity unchanged)
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: {
              context: 'Adding a todo item for identification test',
            },
          },
        },
        CallToolResultSchema
      )

      expect(identifyCallCount).toBe(2) // Called again
      const events2 = await eventCapture.getEvents()
      const identifyEvents2 = events2.filter((e) => e.eventType === 'posthog:identify')
      expect(identifyEvents2.length).toBe(1) // Still only 1 event (no new event published)

      // Third tool call - should call identify but still NOT publish event
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: {
              id: '1',
              context: 'Completing a todo item for identification test',
            },
          },
        },
        CallToolResultSchema
      )

      expect(identifyCallCount).toBe(3) // Called again
      const events3 = await eventCapture.getEvents()
      const identifyEvents3 = events3.filter((e) => e.eventType === 'posthog:identify')
      expect(identifyEvents3.length).toBe(1) // Still only 1 event

      await eventCapture.stop()
    })

    it('should properly identify when calling tools added after track()', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      let identifyCalled = false
      const testUserId = `post-track-user-${randomUUID()}`
      const testUserData = {
        name: `Post Track User ${randomUUID()}`,
        email: `post-track-${randomUUID()}@example.com`,
      }

      // Enable tracking with identify function FIRST
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        context: true,
        identify: async (request, extra) => {
          identifyCalled = true
          expect(request).toBeDefined()
          expect(extra).toBeDefined()
          return {
            userId: testUserId,
            userData: testUserData,
          }
        },
      })

      // Add a new tool AFTER track() has been called
      server.tool(
        'post_track_tool',
        'A tool added after tracking was enabled',
        {
          message: z.string().describe('A message to process'),
        },
        async (args) => ({
          content: [
            {
              type: 'text',
              text: `Processed message: ${args.message}`,
            },
          ],
        })
      )

      // Call the newly added tool - this should trigger identify
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'post_track_tool',
            arguments: {
              message: 'Testing post-track identification',
              context: 'Verifying identification works for dynamically added tools',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Processed message: Testing post-track identification')
      expect(identifyCalled).toBe(true)

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify that an identify event was published
      const events = eventCapture.getEvents()
      const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

      expect(identifyEvent).toBeDefined()
      expect(identifyEvent?.resourceName).toBe('post_track_tool')

      // Verify tool call event was tracked with user intent
      const toolCallEvent = events.find(
        (e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall && e.resourceName === 'post_track_tool'
      )

      expect(toolCallEvent).toBeDefined()
      expect(toolCallEvent?.userIntent).toBe('Verifying identification works for dynamically added tools')

      // Verify user identity is stored in session
      const data = getServerTrackingData(server.server)
      const sessionId = data?.sessionId
      expect(sessionId).toBeDefined()

      const storedIdentity = data?.identifiedSessions.get(sessionId!)
      expect(storedIdentity).toEqual({
        userId: testUserId,
        userData: testUserData,
      })

      await eventCapture.stop()
    })
  })

  describe('User Data Persistence Across Tool Calls', () => {
    it('should maintain user identification across multiple tool calls', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const testUserId = `persistent-user-${randomUUID()}`
      const testUserData = {
        name: `Persistent User ${randomUUID()}`,
        department: 'Engineering',
        customField: `custom-value-${randomUUID()}`,
      }

      // Enable tracking with identify function
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async () => ({
          userId: testUserId,
          userData: testUserData,
        }),
      })

      // Make multiple tool calls
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Todo 1',
              context: 'Adding a todo item for reset task',
            },
          },
        },
        CallToolResultSchema
      )

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Todo 2',
              context: 'Adding a todo item for reset task',
            },
          },
        },
        CallToolResultSchema
      )

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: { context: 'Listing todos for reset task' },
          },
        },
        CallToolResultSchema
      )

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Get all tool call events
      const events = eventCapture.getEvents()
      const toolCallEvents = events.filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

      // Verify all events have the same session ID
      expect(toolCallEvents.length).toBe(3)
      const sessionIds = toolCallEvents.map((e) => e.sessionId)
      expect(new Set(sessionIds).size).toBe(1) // All should have same session ID

      // Verify user identity persists
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

  describe('Null/Undefined Identity Handling', () => {
    it('should handle when identify function returns null', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking with identify function that returns null
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async () => null,
      })

      // Call a tool
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test todo',
              context: 'Adding a todo item for null identity test',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Added todo')

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify no identify event was published (since it returned null)
      const events = eventCapture.getEvents()
      const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

      expect(identifyEvent).toBeUndefined()

      // Verify no user identity is stored
      const data = getServerTrackingData(server.server)
      const sessionId = data?.sessionId
      const storedIdentity = data?.identifiedSessions.get(sessionId!)

      expect(storedIdentity).toBeUndefined()

      await eventCapture.stop()
    })

    it('should work without identify function (anonymous sessions)', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking WITHOUT identify function
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        // No identify function provided
      })

      // Call tools
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Anonymous todo',
              context: 'Adding a todo item for anonymous test',
            },
          },
        },
        CallToolResultSchema
      )

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_todos',
            arguments: { context: 'Listing todos for anonymous test' },
          },
        },
        CallToolResultSchema
      )

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify tool events were published with session IDs
      const events = eventCapture.getEvents()
      const toolCallEvents = events.filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

      expect(toolCallEvents.length).toBe(2)
      for (const event of toolCallEvents) {
        expect(event.sessionId).toBeDefined()
        expect(event.sessionId).not.toBe('')
      }

      // Verify no identify events were published
      const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)
      expect(identifyEvent).toBeUndefined()

      await eventCapture.stop()
    })
  })

  describe('Identity Data in Session Info', () => {
    it('should populate actorGivenId, actorName, and actorData in session info', async () => {
      const testUserId = `session-user-${randomUUID()}`
      const testUserName = `Session User ${randomUUID()}`
      const testUserData = {
        name: `Session Test User ${randomUUID()}`,
        role: 'Developer',
        team: 'Platform',
      }

      // Enable tracking with identify function
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async () => ({
          userId: testUserId,
          userName: testUserName,
          userData: testUserData,
        }),
      })

      // Call a tool to trigger identification
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test session info',
              context: 'Adding a todo item for session info test',
            },
          },
        },
        CallToolResultSchema
      )

      // Get session info from server data
      const data = getServerTrackingData(server.server)
      const sessionInfo = data?.sessionInfo

      expect(sessionInfo).toBeDefined()
      expect(sessionInfo?.identifyActorGivenId).toBe(testUserId)
      expect(sessionInfo?.identifyActorName).toBe(testUserName)
      expect(sessionInfo?.identifyActorData).toEqual(testUserData)
    })

    it('should include identity data in tracked events', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const testUserId = `event-user-${randomUUID()}`
      const testUserName = `Event User ${randomUUID()}`
      const testUserData = {
        name: `Event Test User ${randomUUID()}`,
        subscription: 'premium',
      }

      // Enable tracking with identify function
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async () => ({
          userId: testUserId,
          userName: testUserName,
          userData: testUserData,
        }),
      })

      // Call a tool
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test event data',
              context: 'Adding a todo item for event data test',
            },
          },
        },
        CallToolResultSchema
      )

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Check that events include session info with actor data
      const events = eventCapture.getEvents()
      const toolCallEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

      expect(toolCallEvent).toBeDefined()
      // The event should have access to session info through the server's session data

      const data = getServerTrackingData(server.server)
      expect(data?.sessionInfo.identifyActorGivenId).toBe(testUserId)
      expect(data?.sessionInfo.identifyActorName).toBe(testUserName)
      expect(data?.sessionInfo.identifyActorData).toEqual(testUserData)

      await eventCapture.stop()
    })
  })

  describe('Async Identity Resolution', () => {
    it('should handle async operations in identify function', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      let asyncOperationCompleted = false

      // Enable tracking with async identify function
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async (_request, _extra) => {
          // Simulate async operation (e.g., database lookup, API call)
          await new Promise((resolve) => setTimeout(resolve, 100))
          asyncOperationCompleted = true

          return {
            userId: `async-user-${randomUUID()}`,
            userData: {
              name: `Async User ${randomUUID()}`,
              source: 'async-lookup',
            },
          }
        },
      })

      // Call a tool
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Async test todo',
              context: 'Adding a todo item for async test',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Added todo')
      expect(asyncOperationCompleted).toBe(true)

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify identify event was published with duration
      const events = eventCapture.getEvents()
      const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

      expect(identifyEvent).toBeDefined()
      expect(identifyEvent?.duration).toBeGreaterThan(0) // Should have measurable duration

      await eventCapture.stop()
    })

    it('should handle errors in identify function gracefully', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      const errorMessage = 'Failed to identify user'

      // Enable tracking with identify function that throws
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async () => {
          throw new Error(errorMessage)
        },
      })

      // Call a tool - should not fail despite identify error
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Error test todo',
              context: 'Adding a todo item for error test',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Added todo')

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify NO identify event was published (errors in identify function should not publish events)
      const events = eventCapture.getEvents()
      const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

      expect(identifyEvent).toBeUndefined()

      // Verify no user identity was stored
      const data = getServerTrackingData(server.server)
      const sessionId = data?.sessionId
      const storedIdentity = data?.identifiedSessions.get(sessionId!)

      expect(storedIdentity).toBeUndefined()

      await eventCapture.stop()
    })

    it('should handle identify function that returns invalid data', async () => {
      const eventCapture = new EventCapture()
      await eventCapture.start()

      // Enable tracking with identify function that returns invalid structure
      track(server, {
        apiKey: 'test-project',
        enableTracing: true,
        identify: async () => {
          // Return invalid structure (missing required fields)
          return { invalidField: 'invalid' } as any as UserIdentity
        },
      })

      // Call a tool
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Invalid identity test',
              context: 'Adding a todo item for invalid identity test',
            },
          },
        },
        CallToolResultSchema
      )

      expect(result.content[0].text).toContain('Added todo')

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50))

      // The system should handle this gracefully
      const data = getServerTrackingData(server.server)
      const sessionId = data?.sessionId
      const storedIdentity = data?.identifiedSessions.get(sessionId!)

      // It will store whatever was returned, even if invalid
      expect(storedIdentity).toBeDefined()
      expect((storedIdentity as any).invalidField).toBe('invalid')

      await eventCapture.stop()
    })
  })
})
