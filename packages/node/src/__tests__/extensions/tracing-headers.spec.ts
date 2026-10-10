import {
  getPostHogCookieReadOptions,
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

    it('uses the posthog-js cookie only when no tracing header is present', () => {
      const now = Date.now()
      const cookie = `other=1; ph_token_posthog=${encodeURIComponent(
        JSON.stringify({
          distinct_id: 'user-from-cookie',
          $user_state: 'identified',
          $sesid: [now, 'cookie-session', now],
        })
      )}`

      expect(getPostHogTracingHeaderValues({ cookie }, { apiKey: 'token' })).toEqual({
        sessionId: 'cookie-session',
        distinctId: 'user-from-cookie',
      })
      expect(
        getPostHogTracingHeaderValues({ 'x-posthog-distinct-id': 'user-from-header', cookie }, { apiKey: 'token' })
      ).toEqual({
        distinctId: 'user-from-header',
      })
      expect(getPostHogTracingHeaderValues({ cookie })).toEqual({})
    })
  })

  describe('getPostHogCookieReadOptions', () => {
    it.each([
      ['off by default', undefined, null],
      ['off when false', false, null],
      ['on when true', true, { apiKey: 'token' }],
      [
        'on with a custom idle timeout',
        { sessionIdleTimeoutSeconds: 3600 },
        { apiKey: 'token', sessionIdleTimeoutSeconds: 3600 },
      ],
    ])('%s', (_name, readPostHogCookie, expected) => {
      expect(getPostHogCookieReadOptions({ apiKey: 'token', options: { readPostHogCookie } })).toEqual(expected)
    })

    it.each([
      ['uses the custom timeout', 3600, 45, 'session'],
      ['treats a zero timeout as the 30 minute default', 0, 20, 'session'],
      ['clamps a timeout under 60 seconds to 60 seconds', 30, 0.75, 'session'],
      ['clamps a timeout over 10 hours to 10 hours', 86400, 11 * 60, undefined],
    ])('%s', (_name, sessionIdleTimeoutSeconds, idleMinutes, expectedSessionId) => {
      const now = Date.now()
      const lastActivity = now - idleMinutes * 60 * 1000
      const cookie = `ph_token_posthog=${encodeURIComponent(
        JSON.stringify({ distinct_id: 'anon', $sesid: [lastActivity, 'session', lastActivity] })
      )}`
      expect(getPostHogTracingHeaderValues({ cookie }, { apiKey: 'token', sessionIdleTimeoutSeconds }).sessionId).toBe(
        expectedSessionId
      )
    })
  })

  describe('getPostHogCookieValues', () => {
    const now = 1_700_000_000_000
    const minute = 60 * 1000
    const cookieFor = (value: unknown, apiKey: string = 'token'): string =>
      `ph_${apiKey}_posthog=${encodeURIComponent(JSON.stringify({ $user_state: 'identified', ...(value as object) }))}`

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
      [
        'drops a session with future timestamps',
        cookieFor({ distinct_id: 'anon', $sesid: [now + 40 * minute, 'session', now - minute] }),
        { distinctId: 'anon' },
      ],
      [
        'returns only the session for an anonymous visitor',
        cookieFor({ distinct_id: 'anon', $user_state: 'anonymous', $sesid: [now, 'session', now] }),
        { sessionId: 'session' },
      ],
      [
        'accepts the older two-item session',
        cookieFor({ distinct_id: 'anon', $sesid: [now - minute, 'session'] }),
        { sessionId: 'session', distinctId: 'anon' },
      ],
      ['ignores a cookie for another project', cookieFor({ distinct_id: 'anon' }, 'other'), {}],
      [
        'ignores the cookie when the visitor opted out',
        `${cookieFor({ distinct_id: 'anon', $sesid: [now, 'session', now] })}; __ph_opt_in_out_token=0`,
        {},
      ],
      ['ignores a malformed cookie', 'ph_token_posthog=%7Bnot-json', {}],
      ['returns empty object without a cookie header', undefined, {}],
    ])('%s', (_name, cookieHeader, expected) => {
      expect(getPostHogCookieValues(cookieHeader, 'token', now)).toEqual(expected)
    })

    it('treats a visitor with no consent cookie as opted out when opt-out is the default', () => {
      const cookie = cookieFor({ distinct_id: 'anon', $sesid: [now, 'session', now] })
      expect(getPostHogCookieValues(cookie, 'token', now, 30 * minute, true)).toEqual({})
      expect(getPostHogCookieValues(`${cookie}; __ph_opt_in_out_token=1`, 'token', now, 30 * minute, true)).toEqual({
        sessionId: 'session',
        distinctId: 'anon',
      })
    })

    it('keeps a session idle past 30 minutes when the idle timeout is longer', () => {
      const cookie = cookieFor({ distinct_id: 'anon', $sesid: [now - 45 * minute, 'session', now - 45 * minute] })
      expect(getPostHogCookieValues(cookie, 'token', now, 60 * minute)).toEqual({
        sessionId: 'session',
        distinctId: 'anon',
      })
    })

    it('reads the cookie name posthog-js derives from a token with + / =', () => {
      const cookie = cookieFor({ distinct_id: 'anon', $sesid: [now, 'session', now] }, 'aPLbSLcEQ')
      expect(getPostHogCookieValues(cookie, 'a+b/c=', now)).toEqual({ sessionId: 'session', distinctId: 'anon' })
    })
  })
})
