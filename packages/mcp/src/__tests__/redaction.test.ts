import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { redactEvent } from '../extensions/redaction'
import type { RedactFunction, UnredactedEvent } from '../types'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'
import { EventCapture } from './test-utils'

const CREDIT_CARD_PATTERN = /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/
const SESSION_ID_PATTERN = /^ses_/

describe('redactEvent', () => {
  // Mock redaction function that replaces strings with "[REDACTED]"
  const mockRedactFn: RedactFunction = jest.fn(async (text: string) => `[REDACTED-${text.length}]`)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should redact basic string fields', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      userIntent: 'sensitive user intent',
      timestamp: new Date('2024-01-01'),
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.userIntent).toBe('[REDACTED-21]')
    expect(mockRedactFn).toHaveBeenCalledWith('sensitive user intent')
  })

  it('should not redact protected fields', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      id: 'evt_456',
      apiKey: 'proj_789',
      server: 'my-server',
      identifyActorGivenId: 'actor_123',
      identifyActorName: 'John Doe',
      resourceName: 'my-resource',
      eventType: 'mcp:tools/call',
      actorId: 'actor_456',
    }

    const redacted = await redactEvent(event, mockRedactFn)

    // All protected fields should remain unchanged
    expect(redacted.sessionId).toBe('ses_123')
    expect(redacted.id).toBe('evt_456')
    expect(redacted.apiKey).toBe('proj_789')
    expect(redacted.server).toBe('my-server')
    expect(redacted.identifyActorGivenId).toBe('actor_123')
    expect(redacted.identifyActorName).toBe('John Doe')
    expect(redacted.resourceName).toBe('my-resource')
    expect(redacted.eventType).toBe('mcp:tools/call')
    expect(redacted.actorId).toBe('actor_456')

    // Redact function should not have been called for protected fields
    expect(mockRedactFn).not.toHaveBeenCalled()
  })

  it('should redact nested string fields', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      parameters: {
        query: 'sensitive query',
        options: {
          apiKey: 'secret-key-123',
          timeout: 5000,
        },
      },
      response: {
        data: 'sensitive response data',
        metadata: {
          source: 'sensitive source',
        },
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.parameters.query).toBe('[REDACTED-15]')
    expect(redacted.parameters.options.apiKey).toBe('[REDACTED-14]')
    expect(redacted.parameters.options.timeout).toBe(5000) // Numbers should not be redacted
    expect(redacted.response.data).toBe('[REDACTED-23]')
    expect(redacted.response.metadata.source).toBe('[REDACTED-16]')
  })

  it('should handle arrays of strings', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      parameters: {
        tags: ['sensitive1', 'sensitive2', 'sensitive3'],
        numbers: [1, 2, 3],
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.parameters.tags).toEqual(['[REDACTED-10]', '[REDACTED-10]', '[REDACTED-10]'])
    expect(redacted.parameters.numbers).toEqual([1, 2, 3])
  })

  it('should handle mixed nested structures', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      parameters: {
        users: [
          { name: 'John', age: 30, email: 'john@example.com' },
          { name: 'Jane', age: 25, email: 'jane@example.com' },
        ],
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.parameters.users[0].name).toBe('[REDACTED-4]')
    expect(redacted.parameters.users[0].age).toBe(30)
    expect(redacted.parameters.users[0].email).toBe('[REDACTED-16]')
    expect(redacted.parameters.users[1].name).toBe('[REDACTED-4]')
    expect(redacted.parameters.users[1].age).toBe(25)
    expect(redacted.parameters.users[1].email).toBe('[REDACTED-16]')
  })

  it('should preserve null and undefined values', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      parameters: {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.parameters.nullValue).toBeNull()
    expect(redacted.parameters.undefinedValue).toBeUndefined()
    expect(redacted.parameters.emptyString).toBe('[REDACTED-0]')
  })

  it('should preserve Date objects', async () => {
    const testDate = new Date('2024-01-01T12:00:00Z')
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      timestamp: testDate,
      parameters: {
        createdAt: new Date('2024-01-02T12:00:00Z'),
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.timestamp).toEqual(testDate)
    expect(redacted.parameters.createdAt).toEqual(new Date('2024-01-02T12:00:00Z'))
    expect(redacted.parameters.createdAt).toBeInstanceOf(Date)
  })

  it('should skip functions in objects', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      parameters: {
        callback: () => console.log('test'),
        data: 'sensitive data',
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.parameters.callback).toBeUndefined()
    expect(redacted.parameters.data).toBe('[REDACTED-14]')
  })

  it('should handle complex identifyData object without redacting it', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      identifyData: {
        email: 'user@example.com',
        preferences: {
          theme: 'dark',
          notifications: true,
        },
        metadata: {
          source: 'webapp',
          version: '1.0.0',
        },
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    // identifyData is a protected field, and its nested contents should NOT be redacted
    expect(redacted.identifyData.email).toBe('user@example.com')
    expect(redacted.identifyData.preferences.theme).toBe('dark')
    expect(redacted.identifyData.preferences.notifications).toBe(true)
    expect(redacted.identifyData.metadata.source).toBe('webapp')
    expect(redacted.identifyData.metadata.version).toBe('1.0.0')

    // Verify redact function was not called for protected field contents
    expect(mockRedactFn).not.toHaveBeenCalledWith('user@example.com')
    expect(mockRedactFn).not.toHaveBeenCalledWith('dark')
    expect(mockRedactFn).not.toHaveBeenCalledWith('webapp')
    expect(mockRedactFn).not.toHaveBeenCalledWith('1.0.0')
  })

  it('should handle error objects', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      isError: true,
      error: {
        message: 'Sensitive error message',
        code: 'ERR_001',
        stack: 'Error: Sensitive error message\n    at functionName (file.js:10:5)',
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.isError).toBe(true)
    expect(redacted.error.message).toBe('[REDACTED-23]')
    expect(redacted.error.code).toBe('[REDACTED-7]')
    expect(redacted.error.stack).toBe('[REDACTED-65]')
  })

  it('should handle deeply nested protected fields correctly', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      parameters: {
        nested: {
          deeply: {
            sessionId: 'This should be redacted', // Not a top-level protected field
            data: 'sensitive data',
          },
        },
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    expect(redacted.sessionId).toBe('ses_123') // Top-level protected
    expect(redacted.parameters.nested.deeply.sessionId).toBe('[REDACTED-23]') // Nested not protected
    expect(redacted.parameters.nested.deeply.data).toBe('[REDACTED-14]')
  })

  it('should handle custom redaction function errors gracefully', async () => {
    const errorRedactFn: RedactFunction = jest.fn(async () => {
      throw new Error('Redaction failed')
    })

    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      userIntent: 'sensitive data',
    }

    await expect(redactEvent(event, errorRedactFn)).rejects.toThrow('Redaction failed')
  })

  it('should not redact nested fields within any protected field', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      // Test nested data in identifyData
      identifyData: {
        nested: {
          deeply: {
            sensitive: 'this should NOT be redacted',
            data: ['array', 'of', 'strings'],
          },
        },
      },
      // Test that non-protected fields still get redacted
      otherData: {
        nested: {
          deeply: {
            sensitive: 'this SHOULD be redacted',
          },
        },
      },
    }

    const redacted = await redactEvent(event, mockRedactFn)

    // Protected field contents should NOT be redacted
    expect(redacted.identifyData.nested.deeply.sensitive).toBe('this should NOT be redacted')
    expect(redacted.identifyData.nested.deeply.data).toEqual(['array', 'of', 'strings'])

    // Non-protected field contents SHOULD be redacted
    expect(redacted.otherData.nested.deeply.sensitive).toBe('[REDACTED-23]')

    // Verify the redact function was only called for non-protected content
    expect(mockRedactFn).toHaveBeenCalledWith('this SHOULD be redacted')
    expect(mockRedactFn).not.toHaveBeenCalledWith('this should NOT be redacted')
    expect(mockRedactFn).not.toHaveBeenCalledWith('array')
    expect(mockRedactFn).not.toHaveBeenCalledWith('of')
    expect(mockRedactFn).not.toHaveBeenCalledWith('strings')
  })

  it('should create a new object without modifying the original', async () => {
    const event: UnredactedEvent = {
      sessionId: 'ses_123',
      userIntent: 'sensitive data',
      parameters: {
        query: 'sensitive query',
      },
    }

    const originalEvent = JSON.parse(JSON.stringify(event))
    const redacted = await redactEvent(event, mockRedactFn)

    // Original should be unchanged
    expect(event).toEqual(originalEvent)

    // Redacted should be different
    expect(redacted.userIntent).not.toBe(event.userIntent)
    expect(redacted.parameters.query).not.toBe(event.parameters.query)
  })

  it('should handle events with all possible fields', async () => {
    const event: UnredactedEvent = {
      id: 'evt_123',
      apiKey: 'proj_123',
      sessionId: 'ses_123',
      actorId: 'actor_123',
      eventId: 'custom_evt_123',
      eventType: 'mcp:tools/call',
      isError: false,
      error: { message: 'error message' },
      resourceName: 'resource_123',
      duration: 1000,
      timestamp: new Date(),
      userIntent: 'user intent text',
      parameters: { param1: 'value1' },
      response: { result: 'success' },
      identifyActorGivenId: 'given_id_123',
      identifyActorName: 'Actor Name',
      identifyData: { key: 'value' },
      server: 'server_name',
    }

    const redacted = await redactEvent(event, mockRedactFn)

    // Protected fields
    expect(redacted.id).toBe('evt_123')
    expect(redacted.apiKey).toBe('proj_123')
    expect(redacted.sessionId).toBe('ses_123')
    expect(redacted.actorId).toBe('actor_123')
    expect(redacted.eventType).toBe('mcp:tools/call')
    expect(redacted.resourceName).toBe('resource_123')
    expect(redacted.identifyActorGivenId).toBe('given_id_123')
    expect(redacted.identifyActorName).toBe('Actor Name')
    expect(redacted.server).toBe('server_name')

    // Non-protected fields
    expect(redacted.eventId).toBe('[REDACTED-14]')
    expect(redacted.userIntent).toBe('[REDACTED-16]')
    expect(redacted.parameters.param1).toBe('[REDACTED-6]')
    expect(redacted.response.result).toBe('[REDACTED-7]')
    expect(redacted.error.message).toBe('[REDACTED-13]')
    // identifyData is protected, so its nested contents should NOT be redacted
    expect(redacted.identifyData.key).toBe('value')

    // Non-string fields
    expect(redacted.isError).toBe(false)
    expect(redacted.duration).toBe(1000)
    expect(redacted.timestamp).toBeInstanceOf(Date)
  })
})

