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

const bothMajors = [
  { client: 'posthog-node 6', node6: true },
  { client: 'posthog-node 5', node6: false },
]

describe('McpEventSink person processing', () => {
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

  it.each(bothMajors)(
    'on $client, leaves person processing on when beforeSend drops the personless marker',
    async ({ node6 }) => {
      const { posthog, calls } = fakeClient(node6)

      await new McpEventSink(posthog).capture(anonymousError, {
        enableExceptionAutocapture: false,
        beforeSend: (event) => {
          delete event.properties.$process_person_profile
          return event
        },
      })

      expect(calls[0].options).toBeUndefined()
      expect(calls[0].properties).not.toHaveProperty('$process_person_profile')
    }
  )

  it.each([
    { name: 'stays personless', registered: true, eventOptions: undefined, expected: false },
    {
      name: 'keeps an explicit eventOptions choice',
      registered: false,
      eventOptions: { process_person_profile: true },
      expected: true,
    },
  ])(
    'on a real posthog-node 6 client with a registered process_person_profile option, $name',
    async ({ registered, eventOptions, expected }) => {
      const posthog = new RealPostHog('phc_test', { host: 'http://localhost', flushAt: 1000, flushInterval: 0 })
      const capture = vi.spyOn(posthog, 'capture').mockImplementation(() => undefined)
      try {
        await posthog.registerOptions({ process_person_profile: registered })

        await new McpEventSink(posthog).capture(
          { ...anonymousError, eventOptions },
          { enableExceptionAutocapture: false }
        )

        const message = await posthog.prepareEventMessage(capture.mock.calls[0][0])
        expect(message.options).toEqual({ process_person_profile: expected })
        expect(message.properties).not.toHaveProperty('$process_person_profile')
      } finally {
        await posthog.shutdown()
      }
    }
  )
})

describe('McpEventSink event options', () => {
  const eventOptions = {
    process_person_profile: true,
    cookieless_mode: true,
    disable_skew_correction: true,
    product_tour_id: 'tour-1',
    future_option: 'unknown to posthog-node 5',
  }
  const optionProperties = {
    $process_person_profile: true,
    $cookieless_mode: true,
    $ignore_sent_at: true,
    $product_tour_id: 'tour-1',
  }

  it('on posthog-node 6, sends the options as given and no option property on any payload', async () => {
    const { posthog, calls } = fakeClient(true)

    await new McpEventSink(posthog).capture({ ...anonymousError, eventOptions }, { enableExceptionAutocapture: true })

    expect(calls.map((call) => call.event)).toEqual(['$mcp_tool_call', '$exception'])
    for (const call of calls) {
      expect(call.options).toEqual(eventOptions)
      for (const property of Object.keys(optionProperties)) {
        expect(call.properties).not.toHaveProperty(property)
      }
    }
  })

  it('on posthog-node 5, sends each known option as its property, over a caller property, and drops unknown keys', async () => {
    const { posthog, calls } = fakeClient(false)

    await new McpEventSink(posthog).capture(
      { ...anonymousError, properties: { $cookieless_mode: false }, eventOptions },
      { enableExceptionAutocapture: true }
    )

    expect(calls.map((call) => call.event)).toEqual(['$mcp_tool_call', '$exception'])
    for (const call of calls) {
      expect('options' in call).toBe(false)
      expect(call.properties).toMatchObject(optionProperties)
      expect(JSON.stringify(call.properties)).not.toContain('future_option')
    }
  })

  it.each(bothMajors)('on $client, gives each payload its own options for beforeSend to change', async ({ node6 }) => {
    const { posthog, calls } = fakeClient(node6)

    await new McpEventSink(posthog).capture(
      { ...anonymousError, eventOptions: { product_tour_id: 'tour-1' } },
      {
        enableExceptionAutocapture: true,
        beforeSend: (event) => {
          if (event.event === '$exception' && event.options) {
            event.options.product_tour_id = 'tour-2'
          }
          return event
        },
      }
    )

    const tourIds = calls.map((call) => (node6 ? call.options?.product_tour_id : call.properties?.$product_tour_id))
    expect(tourIds).toEqual(['tour-1', 'tour-2'])
  })
})
