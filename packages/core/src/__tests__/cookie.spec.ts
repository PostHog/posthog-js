import {
  cookieStateToProperties,
  cookieStoreFromHeader,
  getConsentCookieName,
  getPostHogCookieName,
  isOptedOut,
  parsePostHogCookie,
  readPostHogCookie,
  serializePostHogCookie,
} from '../cookie'

describe('getPostHogCookieName', () => {
  it.each([
    ['simple API key', 'phc_abc123', 'ph_phc_abc123_posthog'],
    ['sanitizes + in token', 'abc+def', 'ph_abcPLdef_posthog'],
    ['sanitizes / in token', 'abc/def', 'ph_abcSLdef_posthog'],
    ['sanitizes = in token', 'abc=def', 'ph_abcEQdef_posthog'],
    ['sanitizes multiple special characters', 'a+b/c=d', 'ph_aPLbSLcEQd_posthog'],
  ])('%s', (_label, input, expected) => {
    expect(getPostHogCookieName(input)).toBe(expected)
  })
})

describe('parsePostHogCookie', () => {
  it('parses an identified user cookie', () => {
    const cookieValue = JSON.stringify({
      distinct_id: 'user_123',
      $device_id: 'device_abc',
      $user_state: 'identified',
    })
    const result = parsePostHogCookie(cookieValue)
    expect(result).toEqual({
      distinctId: 'user_123',
      isIdentified: true,
      sessionId: undefined,
      deviceId: 'device_abc',
    })
  })

  it('detects anonymous users', () => {
    const cookieValue = JSON.stringify({
      distinct_id: 'device_abc',
      $device_id: 'device_abc',
      $user_state: 'anonymous',
    })
    const result = parsePostHogCookie(cookieValue)
    expect(result).toEqual({
      distinctId: 'device_abc',
      isIdentified: false,
      sessionId: undefined,
      deviceId: 'device_abc',
    })
  })

  it('treats missing $user_state as anonymous', () => {
    const cookieValue = JSON.stringify({
      distinct_id: 'user_123',
      $device_id: 'device_abc',
    })
    const result = parsePostHogCookie(cookieValue)
    expect(result).toEqual({
      distinctId: 'user_123',
      isIdentified: false,
      sessionId: undefined,
      deviceId: 'device_abc',
    })
  })

  it('extracts sessionId from $sesid array', () => {
    const cookieValue = JSON.stringify({
      distinct_id: 'user_123',
      $device_id: 'device_abc',
      $sesid: [1708700000000, 'session-uuid-v7', 1708700000000],
    })
    const result = parsePostHogCookie(cookieValue)
    expect(result).toEqual({
      distinctId: 'user_123',
      isIdentified: false,
      sessionId: 'session-uuid-v7',
      deviceId: 'device_abc',
    })
  })

  it('returns undefined sessionId when $sesid is missing', () => {
    const cookieValue = JSON.stringify({
      distinct_id: 'user_123',
      $device_id: 'device_abc',
    })
    const result = parsePostHogCookie(cookieValue)
    expect(result?.sessionId).toBeUndefined()
  })

  it('returns undefined sessionId when $sesid is not an array', () => {
    const cookieValue = JSON.stringify({
      distinct_id: 'user_123',
      $sesid: 'not-an-array',
    })
    const result = parsePostHogCookie(cookieValue)
    expect(result?.sessionId).toBeUndefined()
  })

  it.each([
    ['empty string', ''],
    ['invalid JSON', 'not-json'],
    ['JSON without distinct_id', JSON.stringify({ foo: 'bar' })],
    ['null input', null as unknown as string],
  ])('returns null for %s', (_label, input) => {
    expect(parsePostHogCookie(input)).toBeNull()
  })
})

describe('getConsentCookieName', () => {
  it.each<[string, Parameters<typeof getConsentCookieName>[1] | undefined, string]>([
    ['default __ph_opt_in_out_ prefix', undefined, '__ph_opt_in_out_phc_abc123'],
    ['consent_persistence_name overrides default', { consent_persistence_name: 'my_consent' }, 'my_consent'],
    ['opt_out_capturing_cookie_prefix + apiKey', { opt_out_capturing_cookie_prefix: 'custom_' }, 'custom_phc_abc123'],
    [
      'prefers consent_persistence_name over opt_out_capturing_cookie_prefix',
      { consent_persistence_name: 'my_consent', opt_out_capturing_cookie_prefix: 'custom_' },
      'my_consent',
    ],
  ])('%s', (_label, config, expected) => {
    expect(getConsentCookieName('phc_abc123', config)).toBe(expected)
  })
})

