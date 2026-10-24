import type { JsonType, PostHogEventProperties } from '@posthog/core'

import { buildV1Event } from '@/capture-v1/transform'

function baseMessage(overrides: PostHogEventProperties = {}): PostHogEventProperties {
  return {
    event: 'test-event',
    distinct_id: 'user-123',
    uuid: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
    timestamp: '2024-01-15T10:30:00.000Z',
    properties: {},
    ...overrides,
  }
}

describe('capture v1 transform', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildV1Event - options and legacy option properties', () => {
    const LEGACY_PAIRS = [
      ['$process_person_profile', 'process_person_profile'],
      ['$cookieless_mode', 'cookieless_mode'],
      ['$ignore_sent_at', 'disable_skew_correction'],
      ['$product_tour_id', 'product_tour_id'],
    ] as const

    describe.each(LEGACY_PAIRS)('%s and %s', (property, optionKey) => {
      it.each<[string, JsonType | undefined, JsonType | undefined, JsonType | undefined]>([
        ['a set option wins over the legacy property', 'from-option', 'from-legacy', 'from-option'],
        ['a false option wins over a true legacy property', false, true, false],
        ['the legacy property fills a missing option', undefined, 'from-legacy', 'from-legacy'],
        ['the legacy property fills a null option', null, false, false],
        ['a null option without a legacy property is sent as null', null, undefined, null],
        ['a null legacy property fills a missing option with null', undefined, null, null],
      ])('%s', (_label, optionValue, legacyValue, expected) => {
        const event = buildV1Event(
          baseMessage({
            options: optionValue === undefined ? {} : { [optionKey]: optionValue },
            properties: legacyValue === undefined ? { keep: 'me' } : { [property]: legacyValue, keep: 'me' },
          })
        )

        expect(event.options).toStrictEqual({ [optionKey]: expected })
        expect(event.properties).toStrictEqual({ keep: 'me' })
      })

      it('leaves the option out when neither the option nor the legacy property is set', () => {
        const event = buildV1Event(baseMessage({ properties: { keep: 'me' } }))

        expect(event.options).not.toHaveProperty(optionKey)
      })

      it.each<[string, JsonType]>([
        ['string "no"', 'no'],
        ['string "YES"', 'YES'],
        ['string "maybe"', 'maybe'],
        ['number 0', 0],
        ['number 1.5', 1.5],
        ['array', ['a', 1]],
        ['object', { nested: true }],
      ])('sends a legacy %s value unchanged', (_label, value) => {
        const event = buildV1Event(baseMessage({ properties: { [property]: value } }))

        expect(event.options).toStrictEqual({ [optionKey]: value })
        expect(event.properties).toStrictEqual({})
      })

      it.each<[string, JsonType]>([
        ['string "no"', 'no'],
        ['string "YES"', 'YES'],
        ['string "maybe"', 'maybe'],
        ['number 0', 0],
        ['array', [true]],
      ])('sends an option %s value unchanged', (_label, value) => {
        const event = buildV1Event(baseMessage({ options: { [optionKey]: value } }))

        expect(event.options).toStrictEqual({ [optionKey]: value })
      })
    })

    it('passes unknown option keys through unchanged', () => {
      const event = buildV1Event(
        baseMessage({ options: { future_option: 'x', another: [1, { deep: null }] }, properties: { keep: 'me' } })
      )

      expect(event.options).toStrictEqual({ future_option: 'x', another: [1, { deep: null }] })
      expect(event.properties).toStrictEqual({ keep: 'me' })
    })

    it('combines caller options with every legacy property', () => {
      const event = buildV1Event(
        baseMessage({
          options: { process_person_profile: true, future_option: 1 },
          properties: {
            $process_person_profile: false,
            $cookieless_mode: '1',
            $ignore_sent_at: 'false',
            $product_tour_id: 7,
            keep: 'me',
          },
        })
      )

      expect(event.options).toStrictEqual({
        process_person_profile: true,
        future_option: 1,
        cookieless_mode: '1',
        disable_skew_correction: 'false',
        product_tour_id: 7,
      })
      expect(event.properties).toStrictEqual({ keep: 'me' })
    })

    it('sends options as an empty object when nothing sets one', () => {
      expect(buildV1Event(baseMessage({ properties: { foo: 'bar' } })).options).toStrictEqual({})
      expect(buildV1Event(baseMessage({ options: null })).options).toStrictEqual({})
    })

    it('does not log when options are missing or null', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      buildV1Event(baseMessage())
      buildV1Event(baseMessage({ options: null }))

      expect(error).not.toHaveBeenCalled()
    })

    it.each<[string, JsonType]>([
      ['an array', ['process_person_profile']],
      ['a string', 'process_person_profile'],
      ['a number', 0],
      ['a boolean', true],
    ])('logs one error for %s options and still lifts the legacy properties', (_label, options) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      const event = buildV1Event(baseMessage({ options, properties: { $cookieless_mode: true, keep: 'me' } }))

      expect(event.options).toStrictEqual({ cookieless_mode: true })
      expect(event.properties).toStrictEqual({ keep: 'me' })
      expect(error.mock.calls).toEqual([['[PostHog] options must be an object; sending the event without its options']])
    })
  })

  describe('buildV1Event - top-level sentinels', () => {
    it('promotes $session_id and $window_id to top-level strings and strips them', () => {
      const event = buildV1Event(
        baseMessage({ properties: { $session_id: 'sess-1', $window_id: 'win-1', keep: 'me' } })
      )

      expect(event.session_id).toBe('sess-1')
      expect(event.window_id).toBe('win-1')
      expect(event.properties).not.toHaveProperty('$session_id')
      expect(event.properties).not.toHaveProperty('$window_id')
      expect(event.properties.keep).toBe('me')
    })

    it('drops a non-string $session_id but still strips it', () => {
      const event = buildV1Event(baseMessage({ properties: { $session_id: 123 } }))

      expect(event.session_id).toBeUndefined()
      expect(event.properties).not.toHaveProperty('$session_id')
    })

    it('omits session_id/window_id when the sentinels are absent', () => {
      const event = buildV1Event(baseMessage({ properties: { foo: 'bar' } }))

      expect(event).not.toHaveProperty('session_id')
      expect(event).not.toHaveProperty('window_id')
    })
  })

  describe('buildV1Event - $lib stripping and $set relocation', () => {
    it('strips $lib and $lib_version from properties', () => {
      const event = buildV1Event(
        baseMessage({ properties: { $lib: 'posthog-node', $lib_version: '1.2.3', keep: 'me' } })
      )

      expect(event.properties).not.toHaveProperty('$lib')
      expect(event.properties).not.toHaveProperty('$lib_version')
      expect(event.properties.keep).toBe('me')
    })

    it('relocates top-level $set/$set_once into properties', () => {
      const event = buildV1Event(
        baseMessage({ $set: { name: 'Jane' }, $set_once: { first_seen: 'today' }, properties: {} })
      )

      expect(event.properties.$set).toEqual({ name: 'Jane' })
      expect(event.properties.$set_once).toEqual({ first_seen: 'today' })
    })

    it('lets an existing properties value win over a top-level $set on collision', () => {
      const event = buildV1Event(
        baseMessage({ $set: { name: 'top-level' }, properties: { $set: { name: 'in-properties' } } })
      )

      expect(event.properties.$set).toEqual({ name: 'in-properties' })
    })

    it('does not add $set when there is no top-level value', () => {
      const event = buildV1Event(baseMessage({ properties: { foo: 'bar' } }))
      expect(event.properties).not.toHaveProperty('$set')
    })
  })

  describe('buildV1Event - passthrough and purity', () => {
    it('passes through event, uuid, distinct_id and preserves ordinary properties', () => {
      const event = buildV1Event(
        baseMessage({ event: '$pageview', distinct_id: 'abc', properties: { url: '/home', n: 5 } })
      )

      expect(event.event).toBe('$pageview')
      expect(event.distinct_id).toBe('abc')
      expect(event.uuid).toBe('0189dcd5-5311-7d40-8db0-9496a2eef37b')
      expect(event.properties).toEqual({ url: '/home', n: 5 })
    })

    it('falls back to empty strings for missing event/uuid/distinct_id', () => {
      const event = buildV1Event({ properties: {}, event: undefined, uuid: undefined, distinct_id: undefined })

      expect(event.event).toBe('')
      expect(event.uuid).toBe('')
      expect(event.distinct_id).toBe('')
    })

    it('treats a missing or non-object properties as empty', () => {
      expect(buildV1Event(baseMessage({ properties: undefined })).properties).toEqual({})
      expect(buildV1Event(baseMessage({ properties: [1, 2] })).properties).toEqual({})
    })

    it('normalizes a parseable string timestamp to the equivalent UTC instant', () => {
      const event = buildV1Event(baseMessage({ timestamp: '2024-01-15T10:30:00.000+05:30' }))
      expect(event.timestamp).toBe('2024-01-15T05:00:00.000Z')
    })

    it('preserves sub-millisecond precision when normalizing a string timestamp', () => {
      const event = buildV1Event(baseMessage({ timestamp: '2024-01-15T10:30:00.123456+05:30' }))
      expect(event.timestamp).toBe('2024-01-15T05:00:00.123456Z')
    })

    it('converts a Date timestamp to the equivalent UTC ISO string', () => {
      const event = buildV1Event(
        baseMessage({ timestamp: new Date('2024-01-15T10:30:00.000-04:00') as unknown as JsonType })
      )
      expect(event.timestamp).toBe('2024-01-15T14:30:00.000Z')
    })

    it('normalizes a timezone-less string from the configured non-UTC timezone', () => {
      expect(process.env.TZ).toBe('America/Los_Angeles')
      const event = buildV1Event(baseMessage({ timestamp: '2024-01-15T10:30:00.123456' }))
      expect(event.timestamp).toBe('2024-01-15T18:30:00.123456Z')
    })

    it('treats a numeric timestamp as epoch milliseconds', () => {
      const epoch = Date.parse('2024-01-15T10:30:00.000Z')
      const event = buildV1Event(baseMessage({ timestamp: epoch }))
      expect(event.timestamp).toBe('2024-01-15T10:30:00.000Z')
    })

    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

    it('falls back to a valid ISO string when the timestamp is missing', () => {
      const event = buildV1Event(baseMessage({ timestamp: undefined }))
      expect(event.timestamp).toMatch(ISO_RE)
    })

    it('falls back to a valid ISO string when the timestamp is uncoercible', () => {
      const event = buildV1Event(baseMessage({ timestamp: { not: 'a date' } }))
      expect(event.timestamp).toMatch(ISO_RE)
    })

    it('falls back to a valid ISO string when a string timestamp is unparseable', () => {
      const event = buildV1Event(baseMessage({ timestamp: 'not-a-date' }))
      expect(event.timestamp).toMatch(ISO_RE)
    })

    it('falls back to a valid ISO string when the timestamp is an invalid Date instance', () => {
      const event = buildV1Event(baseMessage({ timestamp: new Date('not-a-date') as unknown as JsonType }))
      expect(event.timestamp).toMatch(ISO_RE)
    })

    it('does not mutate the input message or its properties', () => {
      const message = baseMessage({
        $set: { name: 'Jane' },
        options: { process_person_profile: null },
        properties: {
          $cookieless_mode: true,
          $process_person_profile: false,
          $session_id: 'sess',
          $lib: 'posthog-node',
          keep: 'me',
        },
      })
      const snapshot = structuredClone(message)

      buildV1Event(message)

      expect(message).toEqual(snapshot)
    })
  })
})