describe('redactEvent integration tests', () => {
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

  it('should properly redact sensitive data in published events', async () => {
    const eventCapture = new EventCapture()
    await eventCapture.start()

    // Custom redaction function that clearly marks redacted content
    const redactSensitiveData: RedactFunction = async (text: string) => {
      // Redact email addresses
      if (text.includes('@')) {
        return '[REDACTED-EMAIL]'
      }
      // Redact anything that looks like a secret or key
      if (text.toLowerCase().includes('secret') || text.toLowerCase().includes('key')) {
        return '[REDACTED-SECRET]'
      }
      // Redact anything that looks like personal data
      if (text.toLowerCase().includes('password') || text.toLowerCase().includes('ssn')) {
        return '[REDACTED-SENSITIVE]'
      }
      // Default: return original text
      return text
    }

    // Enable tracking with redaction
    instrument(server, {
      apiKey: 'test-project',
      enableTracing: true,
      redactSensitiveInformation: redactSensitiveData,
      identify: async () => ({
        userId: 'test-user-123',
        userName: 'John Doe',
        userData: {
          email: 'user@example.com',
          apiKey: 'secret-api-key-123',
        },
      }),
    })

    // Call a tool with sensitive data in arguments
    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            text: 'Send email to admin@company.com with password reset',
            context: 'Adding a todo item for reset task',
          },
        },
      },
      CallToolResultSchema
    )

    // Wait for events to be processed
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Get the captured events
    const events = eventCapture.getEvents()

    // Find the tool call event
    const toolCallEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

    expect(toolCallEvent).toBeDefined()

    // Verify sensitive data in parameters was redacted
    const params = toolCallEvent?.parameters as any
    expect(params.request.params.arguments.text).toBe('[REDACTED-EMAIL]') // Contains email
    expect(toolCallEvent?.userIntent).toBe('Adding a todo item for reset task')

    // Find the identify event
    const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

    expect(identifyEvent).toBeDefined()

    // The identify event should have the same parameters structure as the tool call
    // since it's created from the same base event
    const identifyParams = identifyEvent?.parameters as any
    expect(identifyParams.request.params.arguments.text).toBe('[REDACTED-EMAIL]')

    // Verify protected fields were NOT redacted (apiKey is no longer carried on Event;
    // it lives only on the PostHog client now)
    expect(toolCallEvent?.sessionId).toMatch(SESSION_ID_PATTERN) // Should start with ses_
    expect(toolCallEvent?.resourceName).toBe('add_todo')
    expect(toolCallEvent?.eventType).toBe(MCPAnalyticsEventType.mcpToolsCall)

    // The identify event includes actor info from sessionInfo
    expect(identifyEvent?.identifyActorGivenId).toBe('test-user-123')
    expect(identifyEvent?.identifyActorName).toBe('John Doe')

    await eventCapture.stop()
  })

  it('should handle complex nested structures with redaction', async () => {
    const eventCapture = new EventCapture()
    await eventCapture.start()

    // Redaction function that redacts credit card numbers
    const redactCreditCards: RedactFunction = async (text: string) => {
      // Simple credit card detection (4 groups of 4 digits)
      if (CREDIT_CARD_PATTERN.test(text)) {
        return '[REDACTED-CC]'
      }
      return text
    }

    // Enable tracking with redaction
    instrument(server, {
      apiKey: 'test-project',
      enableTracing: true,
      redactSensitiveInformation: redactCreditCards,
    })

    // Call a tool with nested sensitive data
    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            text: 'Process payment for card 1234 5678 9012 3456',
            context: 'Processing payment for order',
          },
        },
      },
      CallToolResultSchema
    )

    // Wait for events
    await new Promise((resolve) => setTimeout(resolve, 100))

    const events = eventCapture.getEvents()
    const toolCallEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

    expect(toolCallEvent).toBeDefined()

    const params = toolCallEvent?.parameters as any

    // Verify credit card data in text was redacted
    expect(params.request.params.arguments.text).toBe('[REDACTED-CC]')
    expect(toolCallEvent?.userIntent).toBe('Processing payment for order')

    await eventCapture.stop()
  })

  it('should not redact protected fields even if they contain sensitive patterns', async () => {
    const eventCapture = new EventCapture()
    await eventCapture.start()

    // Aggressive redaction that would redact anything with 'id'
    const aggressiveRedact: RedactFunction = async (text: string) => {
      if (text.toLowerCase().includes('id')) {
        return '[REDACTED-ID]'
      }
      return text
    }

    // Enable tracking
    instrument(server, {
      apiKey: 'test-project',
      enableTracing: true,
      redactSensitiveInformation: aggressiveRedact,
      identify: async () => ({
        userId: 'user-with-id-123',
        userName: 'David Smith',
        userData: {
          internalId: 'internal-id-456',
        },
      }),
    })

    // Call a tool
    await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            text: 'Task with id reference custom-id-789',
            context: 'Adding task with id reference',
          },
        },
      },
      CallToolResultSchema
    )

    // Wait for events
    await new Promise((resolve) => setTimeout(resolve, 100))

    const events = eventCapture.getEvents()

    // Check tool call event
    const toolCallEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)

    // Protected fields should NOT be redacted
    expect(toolCallEvent?.sessionId).toMatch(SESSION_ID_PATTERN)
    expect(toolCallEvent?.actorId).toBeUndefined() // Not set in this test

    // Non-protected fields with 'id' should be redacted
    const params = toolCallEvent?.parameters as any
    expect(params.request.params.arguments.text).toBe('[REDACTED-ID]')
    expect(toolCallEvent?.userIntent).toBe('[REDACTED-ID]')

    // Check identify event
    const identifyEvent = events.find((e) => e.eventType === MCPAnalyticsEventType.identify)

    // Protected identity fields should NOT be redacted
    expect(identifyEvent?.identifyActorGivenId).toBe('user-with-id-123')
    expect(identifyEvent?.identifyActorName).toBe('David Smith') // This should NOT be redacted as it's a protected field

    // The identify event parameters should also be redacted
    const identifyParams = identifyEvent?.parameters as any
    expect(identifyParams.request.params.arguments.text).toBe('[REDACTED-ID]')

    await eventCapture.stop()
  })
})
