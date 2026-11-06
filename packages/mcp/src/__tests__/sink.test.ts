import type { EventMessage, PostHog } from 'posthog-node'

import { buildCapturedMcpParameters } from '../extensions/mcp-payloads'
import { McpEventSink, processMcpEvent } from '../extensions/sink'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import type { McpEvent } from '../types'

/**
 * Direct coverage for `McpEventSink.capture()` → `posthog.capture()`. The shared
 * `EventCapture` test harness patches `McpEventSink.prototype.capture` and stops
 * before the real `posthog.capture()` call, so it cannot assert on the payload
 * actually handed to posthog-node. These tests spy on a fake client instead.
 *
 * Regression guard for https://github.com/PostHog/posthog-js/issues/3888:
 * posthog-node's `prepareEventMessage` overwrites the outgoing `$groups`
 * property with the top-level `groups` field, so the group must be forwarded as
 * a first-class `groups` field — not only inside `properties.$groups`.
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

describe('processMcpEvent cost', () => {
  const rowsEvent = (rows: number): McpEvent => ({
    eventType: MCPAnalyticsEventType.mcpToolsCall,
    sessionId: 'session-1',
    timestamp: new Date(),
    parameters: {},
    response: {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: {
        rows: Array.from(
          { length: rows },
          (_, i) => `customer ${i} order ORD-${i} status shipped 2026-11-06T12:00:00Z`
        ),
      },
    },
  })

  async function medianMs(event: McpEvent): Promise<number> {
    const options = { enableExceptionAutocapture: true, redactPayloadPersonalData: true }
    await processMcpEvent(event, options, () => {})
    const runs: number[] = []
    for (let run = 0; run < 5; run++) {
      const start = performance.now()
      await processMcpEvent(event, options, () => {})
      runs.push(performance.now() - start)
    }
    return runs.sort((left, right) => left - right)[2]
  }

  it('applies the entry limit before sanitizing, so entries past it cost nothing', async () => {
    const atLimit = await medianMs(rowsEvent(100))
    const farPastLimit = await medianMs(rowsEvent(100_000))

    expect(farPastLimit).toBeLessThan(10 * atLimit + 5)
  })
})

describe('processMcpEvent __proto__ members', () => {
  it.each([
    [
      'with personal data',
      '{"__proto__":{"email":"ada@example.com"},"y":2}',
      '{"__proto__":{"email":"[redacted]"},"y":2}',
    ],
    ['with nothing to redact', '{"__proto__":{"x":1},"y":2}', '{"__proto__":{"x":1},"y":2}'],
  ])('keeps a parsed one %s in parameters, structuredContent, and its text copy', async (_label, json, expected) => {
    const event: McpEvent = {
      eventType: MCPAnalyticsEventType.mcpToolsCall,
      sessionId: 'session-1',
      timestamp: new Date(),
      parameters: JSON.parse(json),
      response: { content: [{ type: 'text', text: json }], structuredContent: JSON.parse(json) },
    }

    const processed = await processMcpEvent(event, {
      enableExceptionAutocapture: false,
      redactPayloadPersonalData: true,
    })
    const response = processed!.event.response as { content: { text: string }[]; structuredContent: unknown }

    expect(JSON.stringify(processed!.event.parameters)).toBe(expected)
    expect(JSON.stringify(response.structuredContent)).toBe(expected)
    expect(response.content[0].text).toBe(expected)
  })
})

describe('processMcpEvent identifiers at the scan window edge', () => {
  const window = 131_072
  const filler = (length: number): string => {
    const unit = `${'x'.repeat(50)}@ex.com `
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length - 1) + ' '
  }
  const process = (event: Partial<McpEvent>, redactPayloadPersonalData = true): ReturnType<typeof processMcpEvent> =>
    processMcpEvent(
      { eventType: MCPAnalyticsEventType.mcpToolsCall, sessionId: 'session-1', timestamp: new Date(), ...event },
      { enableExceptionAutocapture: false, redactPayloadPersonalData }
    )
  const around = (text: string, needle: string): string | null => {
    const index = text.indexOf(needle)
    return index < 0 ? null : text.slice(Math.max(0, index - 20), index + needle.length + 20)
  }

  it.each([
    ['ada.lovelace@example.com', 12],
    ['078-05-1120', 8],
    ['4111 1111 1111 1111', 14],
    ['+44 20 7946 0958', 8],
    ['203.0.113.77', 8],
  ])('redacts %s in an argument that the window cuts after %i characters', async (identifier, kept) => {
    const argument = `${filler(window - kept)}${identifier} tail`
    const parameters = buildCapturedMcpParameters({
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: argument } },
    })

    const processed = await process({ parameters })

    expect(around(JSON.stringify(processed!.event.parameters), identifier.slice(0, kept))).toBeNull()
  })

  it.each([
    ['response', true],
    ['parameters', true],
    ['response', false],
    ['parameters', false],
  ] as const)(
    'cuts an object key in the %s to the key limit, past an address the window splits, with personal data %s',
    async (field, redactPayloadPersonalData) => {
      const key = `${'k'.repeat(window - 13)} ada.lovelace@example.com`
      const payload = { content: [{ type: 'text', text: 'ok' }], [key]: 1 }

      const processed = await process({ [field]: payload }, redactPayloadPersonalData)

      expect(
        around(JSON.stringify(processed!.captures.map((capture) => capture.properties)), 'ada.lovelace')
      ).toBeNull()
      expect(
        Math.max(...Object.keys(processed!.event[field] as object).map((name) => name.length))
      ).toBeLessThanOrEqual(256 + 3)
    }
  )
})
