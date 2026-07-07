import type { PostHogEventProperties } from '@posthog/core'

import { isLegacyOnlyEvent } from '@/capture-v1/routing'

describe('isLegacyOnlyEvent', () => {
  it.each(['$ai_generation', '$ai_span', '$ai_trace', '$ai_embedding', '$ai_metric', '$ai_feedback', '$ai_'])(
    'routes AI event %s to the legacy submitter',
    (event) => {
      expect(isLegacyOnlyEvent({ event })).toBe(true)
    }
  )

  it.each([
    '$pageview',
    '$identify',
    'custom_event',
    'my$ai_event',
    'prefixed_$ai_generation',
    'ai_generation',
    '$AI_generation',
  ])('keeps non-AI event %s eligible for v1', (event) => {
    expect(isLegacyOnlyEvent({ event })).toBe(false)
  })

  it.each([
    ['missing event', {}],
    ['empty event', { event: '' }],
    ['non-string event', { event: 123 }],
  ])('treats %s as not legacy-only', (_label, message) => {
    expect(isLegacyOnlyEvent(message as PostHogEventProperties)).toBe(false)
  })
})
