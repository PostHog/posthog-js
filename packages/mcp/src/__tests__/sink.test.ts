import { PostHog as RealPostHog, type EventMessage, type PostHog } from 'posthog-node'

import { McpEventSink } from '../extensions/sink'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import type { McpEvent } from '../types'

/**
 * Direct coverage for `McpEventSink.capture()` → `posthog.capture()`. The shared
 * `EventCapture` test harness patches `McpEventSink.prototype.capture` and stops
 * before the real `posthog.capture()` call, so it cannot assert on the payload
 * actually handed to posthog-node. These tests spy on a fake client instead.
 *
 * Regression guard for https://github.com/PostHog/posthog-js/issues/3888:
 * posthog-node before 5.38.6 replaces the outgoing `$groups` property with the
 * top-level `groups` field, so the group must be forwarded as a first-class
 * `groups` field — not only inside `properties.$groups`.
 */
describe('McpEventSink groups forwarding', () => {
  function spyClient(): { posthog: PostHog; calls: EventMessage[] } {
    const calls: EventMessage[] = []
    const posthog = {
      capture: (message: EventMessage): void => {
        calls.push(message)
      },
    } as unknown as PostHog
    return { posthog, calls }
  }

  it('forwards a top-level `groups` field when the event carries groups', async () => {
    const { posthog, calls } = spyClient()
    const sink = new McpEventSink(posthog)

    const event: McpEvent = {
      eventType: MCPAnalyticsEventType.mcpToolsCall,
      sessionId: 'session-1',
      identifyActorGivenId: 'user-1',
      groups: { account: 'acct-123' },
      timestamp: new Date(),
    }

    await sink.capture(event, { enableExceptionAutocapture: false })

    expect(calls).toHaveLength(1)
    expect(calls[0].event).toBe('$mcp_tool_call')
    expect(calls[0].groups).toEqual({ account: 'acct-123' })
    // Still present in properties (where the pipeline writes it) for parity.
    expect((calls[0].properties as Record<string, unknown>).$groups).toEqual({ account: 'acct-123' })
  })

  it('omits `groups` when the event carries none', async () => {
    const { posthog, calls } = spyClient()
    const sink = new McpEventSink(posthog)

    const event: McpEvent = {
      eventType: MCPAnalyticsEventType.mcpToolsCall,
      sessionId: 'session-1',
      timestamp: new Date(),
    }

    await sink.capture(event, { enableExceptionAutocapture: false })

    expect(calls).toHaveLength(1)
    expect('groups' in calls[0]).toBe(false)
  })
})

describe('McpEventSink person processing', () => {
  const anonymousError: McpEvent = {
    eventType: MCPAnalyticsEventType.mcpToolsCall,
    sessionId: 'session-1',
    isError: true,
    error: {
      $exception_list: [{ type: 'Error', value: 'boom', mechanism: { type: 'generic', handled: true } }],
      $exception_level: 'error',
    },
    timestamp: new Date(),
  }

  // posthog-node 6 is told apart by `registerOptions`, which first shipped in 6.0.
  function fakeClient(node6: boolean): { posthog: PostHog; calls: EventMessage[] } {
    const calls: EventMessage[] = []
    const posthog = {
      capture: (message: EventMessage): void => {
        calls.push(message)
      },
      ...(node6 ? { registerOptions: vi.fn() } : {}),
    } as unknown as PostHog
    return { posthog, calls }
  }

  it.each([
    { client: 'posthog-node 6', node6: true, identity: undefined, option: false, property: undefined },
    { client: 'posthog-node 5', node6: false, identity: undefined, option: undefined, property: false },
    { client: 'posthog-node 6', node6: true, identity: 'user-1', option: undefined, property: undefined },
    { client: 'posthog-node 5', node6: false, identity: 'user-1', option: undefined, property: undefined },
  ])(
    'on $client with identity $identity, sets option $option and property $property on every payload',
    async ({ node6, identity, option, property }) => {
      const { posthog, calls } = fakeClient(node6)

      await new McpEventSink(posthog).capture(
        { ...anonymousError, identifyActorGivenId: identity },
        { enableExceptionAutocapture: true }
      )

      expect(calls.map((call) => call.event)).toEqual(['$mcp_tool_call', '$exception'])
      for (const call of calls) {
        expect(call.options?.process_person_profile).toBe(option)
        expect(call.properties?.$process_person_profile).toBe(property)
      }
    }
  )

  it('leaves person processing on when beforeSend drops the personless marker', async () => {
    const { posthog, calls } = fakeClient(true)

    await new McpEventSink(posthog).capture(anonymousError, {
      enableExceptionAutocapture: false,
      beforeSend: (event) => {
        delete event.properties.$process_person_profile
        return event
      },
    })

    expect(calls[0].options).toBeUndefined()
    expect(calls[0].properties).not.toHaveProperty('$process_person_profile')
  })

  it('stays personless on a real posthog-node 6 client with a registered process_person_profile option', async () => {
    const posthog = new RealPostHog('phc_test', { host: 'http://localhost', flushAt: 1000, flushInterval: 0 })
    const capture = vi.spyOn(posthog, 'capture').mockImplementation(() => undefined)
    try {
      await posthog.registerOptions({ process_person_profile: true })

      await new McpEventSink(posthog).capture(anonymousError, { enableExceptionAutocapture: false })

      const message = await posthog.prepareEventMessage(capture.mock.calls[0][0])
      expect(message.options).toEqual({ process_person_profile: false })
    } finally {
      await posthog.shutdown()
    }
  })
})
