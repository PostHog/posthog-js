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
  it('captures a custom event with the given name, sent verbatim (not $-prefixed)', async () => {
    const server = makeMockLowLevelServer()
    instrument(server, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await capture(server, { event: 'feedback_submitted', properties: { rating: 5, source: 'survey' } })

    const events = eventCapture.getEvents()
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(MCPAnalyticsEventType.custom)
    expect(events[0].properties).toEqual({ rating: 5, source: 'survey' })

    const [payload] = eventCapture.getCaptures()
    expect(payload.event).toBe('feedback_submitted')
    expect(payload.properties.rating).toBe(5)

    await eventCapture.stop()
  })

  it('requires an event name', async () => {
    const server = makeMockLowLevelServer()
    instrument(server, { posthog: fakePostHog() })

    await expect(capture(server, {} as never)).rejects.toThrow('requires an `event` name')
    await expect(capture(server, { event: '' })).rejects.toThrow('requires an `event` name')
  })

  it('also works with high-level McpServer-like wrappers', async () => {
    const lowLevelServer = makeMockLowLevelServer()
    const highLevelServer = { server: lowLevelServer, _registeredTools: {}, tool: () => {} }
    instrument(highLevelServer, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await capture(highLevelServer, { event: 'wrapper_action' })

    const [payload] = eventCapture.getCaptures()
    expect(payload.event).toBe('wrapper_action')

    await eventCapture.stop()
  })

  it('rejects when the server has not been instrumented', async () => {
    await expect(capture({}, { event: 'whatever' })).rejects.toThrow(
      'Server is not instrumented. Call `instrument(server, options)` before `capture`.'
    )
  })

  it('rejects when the first argument is not an object', async () => {
    await expect(capture(undefined as unknown as object, { event: 'x' })).rejects.toThrow(
      'First argument must be an instrumented MCP server instance'
    )
  })

  it('stamps a timestamp on the captured event', async () => {
    const server = makeMockLowLevelServer()
    instrument(server, { posthog: fakePostHog() })

    const eventCapture = new EventCapture()
    await eventCapture.start()
    const before = Date.now()

    await capture(server, { event: 'tick' })

    const [event] = eventCapture.getEvents()
    expect(event.timestamp).toBeInstanceOf(Date)
    expect((event.timestamp as Date).getTime()).toBeGreaterThanOrEqual(before)

    await eventCapture.stop()
  })
})
