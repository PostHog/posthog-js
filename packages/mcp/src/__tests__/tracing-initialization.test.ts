import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'
import { EventCapture } from './test-utils'

describe('Tracing Initialization Tests', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    resetTodos()
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it('should not create duplicate events when instrument() is called multiple times', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      await instrument(server, {
        projectToken: 'test-project',
        enableTracing: true,
      })

      await instrument(server, {
        projectToken: 'test-project',
        enableTracing: true,
      })

      await instrument(server, {
        projectToken: 'test-project',
        enableTracing: true,
      })

      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test todo for double-wrapping',
              context: 'Setup for double-wrapping test',
            },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      eventCapture.clear()

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'complete_todo',
            arguments: {
              id: '1',
              context: 'Testing double-wrapping protection',
            },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(result).toBeDefined()
      expect(result.isError).not.toBe(true)

      const events = eventCapture.getEvents()

      expect(events.length).toBe(1)
      expect(events[0].resourceName).toBe('complete_todo')
      expect(events[0].isError).toBe(false)
      expect(events[0].duration).toEqual(expect.any(Number))
    } finally {
      await cleanup()
    }
  })

  it('should publish events for successful tool calls with handler-level architecture', async () => {
    const { server, client, cleanup } = await setupTestServerAndClient()

    try {
      await instrument(server, {
        projectToken: 'test-project',
        enableTracing: true,
      })

      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_todo',
            arguments: {
              text: 'Test successful handler wrapping',
              context: 'Testing handler-level event publishing',
            },
          },
        },
        CallToolResultSchema
      )

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(result).toBeDefined()
      expect(result.isError).not.toBe(true)

      const events = eventCapture.getEvents()

      expect(events.length).toBe(1)
      expect(events[0].resourceName).toBe('add_todo')
      expect(events[0].isError).toBe(false)
      expect(events[0].duration).toEqual(expect.any(Number))
      expect(events[0].userIntent).toBe('Testing handler-level event publishing')

      expect(events[0]).toHaveProperty('eventType')
      expect(events[0]).toHaveProperty('timestamp')
    } finally {
      await cleanup()
    }
  })
})
