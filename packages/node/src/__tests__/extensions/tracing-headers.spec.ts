import { getPostHogTracingHeaderValues, sanitizeTracingHeaderValue } from '@/extensions/tracing-headers'

describe('tracing headers', () => {
  describe('sanitizeTracingHeaderValue', () => {
    it.each([
      ['plain string', 'session-123', 'session-123'],
      ['trims surrounding whitespace', '  user-456  ', 'user-456'],
      ['removes C0 and C1 control chars', 'win\x00dow\n-\t789\x7f\x80\x9f', 'window-789'],
      ['returns undefined for empty string', '', undefined],
      ['returns undefined when only whitespace/control chars remain', ' \n\t\x00 ', undefined],
      ['uses the first valid array item', [' \x00 session-123\t ', 'ignored'], 'session-123'],
      ['returns undefined when array has no valid string item', [' \x00\t '], undefined],
      ['caps values at 1000 chars', ` ${'x'.repeat(1105)} `, 'x'.repeat(1000)],
    ])('%s', (_name, value, expected) => {
      expect(sanitizeTracingHeaderValue(value)).toBe(expected)
    })
  })

  describe('getPostHogTracingHeaderValues', () => {
    it.each([
      [
        'extracts supported lowercase tracing headers',
        {
          'x-posthog-session-id': 'session-123',
          'x-posthog-distinct-id': 'user-456',
        },
        { sessionId: 'session-123', distinctId: 'user-456' },
      ],
      [
        'sanitizes extracted tracing headers',
        {
          'x-posthog-session-id': ' session\n-123 ',
          'x-posthog-distinct-id': ` ${'u'.repeat(1105)} `,
        },
        { sessionId: 'session-123', distinctId: 'u'.repeat(1000) },
      ],
      [
        'omits invalid tracing headers',
        {
          'x-posthog-session-id': ' \x00\t ',
          'x-posthog-distinct-id': [],
        },
        {},
      ],
      [
        'includes only present valid tracing headers',
        {
          'x-posthog-session-id': 'session-only',
          'x-forwarded-for': '10.0.0.1',
        },
        { sessionId: 'session-only' },
      ],
      ['returns empty object for missing headers', undefined, {}],
    ])('%s', (_name, headers, expected) => {
      expect(getPostHogTracingHeaderValues(headers)).toEqual(expected)
    })
  })
})
