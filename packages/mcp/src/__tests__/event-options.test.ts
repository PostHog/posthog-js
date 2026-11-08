import type { JsonType } from '@posthog/core'

import { MCPAnalyticsEventType } from '../extensions/event-types'
import { applyResolvedMetadata } from '../extensions/tracing-helpers'
import type { MCPAnalyticsData, McpEvent } from '../types'

type Options = Record<string, JsonType>

describe('applyResolvedMetadata eventOptions', () => {
  function trackingData(eventOptions: () => Record<string, unknown> | null): MCPAnalyticsData {
    return { options: { eventOptions }, logger: vi.fn() } as unknown as MCPAnalyticsData
  }

  it.each<{ name: string; perCall?: Options; callback: Options | null; expected: Options }>([
    {
      name: 'a per-call value beats the callback',
      perCall: { product_tour_id: 'per-call', process_person_profile: true },
      callback: { product_tour_id: 'callback', process_person_profile: false, cookieless_mode: true },
      expected: { product_tour_id: 'per-call', process_person_profile: true, cookieless_mode: true },
    },
    {
      name: 'the callback fills a per-call value left null',
      perCall: { process_person_profile: null },
      callback: { process_person_profile: true },
      expected: { process_person_profile: true },
    },
    {
      name: 'the callback alone is used when there is no per-call value',
      perCall: undefined,
      callback: { cookieless_mode: true },
      expected: { cookieless_mode: true },
    },
    {
      name: 'a nullish callback result leaves per-call values unchanged',
      perCall: { cookieless_mode: true },
      callback: null,
      expected: { cookieless_mode: true },
    },
  ])('$name', async ({ perCall, callback, expected }) => {
    const event: McpEvent = { eventType: MCPAnalyticsEventType.mcpToolsCall, eventOptions: perCall }

    await applyResolvedMetadata(
      event,
      trackingData(() => callback),
      { method: 'tools/call' }
    )

    expect(event.eventOptions).toEqual(expected)
  })
})
