import type { EventMessage, PostHog } from 'posthog-node'

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
 * posthog-node only stamps the outgoing `$groups` property from the top-level
 * `groups` field, so the group must be forwarded as a first-class `groups` field
 * — not only inside `properties.$groups`.
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
