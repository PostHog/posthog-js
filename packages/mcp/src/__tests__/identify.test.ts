import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { instrument } from '../index'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { getServerTrackingData } from '../extensions/internal'
import type { HighLevelMCPServerLike, UserIdentity } from '../types'
import { EventCapture, fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const callAddTodo = (client: any, context = 'test context') =>
  client.request(
    { method: 'tools/call', params: { name: 'add_todo', arguments: { text: 'Test todo', context } } },
    CallToolResultSchema
  )

const expectIdentityStored = (server: HighLevelMCPServerLike, expected: UserIdentity) => {
  const data = getServerTrackingData(server.server)
  expect(data?.identifiedSessions.get(data.sessionId)).toEqual(expected)
}

describe('identify option', () => {
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

  it('runs identify on the first tool call, stores the identity, and publishes an $identify event', async () => {
    const capture = new EventCapture()
    await capture.start()

    const identity: UserIdentity = {
      distinctId: 'user-1',
      properties: { name: 'Alice', email: 'alice@example.com' },
    }
    const identify = jest.fn(async (request: any, extra: any) => {
      expect(request).toBeDefined()
      expect(extra).toBeDefined()
      return identity
    })

    instrument(server, fakePostHog(), { identify })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    expect(identify).toHaveBeenCalledTimes(1)
    const identifyEvent = capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.identify)
    expect(identifyEvent?.resourceName).toBe('add_todo')
    expectIdentityStored(server, identity)

    await capture.stop()
  })

  it('calls identify on every tool invocation but only publishes an event when the identity changes', async () => {
    const capture = new EventCapture()
    await capture.start()
    const identify = jest.fn(async () => ({ distinctId: 'user-1', properties: { name: 'Stable' } }))

    instrument(server, fakePostHog(), { identify })

    await callAddTodo(client, 'first')
    await callAddTodo(client, 'second')
    await callAddTodo(client, 'third')

    await new Promise((r) => setTimeout(r, 50))

    expect(identify).toHaveBeenCalledTimes(3)
    const identifyEvents = capture.getEvents().filter((e) => e.eventType === MCPAnalyticsEventType.identify)
    expect(identifyEvents).toHaveLength(1)

    await capture.stop()
  })

  it('republishes $identify when the identity materially changes mid-session, then dedupes again', async () => {
    const capture = new EventCapture()
    await capture.start()
    // Same distinctId, but the plan changes on the second call and then holds.
    const plans = ['free', 'pro', 'pro']
    let call = 0
    const identify = jest.fn(async () => ({ distinctId: 'user-1', properties: { plan: plans[call++] } }))

    instrument(server, fakePostHog(), { identify })

    await callAddTodo(client, 'first')
    await callAddTodo(client, 'second')
    await callAddTodo(client, 'third')

    await new Promise((r) => setTimeout(r, 50))

    // One at first-seen, one when plan flips free→pro; the third call (still pro) dedupes.
    expect(identify).toHaveBeenCalledTimes(3)
    const identifyEvents = capture.getEvents().filter((e) => e.eventType === MCPAnalyticsEventType.identify)
    expect(identifyEvents).toHaveLength(2)
    expectIdentityStored(server, { distinctId: 'user-1', properties: { plan: 'pro' } })

    await capture.stop()
  })

  it('identifies the caller on tools registered after instrument() (proxy listener)', async () => {
    const capture = new EventCapture()
    await capture.start()

    const identify = jest.fn(async () => ({ distinctId: 'late-user', properties: { name: 'Late' } }))
    instrument(server, fakePostHog(), { context: true, identify })

    server.tool!(
      'post_track_tool',
      'A tool added after tracking was enabled',
      { message: z.string() },
      async (args: { message: string }) => ({ content: [{ type: 'text', text: `Got: ${args.message}` }] })
    )

    await client.request(
      {
        method: 'tools/call',
        params: { name: 'post_track_tool', arguments: { message: 'hello', context: 'late call' } },
      },
      CallToolResultSchema
    )

    await new Promise((r) => setTimeout(r, 50))

    expect(identify).toHaveBeenCalledTimes(1)
    const identifyEvent = capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.identify)
    expect(identifyEvent?.resourceName).toBe('post_track_tool')
    expectIdentityStored(server, { distinctId: 'late-user', properties: { name: 'Late' } })

    await capture.stop()
  })

  it('treats a null return as "no identity": no event published, no identity stored', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, fakePostHog(), { identify: async () => null })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    expect(capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.identify)).toBeUndefined()
    const data = getServerTrackingData(server.server)
    expect(data?.identifiedSessions.get(data.sessionId!)).toBeUndefined()

    await capture.stop()
  })

  it('still tracks tool calls when no identify option is provided (anonymous sessions)', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, fakePostHog())

    await callAddTodo(client, 'first')
    await callAddTodo(client, 'second')
    await new Promise((r) => setTimeout(r, 50))

    const events = capture.getEvents()
    expect(events.filter((e) => e.eventType === MCPAnalyticsEventType.mcpToolsCall)).toHaveLength(2)
    expect(events.find((e) => e.eventType === MCPAnalyticsEventType.identify)).toBeUndefined()
    for (const event of events) {
      expect(event.sessionId).toBeTruthy()
    }

    // Anonymous sessions must opt out of person processing so we don't mint a
    // person profile per session.
    const toolCalls = capture.findCapturesByEvent('$mcp_tool_call')
    expect(toolCalls).toHaveLength(2)
    for (const toolCall of toolCalls) {
      expect(toolCall.properties.$process_person_profile).toBe(false)
      expect(toolCall.distinct_id).toBe(toolCall.properties.$session_id)
    }

    await capture.stop()
  })

  it('populates session info with the resolved identity (distinctId, properties)', async () => {
    instrument(server, fakePostHog(), {
      identify: async () => ({
        distinctId: 'session-user',
        properties: { name: 'Session Alice', role: 'admin', team: 'platform' },
      }),
    })

    await callAddTodo(client)

    const sessionInfo = getServerTrackingData(server.server)?.sessionInfo
    expect(sessionInfo?.identifyActorGivenId).toBe('session-user')
    expect(sessionInfo?.identifyActorData).toEqual({ name: 'Session Alice', role: 'admin', team: 'platform' })
  })

  it('stamps $groups on events when identify returns groups', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, fakePostHog(), {
      identify: async () => ({
        distinctId: 'session-user',
        groups: { organization: 'org_123', project: 'proj_9' },
      }),
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(toolCall.properties.$groups).toEqual({ organization: 'org_123', project: 'proj_9' })

    await capture.stop()
  })

  it('keeps person processing on and uses the distinctId once identified', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, fakePostHog(), {
      identify: async () => ({
        distinctId: 'session-user',
        properties: { name: 'Session Alice', role: 'admin' },
      }),
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    const toolCall = capture.findCapturesByEvent('$mcp_tool_call')[0]
    expect(toolCall).toBeDefined()
    // Identity resolved → real person, so we do NOT opt out of person processing.
    expect(toolCall.properties.$process_person_profile).toBeUndefined()
    expect(toolCall.distinct_id).toBe('session-user')
    // properties go straight to $set.
    expect(toolCall.properties.$set).toMatchObject({ name: 'Session Alice', role: 'admin' })

    await capture.stop()
  })

  it('awaits async identify callbacks and records a non-zero duration on the $identify event', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, fakePostHog(), {
      identify: async () => {
        await new Promise((r) => setTimeout(r, 50))
        return { distinctId: 'async-user' }
      },
    })

    await callAddTodo(client)
    await new Promise((r) => setTimeout(r, 50))

    const identifyEvent = capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.identify)
    expect(identifyEvent?.duration).toBeGreaterThan(0)

    await capture.stop()
  })

  it('swallows errors thrown from identify so tool calls still succeed', async () => {
    const capture = new EventCapture()
    await capture.start()
    instrument(server, fakePostHog(), {
      identify: async () => {
        throw new Error('identify boom')
      },
    })

    const result = await callAddTodo(client)
    expect(result.content[0].text).toContain('Added todo')

    await new Promise((r) => setTimeout(r, 50))
    expect(capture.getEvents().find((e) => e.eventType === MCPAnalyticsEventType.identify)).toBeUndefined()

    await capture.stop()
  })

  it('stores whatever identify returns — no schema validation', async () => {
    instrument(server, fakePostHog(), {
      // The SDK does not validate the identity shape; whatever you return ends up cached.
      identify: async () => ({ invalidField: 'invalid' }) as unknown as UserIdentity,
    })

    await callAddTodo(client)
    const data = getServerTrackingData(server.server)
    const stored = data?.identifiedSessions.get(data.sessionId!) as unknown as { invalidField?: string }
    expect(stored?.invalidField).toBe('invalid')
  })
})
