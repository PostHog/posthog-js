import {
  getPostHogCookieValues,
  getPostHogTracingHeaderValues,
  sanitizeTracingHeaderValue,
} from '@/extensions/tracing-headers'

describe('tracing headers', () => {
  describe('sanitizeTracingHeaderValue', () => {
    it.each([
      ['plain string', 'session-123', 'session-123'],
      ['trims surrounding whitespace', '  user-456  ', 'user-456'],
      ['removes C0 and C1 control chars', 'win\x00dow\n-\t789\x7f\x80\x9f', 'window-789'],
      ['returns undefined for empty string', '', undefined],
      ['returns undefined when only whitespace/control chars remain', ' \n\t\x00 ', undefined],
      ['uses the first valid array item', [' \x00 session-123\t ', 'ignored'], 'session-123'],
      [
        'skips invalid array items before the first valid value',
        [' \x00\t ', ' session-456 ', 'ignored'],
        'session-456',
      ],
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

    it('falls back to the posthog-js cookie per missing header', () => {
      const now = Date.now()
      const cookie = encodeURIComponent(
        JSON.stringify({ distinct_id: 'anon-from-cookie', $sesid: [now, 'session-from-cookie', now] })
      )
      const headers = { 'x-posthog-distinct-id': 'user-from-header', cookie: `other=1; ph_token_posthog=${cookie}` }

      expect(getPostHogTracingHeaderValues(headers, 'token')).toEqual({
        sessionId: 'session-from-cookie',
        distinctId: 'user-from-header',
      })
      expect(getPostHogTracingHeaderValues(headers)).toEqual({ distinctId: 'user-from-header' })
    })
  })

  describe('getPostHogCookieValues', () => {
    const now = 1_700_000_000_000
    const minute = 60 * 1000
    const cookieFor = (value: unknown, apiKey: string = 'token'): string =>
      `ph_${apiKey}_posthog=${encodeURIComponent(JSON.stringify(value))}`

    it.each([
      [
        'live session',
        cookieFor({ distinct_id: 'anon', $sesid: [now - minute, 'session', now - minute] }),
        { sessionId: 'session', distinctId: 'anon' },
      ],
      [
        'drops a session past the idle timeout',
        cookieFor({ distinct_id: 'anon', $sesid: [now - 31 * minute, 'session', now - 31 * minute] }),
        { distinctId: 'anon' },
      ],
      [
        'drops a session past the length cap',
        cookieFor({ distinct_id: 'anon', $sesid: [now - minute, 'session', now - 25 * 60 * minute] }),
        { distinctId: 'anon' },
      ],
      ['ignores a cookie for another project', cookieFor({ distinct_id: 'anon' }, 'other'), {}],
      ['ignores a malformed cookie', 'ph_token_posthog=%7Bnot-json', {}],
      ['returns empty object without a cookie header', undefined, {}],
    ])('%s', (_name, cookieHeader, expected) => {
      expect(getPostHogCookieValues(cookieHeader, 'token', now)).toEqual(expected)
    })
  })
})
