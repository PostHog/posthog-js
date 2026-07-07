import type { JsonType, PostHogEventProperties } from '@posthog/core'

import { buildV1Batch, buildV1Event, coerceBool, coerceString } from '@/capture-v1/transform'

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
  describe('coerceBool', () => {
    it.each<[string, JsonType, boolean | undefined]>([
      ['native true', true, true],
      ['native false', false, false],
      ['string "true"', 'true', true],
      ['string "TRUE" (case-insensitive)', 'TRUE', true],
      ['string " true " (trimmed)', ' true ', true],
      ['string "1"', '1', true],
      ['string "false"', 'false', false],
      ['string "FALSE"', 'FALSE', false],
      ['string " 0 " (trimmed)', ' 0 ', false],
      ['string "0"', '0', false],
      ['number 1', 1, true],
      ['number 42', 42, true],
      ['number -1 (nonzero)', -1, true],
      ['number 0', 0, false],
      ['string "yes" (uncoercible)', 'yes', undefined],
      ['string "off" (uncoercible)', 'off', undefined],
      ['empty string (uncoercible)', '', undefined],
      ['null (uncoercible)', null, undefined],
      ['array (uncoercible)', [], undefined],
      ['object (uncoercible)', {}, undefined],
    ])('coerces %s', (_label, input, expected) => {
      expect(coerceBool(input)).toBe(expected)
    })
  })

  describe('coerceString', () => {
    it.each<[string, JsonType, string | undefined]>([
      ['native string', 'abc', 'abc'],
      ['empty string', '', ''],
      ['integer -> decimal string', 42, '42'],
      ['zero', 0, '0'],
      ['negative integer', -7, '-7'],
      ['float (uncoercible)', 1.5, undefined],
      ['bool (uncoercible)', true, undefined],
      ['null (uncoercible)', null, undefined],
      ['array (uncoercible)', [], undefined],
      ['object (uncoercible)', {}, undefined],
    ])('coerces %s', (_label, input, expected) => {
      expect(coerceString(input)).toBe(expected)
    })
  })

  describe('buildV1Event - option sentinels', () => {
    it.each<[string, JsonType, keyof ReturnType<typeof buildV1Event>['options'], boolean | string]>([
      ['$cookieless_mode', true, 'cookieless_mode', true],
      ['$ignore_sent_at', 'true', 'disable_skew_correction', true],
      ['$process_person_profile', 0, 'process_person_profile', false],
      ['$product_tour_id', 'tour_9', 'product_tour_id', 'tour_9'],
    ])('lifts %s into options and strips it from properties', (property, value, optionKey, expected) => {
      const event = buildV1Event(baseMessage({ properties: { [property]: value, keep: 'me' } }))

      expect(event.options[optionKey]).toBe(expected)
      expect(event.properties).not.toHaveProperty(property)
      expect(event.properties.keep).toBe('me')
    })

    it('maps $product_tour_id integer to a decimal string', () => {
      const event = buildV1Event(baseMessage({ properties: { $product_tour_id: 42 } }))
      expect(event.options.product_tour_id).toBe('42')
    })

    it('omits an option that cannot be coerced but still strips the sentinel', () => {
      const event = buildV1Event(baseMessage({ properties: { $cookieless_mode: 'maybe', $product_tour_id: 1.5 } }))

      expect(event.options).not.toHaveProperty('cookieless_mode')
      expect(event.options).not.toHaveProperty('product_tour_id')
      expect(event.properties).not.toHaveProperty('$cookieless_mode')
      expect(event.properties).not.toHaveProperty('$product_tour_id')
    })

    it('leaves options as an empty object when no sentinels are present', () => {
      const event = buildV1Event(baseMessage({ properties: { foo: 'bar' } }))
      expect(event.options).toEqual({})
    })

    it('populates multiple options together', () => {
      const event = buildV1Event(
        baseMessage({
          properties: {
            $cookieless_mode: '1',
            $ignore_sent_at: false,
            $process_person_profile: true,
            $product_tour_id: 'abc',
          },
        })
      )
      expect(event.options).toEqual({
        cookieless_mode: true,
        disable_skew_correction: false,
        process_person_profile: true,
        product_tour_id: 'abc',
      })
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

    it('passes a string timestamp through unchanged', () => {
      const event = buildV1Event(baseMessage({ timestamp: '2024-01-15T10:30:00.000Z' }))
      expect(event.timestamp).toBe('2024-01-15T10:30:00.000Z')
    })

    it('converts a Date timestamp to an ISO string', () => {
      const event = buildV1Event(
        baseMessage({ timestamp: new Date('2024-01-15T10:30:00.000Z') as unknown as JsonType })
      )
      expect(event.timestamp).toBe('2024-01-15T10:30:00.000Z')
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

    it('does not mutate the input message or its properties', () => {
      const message = baseMessage({
        $set: { name: 'Jane' },
        properties: { $cookieless_mode: true, $session_id: 'sess', $lib: 'posthog-node', keep: 'me' },
      })
      const snapshot = structuredClone(message)

      buildV1Event(message)

      expect(message).toEqual(snapshot)
    })
  })

  describe('buildV1Batch', () => {
    it('wraps events with created_at and omits historical_migration by default', () => {
      const batch = buildV1Batch([baseMessage(), baseMessage({ event: 'second' })], {
        createdAt: '2024-01-15T10:30:01.000Z',
      })

      expect(batch.created_at).toBe('2024-01-15T10:30:01.000Z')
      expect(batch.batch).toHaveLength(2)
      expect(batch.batch[1].event).toBe('second')
      expect(batch).not.toHaveProperty('historical_migration')
    })

    it('includes historical_migration only when true', () => {
      const batch = buildV1Batch([baseMessage()], { createdAt: 'now', historicalMigration: true })
      expect(batch.historical_migration).toBe(true)
    })

    it('produces an empty batch array for no messages', () => {
      const batch = buildV1Batch([], { createdAt: 'now' })
      expect(batch.batch).toEqual([])
    })
  })
})
