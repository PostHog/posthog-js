import { publishCustomEvent, track } from '../index'
import { MCPAnalyticsEventType } from '../modules/event-types'
import type { MCPServerLike } from '../types'
import { EventCapture } from './test-utils'

function makeMockLowLevelServer(): MCPServerLike {
  return {
    _requestHandlers: new Map(),
    _serverInfo: { name: 'test-server', version: '1.0.0' },
    getClientVersion: () => ({ name: 'test-client', version: '1.0.0' }),
    setRequestHandler: () => {},
  }
}

describe('publishCustomEvent', () => {
  it('publishes a $mcp_custom event for a tracked server', async () => {
    const server = makeMockLowLevelServer()
    track(server, { apiKey: 'phc_test' })

    const capture = new EventCapture()
    await capture.start()

    await publishCustomEvent(server, {
      resourceName: 'custom-action',
      parameters: { action: 'user-feedback', rating: 5 },
      message: 'User provided feedback',
      properties: { source: 'survey' },
    })

    const events = capture.getEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event.eventType).toBe(MCPAnalyticsEventType.custom)
    expect(event.resourceName).toBe('custom-action')
    expect(event.parameters).toEqual({ action: 'user-feedback', rating: 5 })
    expect(event.userIntent).toBe('User provided feedback')
    expect(event.properties).toEqual({ source: 'survey' })

    await capture.stop()
  })

  it('records error details when isError is true', async () => {
    const server = makeMockLowLevelServer()
    track(server, { apiKey: 'phc_test' })

    const capture = new EventCapture()
    await capture.start()

    await publishCustomEvent(server, {
      isError: true,
      error: { message: 'Custom error', code: 'ERR_001' },
    })

    const [event] = capture.getEvents()
    expect(event.isError).toBe(true)
    expect((event.error as { message?: string } | undefined)?.message).toBe('Custom error')

    await capture.stop()
  })

  it('also works with high-level McpServer-like wrappers', async () => {
    const lowLevelServer = makeMockLowLevelServer()
    const highLevelServer = { server: lowLevelServer, _registeredTools: {}, tool: () => {} }
    track(highLevelServer, { apiKey: 'phc_test' })

    const capture = new EventCapture()
    await capture.start()

    await publishCustomEvent(highLevelServer, { resourceName: 'wrapper-action' })

    const [event] = capture.getEvents()
    expect(event.resourceName).toBe('wrapper-action')

    await capture.stop()
  })

  it('rejects when the server has not been tracked', async () => {
    await expect(publishCustomEvent({}, { resourceName: 'whatever' })).rejects.toThrow(
      'Server is not tracked. Call `track(server, options)` before `publishCustomEvent`.'
    )
  })

  it('rejects when the first argument is not an object', async () => {
    await expect(publishCustomEvent(undefined as unknown as object)).rejects.toThrow(
      'First argument must be a tracked MCP server instance'
    )
  })

  it('always uses the custom event type for publishCustomEvent', async () => {
    const server = makeMockLowLevelServer()
    track(server, { apiKey: 'phc_test' })

    const capture = new EventCapture()
    await capture.start()

    await publishCustomEvent(server, {})

    const [event] = capture.getEvents()
    expect(event.eventType).toBe(MCPAnalyticsEventType.custom)

    await capture.stop()
  })

  it('stamps a timestamp on the captured event', async () => {
    const server = makeMockLowLevelServer()
    track(server, { apiKey: 'phc_test' })

    const capture = new EventCapture()
    await capture.start()
    const before = Date.now()

    await publishCustomEvent(server, {})

    const [event] = capture.getEvents()
    expect(event.timestamp).toBeInstanceOf(Date)
    expect((event.timestamp as Date).getTime()).toBeGreaterThanOrEqual(before)

    await capture.stop()
  })

  it('accepts minimal event data', async () => {
    const server = makeMockLowLevelServer()
    track(server, { apiKey: 'phc_test' })

    const capture = new EventCapture()
    await capture.start()

    await publishCustomEvent(server, {})
    await publishCustomEvent(server)

    expect(capture.getEvents()).toHaveLength(2)

    await capture.stop()
  })
})