describe('isOptedOut', () => {
  const makeCookies = (entries: Record<string, string>) => ({
    get: (name: string) => {
      const value = entries[name]
      return value !== undefined ? { name, value } : undefined
    },
  })

  it('returns false when no consent cookie and opt_out_by_default is false', () => {
    expect(isOptedOut(makeCookies({}), 'phc_test')).toBe(false)
  })

  it('returns true when no consent cookie and opt_out_by_default is true', () => {
    expect(isOptedOut(makeCookies({}), 'phc_test', { opt_out_capturing_by_default: true })).toBe(true)
  })

  it.each([
    ['1', false],
    ['0', true],
    ['true', false],
    ['yes', false],
    ['false', true],
    ['no', true],
  ])('cookie value %s → isOptedOut === %s', (cookieValue, expected) => {
    expect(isOptedOut(makeCookies({ __ph_opt_in_out_phc_test: cookieValue }), 'phc_test')).toBe(expected)
  })

  it('uses custom consent_persistence_name', () => {
    const cookies = makeCookies({ my_consent: '0' })
    expect(isOptedOut(cookies, 'phc_test', { consent_persistence_name: 'my_consent' })).toBe(true)
  })

  it('explicit opt-in overrides opt_out_by_default', () => {
    const cookies = makeCookies({ __ph_opt_in_out_phc_test: '1' })
    expect(isOptedOut(cookies, 'phc_test', { opt_out_capturing_by_default: true })).toBe(false)
  })
})

describe('serializePostHogCookie', () => {
  it('produces JSON with distinct_id, $device_id, and $sesid', () => {
    const result = serializePostHogCookie('abc-123')
    const parsed = JSON.parse(result)
    expect(parsed.distinct_id).toBe('abc-123')
    expect(parsed.$device_id).toBe('abc-123')
    expect(parsed.$user_state).toBe('anonymous')
    expect(parsed.$sesid).toHaveLength(3)
    expect(typeof parsed.$sesid[0]).toBe('number')
    expect(typeof parsed.$sesid[1]).toBe('string')
    expect(parsed.$sesid[2]).toBe(parsed.$sesid[0])
  })

  it('roundtrips with parsePostHogCookie as anonymous with sessionId', () => {
    const serialized = serializePostHogCookie('anon-id')
    const parsed = parsePostHogCookie(serialized)
    expect(parsed?.distinctId).toBe('anon-id')
    expect(parsed?.isIdentified).toBe(false)
    expect(typeof parsed?.sessionId).toBe('string')
  })
})

describe('cookieStoreFromHeader', () => {
  it('parses a single cookie pair', () => {
    const store = cookieStoreFromHeader('foo=bar')
    expect(store.get('foo')).toEqual({ value: 'bar' })
  })

  it('parses multiple cookie pairs separated by ;', () => {
    const store = cookieStoreFromHeader('foo=bar; baz=qux')
    expect(store.get('foo')).toEqual({ value: 'bar' })
    expect(store.get('baz')).toEqual({ value: 'qux' })
  })

  it('decodes URI-encoded values', () => {
    const store = cookieStoreFromHeader('greeting=hello%20world')
    expect(store.get('greeting')).toEqual({ value: 'hello world' })
  })

  it('preserves = inside cookie values', () => {
    const store = cookieStoreFromHeader('payload=a=b=c')
    expect(store.get('payload')).toEqual({ value: 'a=b=c' })
  })

  it('returns undefined for missing cookies', () => {
    const store = cookieStoreFromHeader('foo=bar')
    expect(store.get('missing')).toBeUndefined()
  })

  it('falls back to the raw value when the encoding is malformed', () => {
    // `%gg` is not a valid percent-encoded sequence — `decodeURIComponent` would
    // throw `URIError`. The store should not crash; it should return the raw text.
    const store = cookieStoreFromHeader('broken=%gg; ok=fine')
    expect(store.get('broken')).toEqual({ value: '%gg' })
    expect(store.get('ok')).toEqual({ value: 'fine' })
  })

  it('handles empty header', () => {
    const store = cookieStoreFromHeader('')
    expect(store.get('foo')).toBeUndefined()
  })
})

describe('readPostHogCookie', () => {
  it('reads and parses a PostHog cookie via the store', () => {
    const cookieValue = JSON.stringify({
      distinct_id: 'lambda-user',
      $device_id: 'lambda-user',
      $user_state: 'anonymous',
    })
    const store = cookieStoreFromHeader(`ph_phc_test_posthog=${encodeURIComponent(cookieValue)}`)
    const state = readPostHogCookie(store, 'phc_test')
    expect(state?.distinctId).toBe('lambda-user')
    expect(state?.isIdentified).toBe(false)
  })

  it('returns null when the cookie is missing', () => {
    const store = cookieStoreFromHeader('other=value')
    expect(readPostHogCookie(store, 'phc_test')).toBeNull()
  })
})

describe('cookieStateToProperties', () => {
  it('returns undefined for null state', () => {
    expect(cookieStateToProperties(null)).toBeUndefined()
  })

  it('returns undefined when no session/device id present', () => {
    expect(
      cookieStateToProperties({
        distinctId: 'abc',
        isIdentified: false,
      })
    ).toBeUndefined()
  })

  it('extracts $session_id and $device_id when present', () => {
    expect(
      cookieStateToProperties({
        distinctId: 'abc',
        isIdentified: true,
        sessionId: 'sess-1',
        deviceId: 'dev-1',
      })
    ).toEqual({ $session_id: 'sess-1', $device_id: 'dev-1' })
  })
})
