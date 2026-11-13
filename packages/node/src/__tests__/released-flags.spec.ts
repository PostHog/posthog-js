import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PostHog } from '@/entrypoints/index.node'
import { FAILED_FLAG, PARITY_FLAGS, runAll, Shape } from './released-flags-scenarios'

// Legacy flag results pinned to what posthog-node 5.61.2 returned and sent, from the v2 response
// it requests. Each scenario runs here from the v2 and the v4 response of the same flags, so a
// change shared by both readers is caught too. `released-flags-scenarios.ts` says how the
// recording was made.

type Results = Record<string, Record<string, any>>

const RELEASED: Results = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/released-flags-5.61.2.json', import.meta.url)), 'utf8')
).results

// The distinct IDs the scenarios use for single-flag getters that send `$feature_flag_called`.
const SINGLE_FLAG_READERS = new Set(['getter-user', 'enabled-user', 'result-user'])

function sortedEvents(events: unknown[]): unknown[] {
  return events
    .map((event) => JSON.stringify(event))
    .sort()
    .map((event) => JSON.parse(event))
}

// The reason code of each config version 2 flag in the scenarios.
const CONFIG_VERSION_2_REASON_CODES = new Map(
  [...PARITY_FLAGS, FAILED_FLAG].filter((spec) => spec.configVersion === 2).map((spec) => [spec.key, spec.reason?.code])
)

function withKeysSorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withKeysSorted)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => [key, withKeysSorted(item)])
    )
  }
  return value
}

/** A scenario's results with its events in one order, whatever the key order of their properties. */
function canonical(results: Record<string, any>): Record<string, any> {
  return { ...results, events: sortedEvents(withKeysSorted(results.events) as unknown[]) }
}

/**
 * The recorded results with the `$feature_flag_called` events of config version 2 flags as the
 * v4 response reports them: with their config version and reason code in place of the reason
 * description. 5.61.2 read the v2 response, where every flag reads as config version 1. No flag in
 * these scenarios is an experiment split, so none sends `$experiment_exposure`.
 */
function withConfigVersion2Attribution(recorded: Record<string, any>): Record<string, any> {
  const events = recorded.events.map(([event, distinctId, properties]: [string, string, Record<string, any>]) => {
    const reasonCode = CONFIG_VERSION_2_REASON_CODES.get(properties.$feature_flag)
    if (event !== '$feature_flag_called' || reasonCode === undefined) {
      return [event, distinctId, properties]
    }
    const { $feature_flag_reason: _reason, ...rest } = properties
    return [event, distinctId, { ...rest, $feature_flag_config_version: 2, $feature_flag_reason_code: reasonCode }]
  })
  return canonical({ ...recorded, events })
}

describe.each<Shape>(['v2', 'v4'])('legacy flag results from the %s response', (shape) => {
  let results: Results

  beforeAll(async () => {
    vi.useRealTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    results = await runAll(PostHog, shape)
  })

  afterAll(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  it.each(['getters', 'getters with a failed flag', 'getters with the unreadable record read as disabled'])(
    'match 5.61.2: %s',
    (scenario) => {
      if (shape === 'v4') {
        // The only change: config version 2 flag calls report their attribution.
        expect(canonical(results[scenario])).toEqual(withConfigVersion2Attribution(RELEASED[scenario]))
      } else {
        expect(results[scenario]).toEqual(RELEASED[scenario])
      }
    }
  )

  it('read an unreadable record as a disabled flag without reason or metadata', () => {
    // 5.61.2 read a record with a known field of the wrong JSON type anyway.
    expect(RELEASED['getters with an unreadable record']['getFeatureFlag:unreadable']).toBe('compact')

    // That record now fails alone: it reads as a disabled flag without reason or metadata, and
    // its sibling reads as before. A single-flag read of it reports what 5.61.2 reported when
    // the /flags request failed: an unknown_error and no request details. A snapshot read of it
    // sends its event as for any disabled flag.
    const expected = structuredClone(RELEASED['getters with the unreadable record read as disabled'])
    for (const [, distinctId, properties] of expected.events) {
      if (properties.$feature_flag === 'unreadable' && SINGLE_FLAG_READERS.has(distinctId)) {
        delete properties.$feature_flag_request_id
        delete properties.$feature_flag_evaluated_at
        properties.$feature_flag_error = 'unknown_error'
      }
    }
    expected.events = sortedEvents(expected.events)

    expect(results['getters with an unreadable record']).toEqual(expected)
  })
})
