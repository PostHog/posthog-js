import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { JsonType } from '@posthog/core'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import type { MCPRequestLike, MCPServerLike } from '../types'
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
    const analytics = instrument(server, fakePostHog())

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await analytics.capture({ event: 'feedback_submitted', properties: { rating: 5, source: 'survey' } })

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
    const analytics = instrument(server, fakePostHog())

    await expect(analytics.capture({} as never)).rejects.toThrow('requires an `event` name')
    await expect(analytics.capture({ event: '' })).rejects.toThrow('requires an `event` name')
  })

  it('also works with high-level McpServer-like wrappers', async () => {
    const lowLevelServer = makeMockLowLevelServer()
    const highLevelServer = { server: lowLevelServer, _registeredTools: {}, tool: () => {} }
    const analytics = instrument(highLevelServer, fakePostHog())

    const eventCapture = new EventCapture()
    await eventCapture.start()

    await analytics.capture({ event: 'wrapper_action' })

    const [payload] = eventCapture.getCaptures()
    expect(payload.event).toBe('wrapper_action')

    await eventCapture.stop()
  })

  it('stamps a timestamp on the captured event', async () => {
    const server = makeMockLowLevelServer()
    const analytics = instrument(server, fakePostHog())

    const eventCapture = new EventCapture()
    await eventCapture.start()
    const before = Date.now()

    await analytics.capture({ event: 'tick' })

    const [event] = eventCapture.getEvents()
    expect(event.timestamp).toBeInstanceOf(Date)
    expect((event.timestamp as Date).getTime()).toBeGreaterThanOrEqual(before)

    await eventCapture.stop()
  })
})

describe('eventOptions', () => {
  let eventCapture: EventCapture

  beforeEach(async () => {
    eventCapture = new EventCapture()
    await eventCapture.start()
  })

  afterEach(async () => {
    await eventCapture.stop()
  })

  it.each<{ name: string; eventOptions: Record<string, JsonType>; expected: Record<string, JsonType> }>([
    {
      name: 'adds the anonymous default to other options',
      eventOptions: { cookieless_mode: true },
      expected: { cookieless_mode: true, process_person_profile: false },
    },
    {
      name: 'lets an explicit process_person_profile beat the anonymous default',
      eventOptions: { process_person_profile: true },
      expected: { process_person_profile: true },
    },
    {
      name: 'applies the anonymous default when eventOptions leaves process_person_profile null',
      eventOptions: { process_person_profile: null },
      expected: { process_person_profile: false },
    },
  ])('custom event: $name', async ({ eventOptions, expected }) => {
    const analytics = instrument(makeMockLowLevelServer(), fakePostHog())

    await analytics.capture({ event: 'feedback_submitted', properties: { rating: 5 }, eventOptions })

    const [payload] = eventCapture.getCaptures()
    expect(payload.options).toEqual(expected)
    expect(payload.properties).not.toHaveProperty('$process_person_profile')
  })

  it('sends the eventOptions callback result on every auto-captured event, including $exception', async () => {
    const server = new McpServer({ name: 'options server', version: '1.0.0' })
    server.tool('ok_tool', 'Succeeds', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    server.tool('failing_tool', 'Throws', async () => {
      throw new Error('boom')
    })
    server.resource('guide', 'file:///guide.md', async (uri) => ({ contents: [{ uri: uri.href, text: '# Guide' }] }))
    const eventOptions = vi.fn(async (request: MCPRequestLike) => ({ product_tour_id: request.method }))
    instrument(server, fakePostHog(), { reportMissing: true, collectFeedback: true, eventOptions })

    const client = new Client({ name: 'options client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.server.connect(serverTransport)])
    try {
      await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      for (const [name, args] of [
        ['ok_tool', {}],
        ['failing_tool', {}],
        ['get_more_tools', { context: 'a bulk export tool' }],
        ['send_feedback', { feedback_type: 'praise', summary: 'Clear tool names.' }],
      ] as const) {
        await client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema)
      }
      await client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema)
      await client.request({ method: 'resources/read', params: { uri: 'file:///guide.md' } }, ReadResourceResultSchema)
      await new Promise((r) => setTimeout(r, 50))
    } finally {
      await clientTransport.close()
      await serverTransport.close()
    }

    const methodByEvent = {
      $mcp_initialize: 'initialize',
      $mcp_tools_list: 'tools/list',
      $mcp_tool_call: 'tools/call',
      $exception: 'tools/call',
      $mcp_missing_capability: 'tools/call',
      $mcp_feedback: 'tools/call',
      $mcp_resources_list: 'resources/list',
      $mcp_resource_read: 'resources/read',
    }
    const captures = eventCapture.getCaptures()
    expect(new Set(captures.map((payload) => payload.event))).toEqual(new Set(Object.keys(methodByEvent)))
    for (const payload of captures) {
      expect(payload.options).toEqual({
        product_tour_id: methodByEvent[payload.event as keyof typeof methodByEvent],
        process_person_profile: false,
      })
    }
  })
})
