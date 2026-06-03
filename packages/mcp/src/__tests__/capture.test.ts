import { capture, instrument } from '../index'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import type { MCPServerLike } from '../types'
import { EventCapture, fakePostHog } from './test-utils'

function makeMockLowLevelServer(): MCPServerLike {
  return {
    _requestHandlers: new Map(),
    _serverInfo: { name: 'test-server', version: '1.0.0' },
    getClientVersion: () => ({ name: 'test-client', version: '1.0.0' }),
    setRequestHandler: () => {},
  }
}

describe('capture', () => {
  it('captures a $mcp_custom event by default', async () => {
    const server = makeMockLowLevelServer()
    instrument(server, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await capture(server, {
      resourceName: 'custom-action',
      parameters: { action: 'user-feedback', rating: 5 },
      message: 'User provided feedback',
      properties: { source: 'survey' },
    })

    const events = eventCapture.getEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event.eventType).toBe(MCPAnalyticsEventType.custom)
    expect(event.resourceName).toBe('custom-action')
    expect(event.parameters).toEqual({ action: 'user-feedback', rating: 5 })
    expect(event.userIntent).toBe('User provided feedback')
    expect(event.properties).toEqual({ source: 'survey' })

    const [payload] = eventCapture.getCaptures()
    expect(payload.event).toBe('$mcp_custom')

    await eventCapture.stop()
  })

  it('allows any event name, sent verbatim (not $-prefixed)', async () => {
    const server = makeMockLowLevelServer()
    instrument(server, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await capture(server, { event: 'feedback_submitted', properties: { rating: 5 } })

    const [payload] = eventCapture.getCaptures()
    expect(payload.event).toBe('feedback_submitted')
    expect(payload.properties.rating).toBe(5)

    await eventCapture.stop()
  })

  it('records error details when isError is true', async () => {
    const server = makeMockLowLevelServer()
    instrument(server, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await capture(server, {
      isError: true,
      error: { message: 'Custom error', code: 'ERR_001' },
    })

    const [event] = eventCapture.getEvents()
    expect(event.isError).toBe(true)
    // resolveCustomEventError normalizes into the core $exception_list shape.
    expect(event.error?.$exception_list?.[0]?.value).toBe('Custom error')

    await eventCapture.stop()
  })

  it('also works with high-level McpServer-like wrappers', async () => {
    const lowLevelServer = makeMockLowLevelServer()
    const highLevelServer = { server: lowLevelServer, _registeredTools: {}, tool: () => {} }
    instrument(highLevelServer, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await capture(highLevelServer, { resourceName: 'wrapper-action' })

    const [event] = eventCapture.getEvents()
    expect(event.resourceName).toBe('wrapper-action')

    await eventCapture.stop()
  })

  it('rejects when the server has not been instrumented', async () => {
    await expect(capture({}, { resourceName: 'whatever' })).rejects.toThrow(
      'Server is not instrumented. Call `instrument(server, options)` before `capture`.'
    )
  })

  it('rejects when the first argument is not an object', async () => {
    await expect(capture(undefined as unknown as object)).rejects.toThrow(
      'First argument must be an instrumented MCP server instance'
    )
  })

  it('stamps a timestamp on the captured event', async () => {
    const server = makeMockLowLevelServer()
    instrument(server, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()
    const before = Date.now()

    await capture(server, {})

    const [event] = eventCapture.getEvents()
    expect(event.timestamp).toBeInstanceOf(Date)
    expect((event.timestamp as Date).getTime()).toBeGreaterThanOrEqual(before)

    await eventCapture.stop()
  })

  it('accepts minimal event data', async () => {
    const server = makeMockLowLevelServer()
    instrument(server, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await capture(server, {})
    await capture(server)

    expect(eventCapture.getEvents()).toHaveLength(2)

    await eventCapture.stop()
  })
})
