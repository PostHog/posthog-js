import { type PostHogEventProperties, safeJsonStringify } from '@posthog/core'

import { buildV1Body, serializeV1Event } from '@/capture-v1/serialize'
import { buildV1Event } from '@/capture-v1/transform'

const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8')

function message(overrides: PostHogEventProperties = {}): PostHogEventProperties {
  return {
    event: 'test-event',
    distinct_id: 'user-123',
    uuid: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
    timestamp: '2024-01-15T10:30:00.000Z',
    properties: {},
    ...overrides,
  }
}

const MESSAGES: [string, PostHogEventProperties][] = [
  ['empty properties', message()],
  [
    'promoted fields and options',
    message({
      $set: { plan: 'pro' },
      properties: { $session_id: 's1', $window_id: 'w1', $cookieless_mode: true, nested: { a: [1, 2] } },
    }),
  ],
  ['multibyte characters', message({ event: 'café ☕', properties: { emoji: '🦔🦔', euro: '€', lone: '\ud800' } })],
]

describe('serializeV1Event', () => {
  it.each(MESSAGES)('produces the JSON of the whole wire event (%s)', (_name, input) => {
    expect(serializeV1Event(input).json).toBe(safeJsonStringify(buildV1Event(input)))
  })

  it.each(MESSAGES)('measures UTF-8 bytes of the event and of its properties (%s)', (_name, input) => {
    const serialized = serializeV1Event(input)

    expect(serialized.uuid).toBe(input.uuid)
    expect(serialized.bytes).toBe(utf8Bytes(serialized.json))
    expect(serialized.propertiesBytes).toBe(utf8Bytes(safeJsonStringify(buildV1Event(input).properties)))
  })

  it('counts bytes, not UTF-16 code units', () => {
    const serialized = serializeV1Event(message({ properties: { emoji: '🦔'.repeat(10) } }))

    expect(serialized.bytes).toBeGreaterThan(serialized.json.length)
  })
})

describe('buildV1Body', () => {
  const events = MESSAGES.map(([, input]) => serializeV1Event(input))
  const wireEvents = MESSAGES.map(([, input]) => buildV1Event(input))

  it('matches the serialized envelope byte for byte and omits historical_migration by default', () => {
    const body = buildV1Body(events, { createdAt: '2024-01-15T10:30:01.000Z', historicalMigration: false })

    expect(body).toBe(safeJsonStringify({ created_at: '2024-01-15T10:30:01.000Z', batch: wireEvents }))
    expect(JSON.parse(body)).not.toHaveProperty('historical_migration')
  })

  it('includes historical_migration only when true', () => {
    const body = buildV1Body(events, { createdAt: 'now', historicalMigration: true })

    expect(body).toBe(safeJsonStringify({ created_at: 'now', historical_migration: true, batch: wireEvents }))
  })

  it('produces an empty batch array for no events', () => {
    expect(JSON.parse(buildV1Body([], { createdAt: 'now', historicalMigration: false }))).toEqual({
      created_at: 'now',
      batch: [],
    })
  })
})
