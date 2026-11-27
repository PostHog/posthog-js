import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { hashSHA1, InconclusiveMatchError } from '@posthog/core'

import { PostHog } from '@/entrypoints/index.node'
import * as v2 from '@/extensions/feature-flags/feature-flags-v2'
import { parsedFlagRecordOf, readFlagRecords } from '@/flags-response'
import type { PostHogFeatureFlag, PostHogOptions } from '@/types'

// Local evaluation chooses the evaluator of each loaded definition by its config version. A
// definition whose `filters.version` is absent or 1 runs the version 1 evaluator as before. Any
// other goes to the config version 2 evaluator, whose result is the record a `/flags?v=4` response
// gives, so the flag is read, and its events are sent, as for a remote record. The contract files
// in `fixtures/feature_flag_rules_v2` are copied unchanged from a
// PostHog/posthog-sdk-test-harness release; `SOURCE.json` records which.

vi.mock('@posthog/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@posthog/core')>()
  return { ...core, hashSHA1: vi.fn(core.hashSHA1) }
})

vi.mock('@/extensions/feature-flags/feature-flags-v2', async (importOriginal) => {
  const module = await importOriginal<typeof import('@/extensions/feature-flags/feature-flags-v2')>()
  return {
    ...module,
    evaluateConfigV2Definition: vi.fn(module.evaluateConfigV2Definition),
    parseConfigV2Definitions: vi.fn(module.parseConfigV2Definitions),
  }
})

const FIXTURES = fileURLToPath(new URL('./fixtures/feature_flag_rules_v2/', import.meta.url))
const load = (name: string): any => JSON.parse(readFileSync(FIXTURES + name, 'utf8'))

const LOCAL_OUTCOMES = load('local_outcomes.json')
const FEED = load('definitions_feed.json')

const DISTINCT_ID = 'reader-31'
const RULE = '5c2e9a14-7b3d-4f61-a8e0-2d4c6b8f1e3a'
const SECOND_RULE = '9e1f3b27-4c5a-4d8e-b6f2-7a0c1e3d5b49'
const SPLIT_RULE = 'c47d2e90-1a3b-4c5d-9e6f-8b0a2c4e6d1f'
const SPLIT_SEED = 'shelf-order'

const FLAG_CALLED = '$feature_flag_called'
const EXPOSURE = '$experiment_exposure'
const ATTRIBUTION = [
  '$feature_flag_config_version',
  '$feature_flag_reason_code',
  '$feature_flag_rule_id',
  '$feature_flag_rule_type',
  '$feature_flag_variant_key',
]

type Json = Record<string, any>

// --- Definitions -------------------------------------------------------------------------------

const person = (key: string, operator: string, value: unknown): Json => ({ key, type: 'person', operator, value })

const targeted = (value: unknown, properties: Json[] = [], id = RULE): Json => ({
  id,
  rule_type: 'targeted_release',
  targeting: { properties },
  value,
})

const rollout = (value: unknown, percentage: number, onMiss = 'continue', id = SECOND_RULE): Json => ({
  id,
  rule_type: 'percentage_rollout',
  targeting: { properties: [] },
  value,
  rollout_percentage: percentage,
  on_rollout_miss: onMiss,
  assignment_algorithm: 'sha1_60_v1',
  seed: 'reading-room',
})

const experiment = (properties: Json[] = []): Json => ({
  id: SPLIT_RULE,
  rule_type: 'experiment',
  targeting: { properties },
  paused: false,
  rollout_percentage: 100,
  on_rollout_miss: 'continue',
  assignment_algorithm: 'sha1_60_v1',
  seed: SPLIT_SEED,
  variants: [
    { key: 'by-title', weight: 50, value: 'title' },
    { key: 'by-date', weight: 50, value: 'date' },
  ],
})

const filters = (rules: Json[], returnType = 'boolean', defaultValue: unknown = false): Json => ({
  version: 2,
  return_type: returnType,
  default_value: defaultValue,
  rules,
})

function definition(key: string, flagFilters: unknown, fields: Partial<Json> = {}): PostHogFeatureFlag {
  return {
    id: 42,
    name: key,
    key,
    filters: flagFilters,
    deleted: false,
    active: true,
    rollout_percentage: null,
    ensure_experience_continuity: false,
    experiment_set: [],
    version: 7,
    has_experiment: false,
    ...fields,
  } as unknown as PostHogFeatureFlag
}

const v1Definition = (key: string, fields: Partial<Json> = {}, flagFilters: Json = {}): PostHogFeatureFlag =>
  definition(key, { groups: [{ properties: [], rollout_percentage: 100 }], ...flagFilters }, fields)

const BOOLEAN = definition('reading-mode', filters([targeted(true)]))
const STRING = definition('shelf-colour', filters([targeted('green')], 'string', 'grey'))
const NUMBER = definition('page-size', filters([targeted(25)], 'number', 10))
const OBJECT = definition('reader-layout', filters([targeted({ columns: 2, sidebar: { open: true } })], 'object', null))
const NULL_DEFAULT = definition(
  'quiet-hours',
  filters([targeted(true, [person('plan', 'exact', 'pro')])], 'boolean', null)
)
const SPLIT = definition('shelf-order', filters([experiment()], 'string', 'title'), { has_experiment: true })
const UNKNOWN_VERSION = definition('future-format', { ...filters([targeted(true)]), version: 3 })
const NEEDS_PLAN = definition(
  'pro-reader',
  filters([targeted(true, [person('plan', 'exact', 'pro')]), targeted(true, [], SECOND_RULE)])
)

// --- Clients -------------------------------------------------------------------------------

type Event = { event: string; distinct_id: unknown; properties: Record<string, any> }

type ClientSetup = {
  definitions?: Json
  remote?: Json
  options?: Partial<PostHogOptions>
}

const definitionsBody = (flags: PostHogFeatureFlag[], fields: Json = {}): Json => ({
  flags,
  group_type_mapping: {},
  cohorts: {},
  property_matching_version: 2,
  ...fields,
})

/** A client with local evaluation of `definitions`, whose `/flags` answers with `remote`. */
function createClient({ definitions = definitionsBody([]), remote, options = {} }: ClientSetup): {
  client: PostHog
  events: Event[]
  fetch: ReturnType<typeof vi.fn>
  remoteCalls: () => number
} {
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/flags/definitions')) {
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(definitions),
        json: async () => structuredClone(definitions),
      }
    }
    if (url.includes('/flags/?')) {
      const body = remote ?? { flags: {}, errorsWhileComputingFlags: false }
      return { status: 200, text: async () => JSON.stringify(body), json: async () => structuredClone(body) }
    }
    return { status: 200, text: async () => 'ok', json: async () => ({ status: 'ok' }) }
  })
  const client = new PostHog('TEST_API_KEY', {
    host: 'http://example.com',
    personalApiKey: 'phx_test',
    fetch: fetch as any,
    fetchRetryCount: 0,
    flushAt: 1000,
    ...options,
  })
  const events: Event[] = []
  client.on('capture', (message) => {
    if (message && typeof message === 'object') {
      events.push(structuredClone(message))
    }
  })
  const remoteCalls = (): number => fetch.mock.calls.filter(([url]) => url.includes('/flags/?')).length
  return { client, events, fetch, remoteCalls }
}

const clients: PostHog[] = []

function setUp(setup: ClientSetup): ReturnType<typeof createClient> {
  const created = createClient(setup)
  clients.push(created.client)
  return created
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()))
  vi.mocked(hashSHA1).mockImplementation((text) => hashSHA1Original(text))
})

let hashSHA1Original: (text: string) => Promise<string>

beforeAll(async () => {
  const core = await vi.importActual<typeof import('@posthog/core')>('@posthog/core')
  hashSHA1Original = core.hashSHA1
})

beforeEach(() => {
  vi.mocked(v2.evaluateConfigV2Definition).mockClear()
  vi.mocked(v2.parseConfigV2Definitions).mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const poller = (client: PostHog): any => (client as any).featureFlagsPoller

/** A `/flags?v=4` response with one record per key. */
function remoteResponse(records: Record<string, Json>): Json {
  return {
    flags: Object.fromEntries(
      Object.entries(records).map(([key, record]) => [
        key,
        {
          key,
          metadata: { id: 42, version: 7, config_version: 2, description: null, payload: null, has_experiment: false },
          ...record,
        },
      ])
    ),
    errorsWhileComputingFlags: false,
    requestId: '5d1e2f30-4a5b-4c6d-8e7f-90a1b2c3d4e5',
  }
}

const named = (events: Event[], event: string, key: string): Event[] =>
  events.filter((captured) => captured.event === event && captured.properties.$feature_flag === key)

const attribution = (properties: Record<string, any>): Record<string, any> =>
  Object.fromEntries(ATTRIBUTION.filter((name) => name in properties).map((name) => [name, properties[name]]))

/** The value a legacy getter returns and the payload, for a typed value. */
function legacyRendering(value: unknown): [boolean | string, unknown] {
  if (value === null || typeof value === 'boolean') {
    return [value === true, null]
  }
  if (typeof value === 'string') {
    return [value, null]
  }
  return [true, value]
}

// --- The dispatch ------------------------------------------------------------------------------

describe('the config version dispatch', () => {
  it.each([
    ['without a version', {}],
    ['version 1', { version: 1 }],
  ])('keeps the version 1 evaluator for a definition %s', async (_name, fields) => {
    const flag = v1Definition(
      'legacy-banner',
      {},
      {
        ...fields,
        multivariate: { variants: [{ key: 'only', rollout_percentage: 100 }] },
      }
    )
    const { client, events } = setUp({ definitions: definitionsBody([flag]) })

    expect(await client.getFeatureFlag('legacy-banner', DISTINCT_ID, { onlyEvaluateLocally: true })).toBe('only')
    await client.shutdown()

    expect(v2.evaluateConfigV2Definition).not.toHaveBeenCalled()
    const [called] = named(events, FLAG_CALLED, 'legacy-banner')
    expect(called.properties.locally_evaluated).toBe(true)
    expect(attribution(called.properties)).toEqual({})
  })

  it.each([
    [2, 'evaluated'],
    [3, 'unsupported'],
    [null, 'unsupported'],
    [true, 'unsupported'],
    ['1', 'unsupported'],
    ['2', 'unsupported'],
  ])('sends a definition with version %j to the config version 2 evaluator', async (version, outcome) => {
    const flag = definition('reading-mode', { ...filters([targeted(true)]), version })
    const { client } = setUp({ definitions: definitionsBody([flag]) })

    const value = await client.getFeatureFlag('reading-mode', DISTINCT_ID, { onlyEvaluateLocally: true })

    expect(v2.evaluateConfigV2Definition).toHaveBeenCalledTimes(1)
    // A document the evaluator cannot read is never `false`.
    expect(value).toBe(outcome === 'evaluated' ? true : undefined)
  })

  it('requests the definitions as before', async () => {
    const { client, fetch } = setUp({ definitions: definitionsBody([BOOLEAN]) })

    await client.getFeatureFlag('reading-mode', DISTINCT_ID)

    const urls = fetch.mock.calls.map(([url]) => url).filter((url: string) => url.includes('/flags/definitions'))
    expect(urls).toEqual(['http://example.com/flags/definitions?token=TEST_API_KEY&send_cohorts'])
  })

  it.each([
    ['a boolean', BOOLEAN, true, null],
    ['a string', STRING, 'green', null],
    ['a number', NUMBER, true, 25],
    ['an object', OBJECT, true, { columns: 2, sidebar: { open: true } }],
    ['a null default', NULL_DEFAULT, false, null],
  ])('evaluates %s flag locally on every read', async (_name, flag, value, payload) => {
    const { client, remoteCalls } = setUp({ definitions: definitionsBody([flag]) })
    const key = flag.key
    const options = { personProperties: { plan: 'free' } }

    expect(await client.getFeatureFlag(key, DISTINCT_ID, options)).toBe(value)
    expect(await client.isFeatureEnabled(key, DISTINCT_ID, options)).toBe(value !== false)
    expect(await client.getFeatureFlagPayload(key, DISTINCT_ID, undefined, options)).toEqual(payload)
    const result = await client.getFeatureFlagResult(key, DISTINCT_ID, options)
    expect(result).toMatchObject({
      key,
      enabled: value !== false,
      variant: typeof value === 'string' ? value : undefined,
      reason: 'Evaluated locally',
      reasonCode: flag === NULL_DEFAULT ? 'no_rule_match' : 'targeting_match',
    })
    expect(result?.payload ?? null).toEqual(payload)
    expect(await client.getAllFlags(DISTINCT_ID, options)).toEqual({ [key]: value })
    const all = await client.getAllFlagsAndPayloads(DISTINCT_ID, options)
    expect(all.featureFlags).toEqual({ [key]: value })
    expect(all.featureFlagPayloads).toEqual(payload === null ? {} : { [key]: payload })
    const snapshot = await client.evaluateFlags(DISTINCT_ID, options)
    expect(snapshot.getFlag(key)).toBe(value)
    expect(snapshot.getFlagPayload(key) ?? null).toEqual(payload)

    expect(remoteCalls()).toBe(0)
    expect(v2.evaluateConfigV2Definition).toHaveBeenCalled()
  })

  it('gives the record a /flags?v=4 response gives for the same result', async () => {
    const { client } = setUp({ definitions: definitionsBody([SPLIT]) })
    await client.getFeatureFlag('shelf-order', DISTINCT_ID)
    const context = {
      distinctId: DISTINCT_ID,
      groups: {},
      personProperties: {},
      groupProperties: {},
      evaluationCache: {},
    }

    const local = await poller(client).computeFlagAndPayloadLocally(SPLIT, context)

    const remote = readFlagRecords({
      flags: {
        'shelf-order': {
          key: 'shelf-order',
          value: local.record.record.value,
          reason: { code: 'experiment_split', condition_index: 0, description: 'Evaluated locally' },
          metadata: {
            id: 42,
            version: 7,
            config_version: 2,
            description: null,
            has_experiment: true,
            rule_type: 'experiment',
            rule_id: SPLIT_RULE,
            variant_key: local.record.record.metadata.variantKey,
          },
        },
      },
    }).body as Json
    expect(local.record.detail).toEqual(remote.flags['shelf-order'])
    expect(local.record.record).toEqual(parsedFlagRecordOf(remote.flags['shelf-order']))
    expect(['by-title', 'by-date']).toContain(local.record.record.metadata.variantKey)
  })

  it('leaves out an id or version the reader would reject', async () => {
    const flag = definition('reading-mode', filters([targeted(true)]), { id: 'x', version: 1.5 })
    const { client } = setUp({ definitions: definitionsBody([flag]) })

    const result = await client.getFeatureFlagResult('reading-mode', DISTINCT_ID, { onlyEvaluateLocally: true })

    expect(result?.enabled).toBe(true)
  })

  it('hands every caller its own copy of an object value', async () => {
    const { client } = setUp({ definitions: definitionsBody([OBJECT]) })

    const first = (await client.getFeatureFlagPayload('reader-layout', DISTINCT_ID)) as Json
    first.sidebar.open = false
    const snapshot = await client.evaluateFlags(DISTINCT_ID)
    ;(snapshot.getFlagPayload('reader-layout') as Json).columns = 9
    const record = (snapshot as any)._flags['reader-layout'].parsed
    record.value.sidebar.open = false

    expect(await client.getFeatureFlagPayload('reader-layout', DISTINCT_ID)).toEqual({
      columns: 2,
      sidebar: { open: true },
    })
    const loaded = poller(client).featureFlagsByKey['reader-layout']
    expect(loaded.filters.rules[0].value).toEqual({ columns: 2, sidebar: { open: true } })
  })

  it.each([false, true])(
    'disables an inactive flag without reading its rules, also when its document is unsupported (%s)',
    async (unsupported) => {
      const flag = definition(
        'reading-mode',
        { ...filters([targeted(true)]), ...(unsupported ? { version: 3 } : {}) },
        {
          active: false,
        }
      )
      const { client, events, remoteCalls } = setUp({ definitions: definitionsBody([flag]) })

      expect(await client.getFeatureFlag('reading-mode', DISTINCT_ID)).toBe(false)
      const result = await client.getFeatureFlagResult('reading-mode', DISTINCT_ID)
      await client.shutdown()

      expect(result).toMatchObject({ enabled: false, reasonCode: 'flag_disabled' })
      expect(remoteCalls()).toBe(0)
      const [called] = named(events, FLAG_CALLED, 'reading-mode')
      expect(attribution(called.properties)).toEqual({
        $feature_flag_config_version: 2,
        $feature_flag_reason_code: 'flag_disabled',
      })
    }
  )

  it('ignores experience continuity and device bucketing', async () => {
    const flag = definition('reading-mode', filters([targeted(true)]), {
      ensure_experience_continuity: true,
      bucketing_identifier: 'device_id',
    })
    const { client, remoteCalls } = setUp({ definitions: definitionsBody([flag]) })

    expect(await client.getFeatureFlag('reading-mode', DISTINCT_ID)).toBe(true)
    expect(remoteCalls()).toBe(0)
  })

  it('takes exact matching from the property matching version', async () => {
    // Without explicit exact matching, a filter that looks like a boolean matches by truthiness.
    const flag = definition('reading-mode', filters([targeted(true, [person('tags', 'exact', 'TRUE')])]))
    const options = { personProperties: { tags: ['true'] }, onlyEvaluateLocally: true }
    const legacy = setUp({ definitions: definitionsBody([flag], { property_matching_version: 1 }) })
    const explicit = setUp({ definitions: definitionsBody([flag], { property_matching_version: 2 }) })

    expect(await legacy.client.getFeatureFlag('reading-mode', DISTINCT_ID, options)).toBe(true)
    expect(await explicit.client.getFeatureFlag('reading-mode', DISTINCT_ID, options)).toBe(false)
  })

  it('reads dates in UTC, whatever the host timezone', async () => {
    // The tests run in America/Los_Angeles.
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    const flag = definition(
      'reading-mode',
      filters([targeted(true, [person('joined', 'is_date_before', '2025-06-15 12:00:00')])])
    )
    const { client } = setUp({ definitions: definitionsBody([flag]) })
    const read = (joined: string): Promise<unknown> =>
      client.getFeatureFlag('reading-mode', DISTINCT_ID, { personProperties: { joined }, onlyEvaluateLocally: true })

    expect(await read('2025-06-15T11:59:59Z')).toBe(true)
    expect(await read('2025-06-15T12:00:00Z')).toBe(false)
    expect(await read('2025-06-15T11:59:59')).toBe(true)
  })

  it('counts relative dates back from now in UTC', async () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    const flag = definition('reading-mode', filters([targeted(true, [person('joined', 'is_date_after', '-1d')])]))
    const { client } = setUp({ definitions: definitionsBody([flag]) })
    const read = (joined: string): Promise<unknown> =>
      client.getFeatureFlag('reading-mode', DISTINCT_ID, { personProperties: { joined }, onlyEvaluateLocally: true })

    expect(await read('2025-06-14T12:00:01Z')).toBe(true)
    expect(await read('2025-06-14T12:00:00Z')).toBe(false)
  })

  it('hashes the distinct ID as a string', async () => {
    const flag = definition('reading-mode', filters([rollout(true, 50)]))
    const { client } = setUp({ definitions: definitionsBody([flag]) })
    await client.getFeatureFlag('reading-mode', DISTINCT_ID)
    const read = async (distinctId: unknown): Promise<unknown> =>
      (
        await poller(client).computeFlagAndPayloadLocally(flag, {
          distinctId,
          groups: {},
          personProperties: {},
          groupProperties: {},
          evaluationCache: {},
        })
      ).value
    const values = new Set<unknown>()

    for (let id = 0; id < 20; id++) {
      const asString = await read(String(id))
      expect(await read(id)).toBe(asString)
      values.add(asString)
    }
    expect(values).toEqual(new Set([true, false]))
  })

  it('parses each definition once, when it loads', async () => {
    const { client } = setUp({ definitions: definitionsBody([v1Definition('legacy-banner'), BOOLEAN, SPLIT]) })

    await client.getFeatureFlag('reading-mode', DISTINCT_ID)
    await client.getFeatureFlag('shelf-order', DISTINCT_ID)
    await client.evaluateFlags(DISTINCT_ID)

    expect(v2.parseConfigV2Definitions).toHaveBeenCalledTimes(1)
    const parsed = vi.mocked(v2.parseConfigV2Definitions).mock.results[0].value as Map<string, any>
    expect([...parsed.keys()]).toEqual(['reading-mode', 'shelf-order'])
    for (const [flag, map] of vi.mocked(v2.evaluateConfigV2Definition).mock.calls) {
      expect(map).toBe(parsed)
      expect(parsed.get(flag.key).definition).toBe(flag)
    }
  })
})

// --- Fallback --------------------------------------------------------------------------------

const UNDECIDED: Record<string, [PostHogFeatureFlag, Json, string]> = {
  'an unknown config version': [UNKNOWN_VERSION, {}, 'unsupported_definition'],
  'an unknown rule type': [
    definition(
      'future-format',
      filters([targeted(true), { ...targeted(true, [], SECOND_RULE), rule_type: 'scheduled' }])
    ),
    {},
    'unsupported_definition',
  ],
  'a property the read did not pass': [NEEDS_PLAN, {}, 'missing_context'],
  'a property that is not a number': [
    definition('future-format', filters([targeted(true, [person('age', 'gt', 30)])])),
    { age: 'thirty' },
    'missing_context',
  ],
  'an invalid pattern': [
    definition('future-format', filters([targeted(true, [person('email', 'regex', '[')])])),
    { email: 'a@example.com' },
    'unsupported_definition',
  ],
  'a date form only the flags service reads': [
    definition('future-format', filters([targeted(true, [person('joined', 'is_date_after', '2025-01-01')])])),
    { joined: '15/06/2025' },
    'missing_context',
  ],
  'a filter number that may be 7 or 7.0': [
    definition('future-format', filters([targeted(true, [person('shelf', 'exact', 7)])])),
    { shelf: '7' },
    'unsupported_definition',
  ],
}

describe('a flag the evaluator cannot decide', () => {
  it.each(Object.entries(UNDECIDED))('falls back to a remote request for %s', async (_name, [flag, properties]) => {
    const remote = remoteResponse({ [flag.key]: { value: 'from-remote', reason: { code: 'targeting_match' } } })
    const { client, events, remoteCalls } = setUp({ definitions: definitionsBody([flag]), remote })

    expect(await client.getFeatureFlag(flag.key, DISTINCT_ID, { personProperties: properties })).toBe('from-remote')
    const snapshot = await client.evaluateFlags(DISTINCT_ID, { personProperties: properties })
    expect(snapshot.getFlag(flag.key)).toBe('from-remote')
    await client.shutdown()

    expect(remoteCalls()).toBe(2)
    for (const called of named(events, FLAG_CALLED, flag.key)) {
      expect(called.properties.locally_evaluated).toBe(false)
    }
  })

  it.each(Object.entries(UNDECIDED))(
    'leaves %s unresolved when evaluating only locally',
    async (_name, [flag, properties, reason]) => {
      const { client, remoteCalls } = setUp({ definitions: definitionsBody([flag]) })
      const options = { personProperties: properties, onlyEvaluateLocally: true }

      expect(await client.getFeatureFlag(flag.key, DISTINCT_ID, options)).toBeUndefined()
      expect(await client.getFeatureFlagResult(flag.key, DISTINCT_ID, options)).toBeUndefined()
      expect(await client.getAllFlags(DISTINCT_ID, options)).toEqual({})
      const snapshot = await client.evaluateFlags(DISTINCT_ID, options)
      expect(snapshot.unresolvedFlags).toEqual({ [flag.key]: reason })
      expect(snapshot.getFlag(flag.key)).toBeUndefined()

      expect(remoteCalls()).toBe(0)
    }
  )

  it('ends the evaluation at a rule that needs a missing property, before a rule that matches everyone', async () => {
    const { client } = setUp({ definitions: definitionsBody([NEEDS_PLAN]) })

    const snapshot = await client.evaluateFlags(DISTINCT_ID, { personProperties: {}, onlyEvaluateLocally: true })

    expect(snapshot.unresolvedFlags).toEqual({ 'pro-reader': 'missing_context' })
    expect(await client.getFeatureFlag('pro-reader', DISTINCT_ID, { personProperties: { plan: 'pro' } })).toBe(true)
  })

  it('warns on load about an unsupported config version 2 document', async () => {
    const { client } = setUp({ definitions: definitionsBody([UNKNOWN_VERSION, BOOLEAN]) })

    await client.getFeatureFlag('reading-mode', DISTINCT_ID)

    const warnings = vi.mocked(console.warn).mock.calls.map(([message]) => String(message))
    expect(warnings.filter((message) => message.includes('unsupported_definition'))).toEqual([
      expect.stringContaining('future-format'),
    ])
    expect(warnings.join('\n')).not.toContain('reading-mode')
  })
})

// --- The definitions feed of the contract ------------------------------------------------------

// One whole definitions feed: version 1 and config version 2 flags, active and inactive, a cohort
// flag, a group flag, and three entries that the parser does not support, each between supported
// ones. For each entry the contract states the evaluator that reads it, what the reader does with
// it in each mode, and the result of a config version 2 entry for the fixture's context.
const FEED_ENTRIES: [Json, Json][] = FEED.feed.flags.map((entry: Json, index: number) => [
  entry,
  FEED.expectations[index],
])
const FEED_CONTEXT = FEED.context

function feedClient(remote?: Json): ReturnType<typeof createClient> {
  // The client never knows that a property map is complete, reads dates in UTC and takes exact
  // matching from the feed, so the fixture's context must be one it uses.
  expect(FEED_CONTEXT.properties_complete).toBe(false)
  expect(FEED_CONTEXT.timezone).toBe('UTC')
  expect(FEED_CONTEXT.explicit_exact_matching).toBe(FEED.feed.property_matching_version === 2)
  return setUp({ definitions: FEED.feed, remote })
}

/** A local record in the shape of a corpus `expected` member. */
function recordAsExpectation(record: v2.ConfigV2LocalResult['record']): Json {
  const expectation: Json = { status: 'success', value: record.value, reason: record.reason?.code }
  const rule = {
    id: record.metadata.ruleId,
    rule_type: record.metadata.ruleType,
    index: record.reason?.conditionIndex,
  }
  // The evaluator sets all three rule fields or none of them.
  const present = Object.values(rule).filter((field) => field !== undefined).length
  expect(present === 0 || present === 3, `a partial rule in ${JSON.stringify(record)}`).toBe(true)
  if (present === 3) {
    expectation.rule = rule
  }
  if (record.metadata.variantKey !== undefined) {
    expectation.variant = record.metadata.variantKey
  }
  return expectation
}

describe('the definitions feed of the contract', () => {
  it.each(FEED_ENTRIES.map(([entry, expectation]) => [entry.key, entry, expectation]))(
    '%s gets the evaluator and the result the contract states',
    async (_key, entry, expectation) => {
      const { client } = feedClient()
      await client.getFeatureFlag(entry.key, FEED_CONTEXT.identifier, { onlyEvaluateLocally: true })
      vi.mocked(v2.evaluateConfigV2Definition).mockClear()
      const flag = poller(client).featureFlagsByKey[entry.key]
      const read = (): Promise<any> =>
        poller(client).computeFlagAndPayloadLocally(flag, {
          distinctId: FEED_CONTEXT.identifier,
          groups: {},
          personProperties: FEED_CONTEXT.properties,
          groupProperties: {},
          evaluationCache: {},
        })

      if (expectation.reader.local_only === 'unsupported') {
        await expect(read()).rejects.toThrow(InconclusiveMatchError)
        await expect(read()).rejects.toMatchObject({ reason: 'unsupported_definition' })
        expect(v2.evaluateConfigV2Definition).toHaveBeenCalled()
      } else if (expectation.evaluator === 'v1') {
        expect((await read()).record).toBeUndefined()
        expect(v2.evaluateConfigV2Definition).not.toHaveBeenCalled()
      } else {
        const { record } = await read()
        expect(recordAsExpectation(record.record)).toEqual(expectation.expected)
      }
    }
  )

  it.each(['auto', 'local_only'])('falls back for only the entries the reader does not support (%s)', async (mode) => {
    const remote = remoteResponse(
      Object.fromEntries(
        FEED_ENTRIES.map(([entry]) => [entry.key, { value: 'from-remote', reason: { code: 'targeting_match' } }])
      )
    )
    const { client, events, remoteCalls } = feedClient(remote)

    const snapshot = await client.evaluateFlags(FEED_CONTEXT.identifier, {
      personProperties: FEED_CONTEXT.properties,
      onlyEvaluateLocally: mode === 'local_only',
    })
    const values = Object.fromEntries(FEED_ENTRIES.map(([entry]) => [entry.key, snapshot.getFlag(entry.key)]))
    await client.shutdown()

    const outcomes: Record<string, string> = Object.fromEntries(
      FEED.expectations.map((expectation: Json) => [expectation.key, expectation.reader[mode]])
    )
    expect(remoteCalls()).toBe(mode === 'auto' ? 1 : 0)
    expect(snapshot.unresolvedFlags).toEqual(
      Object.fromEntries(
        Object.entries(outcomes)
          .filter(([, outcome]) => outcome === 'unsupported')
          .map(([key]) => [key, 'unsupported_definition'])
      )
    )
    for (const [entry, expectation] of FEED_ENTRIES) {
      const outcome = outcomes[entry.key]
      if (outcome === 'unsupported') {
        expect(values[entry.key]).toBeUndefined()
        continue
      }
      const [called] = named(events, FLAG_CALLED, entry.key)
      expect(called.properties.locally_evaluated).toBe(outcome === 'local_evaluation')
      if (outcome === 'remote_fallback') {
        expect(values[entry.key]).toBe('from-remote')
      } else if ('expected' in expectation) {
        // A sibling of an entry that falls back keeps its own result.
        const [value, payload] = legacyRendering(expectation.expected.value)
        expect(values[entry.key]).toBe(value)
        expect(snapshot.getFlagPayload(entry.key) ?? null).toEqual(payload)
      }
    }
  })
})

// --- Flag dependencies -------------------------------------------------------------------------

function dependsOn(key: string, dependency: string, ...later: Json[]): PostHogFeatureFlag {
  return v1Definition(
    key,
    {},
    {
      groups: [
        {
          properties: [
            {
              key: dependency,
              type: 'flag',
              value: true,
              operator: 'flag_evaluates_to',
              dependency_chain: [dependency],
            },
          ],
          rollout_percentage: 100,
        },
        ...later,
      ],
    }
  )
}

describe('flag dependencies', () => {
  it('never evaluate a config version 2 flag as version 1', async () => {
    const dependent = dependsOn('dependent', 'reading-mode', { properties: [], rollout_percentage: 100 })
    const remote = remoteResponse({ dependent: { value: 'from-remote', reason: { code: 'condition_match' } } })
    const { client, remoteCalls } = setUp({ definitions: definitionsBody([BOOLEAN, dependent]), remote })

    expect(await client.getFeatureFlag('dependent', DISTINCT_ID)).toBe('from-remote')
    expect(remoteCalls()).toBe(1)
    const snapshot = await client.evaluateFlags(DISTINCT_ID, { flagKeys: ['dependent'], onlyEvaluateLocally: true })
    expect(snapshot.unresolvedFlags).toEqual({ dependent: 'unsupported_definition' })
    expect(v2.evaluateConfigV2Definition).not.toHaveBeenCalled()
  })

  it('evaluate a version 1 dependency as before', async () => {
    const dependent = dependsOn('dependent', 'legacy-banner')
    const { client } = setUp({ definitions: definitionsBody([v1Definition('legacy-banner'), dependent]) })

    expect(await client.getFeatureFlag('dependent', DISTINCT_ID, { onlyEvaluateLocally: true })).toBe(true)
  })

  it('name a version 1 flag with a config version 2 dependency in the load warning', async () => {
    const { client } = setUp({ definitions: definitionsBody([BOOLEAN, dependsOn('dependent', 'reading-mode')]) })

    await client.getFeatureFlag('reading-mode', DISTINCT_ID)

    const warnings = vi.mocked(console.warn).mock.calls.map(([message]) => String(message))
    expect(warnings.filter((message) => message.includes('unsupported_definition'))).toEqual([
      expect.stringContaining(': dependent.'),
    ])
  })
})

// --- Flag events -------------------------------------------------------------------------------

const EXPECTED_SPLIT = (variantKey: string): Json => ({
  $feature_flag_config_version: 2,
  $feature_flag_reason_code: 'experiment_split',
  $feature_flag_rule_id: SPLIT_RULE,
  $feature_flag_rule_type: 'experiment',
  $feature_flag_variant_key: variantKey,
})

const READS: Record<string, (client: PostHog) => Promise<unknown>> = {
  single: (client) => client.getFeatureFlag('shelf-order', DISTINCT_ID),
  snapshot: async (client) => (await client.evaluateFlags(DISTINCT_ID)).getFlag('shelf-order'),
}

describe('flag events of a local config version 2 result', () => {
  it.each(Object.keys(READS))('send both events of a split as locally evaluated (%s read)', async (name) => {
    const { client, events, remoteCalls } = setUp({ definitions: definitionsBody([SPLIT]) })

    const value = await READS[name](client)
    await client.shutdown()

    const variantKey = value === 'title' ? 'by-title' : 'by-date'
    const [called] = named(events, FLAG_CALLED, 'shelf-order')
    const [exposure] = named(events, EXPOSURE, 'shelf-order')
    expect(remoteCalls()).toBe(0)
    expect(called.properties).toMatchObject({
      $feature_flag_response: value,
      locally_evaluated: true,
      $feature_flag_id: 42,
      $feature_flag_version: 7,
      ...EXPECTED_SPLIT(variantKey),
    })
    expect(called.properties).not.toHaveProperty('$feature_flag_reason')
    expect(exposure.properties).toMatchObject({
      $feature_flag: 'shelf-order',
      $feature_flag_response: value,
      $feature_flag_variant_key: variantKey,
      $feature_flag_rule_id: SPLIT_RULE,
      locally_evaluated: true,
    })
  })

  // The events carry what the record holds, as for a remote record: the reader leaves out an id or
  // version that is not an integer, and an experiment link that is not a boolean.
  it.each(
    Object.keys(READS).flatMap((name) => [
      [name, { id: 41, version: 3, has_experiment: true }, { id: 41, version: 3, hasExperiment: true }],
      [name, { id: '41', version: '3', has_experiment: 'true' }, {}],
      [name, { id: 41.5, version: 3.5, has_experiment: 1 }, {}],
      [name, { id: true, version: false, has_experiment: null }, {}],
    ])
  )('send the id, version and experiment link of the record (%s read, stored %j)', async (name, stored, sent) => {
    const { client, events, remoteCalls } = setUp({ definitions: definitionsBody([{ ...SPLIT, ...stored }]) })

    await READS[name](client)
    await client.shutdown()

    const [called] = named(events, FLAG_CALLED, 'shelf-order')
    const [exposure] = named(events, EXPOSURE, 'shelf-order')
    const carried = (properties: Record<string, any>): Json =>
      Object.fromEntries(
        [
          ['id', properties.$feature_flag_id],
          ['version', properties.$feature_flag_version],
          ['hasExperiment', properties.$feature_flag_has_experiment],
        ].filter(([, value]) => value !== undefined)
      )
    expect(remoteCalls()).toBe(0)
    expect(carried(called.properties)).toEqual(sent)
    // An exposure carries no experiment link.
    const { hasExperiment: _link, ...exposed } = sent as Json
    expect(carried(exposure.properties)).toEqual(exposed)
  })

  it.each(Object.keys(READS))('name the rule of a targeting match and send no exposure (%s read)', async (name) => {
    const flag = definition('shelf-order', filters([targeted('title')], 'string', 'date'))
    const { client, events } = setUp({ definitions: definitionsBody([flag]) })

    await READS[name](client)
    await client.shutdown()

    const [called] = named(events, FLAG_CALLED, 'shelf-order')
    expect(attribution(called.properties)).toEqual({
      $feature_flag_config_version: 2,
      $feature_flag_reason_code: 'targeting_match',
      $feature_flag_rule_id: RULE,
      $feature_flag_rule_type: 'targeted_release',
    })
    expect(called.properties.locally_evaluated).toBe(true)
    expect(named(events, EXPOSURE, 'shelf-order')).toEqual([])
  })

  it('name the rule of a terminal rollout miss', async () => {
    const flag = definition('reading-mode', filters([rollout(true, 0, 'return_default')]))
    const { client, events } = setUp({ definitions: definitionsBody([flag]) })

    expect(await client.getFeatureFlag('reading-mode', DISTINCT_ID)).toBe(false)
    await client.shutdown()

    const [called] = named(events, FLAG_CALLED, 'reading-mode')
    expect(attribution(called.properties)).toEqual({
      $feature_flag_config_version: 2,
      $feature_flag_reason_code: 'rollout_miss',
      $feature_flag_rule_id: SECOND_RULE,
      $feature_flag_rule_type: 'percentage_rollout',
    })
  })

  it('send each event once over repeated reads', async () => {
    const { client, events } = setUp({ definitions: definitionsBody([SPLIT]) })

    for (const name of ['single', 'snapshot', 'single']) {
      await READS[name](client)
    }
    await client.shutdown()

    expect(named(events, FLAG_CALLED, 'shelf-order')).toHaveLength(1)
    expect(named(events, EXPOSURE, 'shelf-order')).toHaveLength(1)
  })

  it('send no second exposure for a remote read of the same assignment', async () => {
    const targetedSplit = definition(
      'shelf-order',
      filters([experiment([person('plan', 'exact', 'pro')])], 'string', 'title')
    )
    const { client: probe } = setUp({ definitions: definitionsBody([targetedSplit]) })
    const value = await probe.getFeatureFlag('shelf-order', DISTINCT_ID, { personProperties: { plan: 'pro' } })
    const variantKey = value === 'title' ? 'by-title' : 'by-date'
    const remote = remoteResponse({
      'shelf-order': {
        value,
        reason: { code: 'experiment_split', condition_index: 0 },
        metadata: {
          id: 42,
          version: 7,
          config_version: 2,
          has_experiment: true,
          rule_type: 'experiment',
          rule_id: SPLIT_RULE,
          variant_key: variantKey,
        },
      },
    })
    const { client, events, remoteCalls } = setUp({ definitions: definitionsBody([targetedSplit]), remote })

    await client.getFeatureFlag('shelf-order', DISTINCT_ID, { personProperties: { plan: 'pro' } })
    // Without the property the rule is undecided locally, so this read is remote.
    await client.getFeatureFlag('shelf-order', DISTINCT_ID)
    await client.shutdown()

    expect(remoteCalls()).toBe(1)
    expect(named(events, EXPOSURE, 'shelf-order')).toHaveLength(1)
    expect(named(events, FLAG_CALLED, 'shelf-order')).toHaveLength(1)
  })

  it('send neither event when a read opts out of flag events', async () => {
    const { client, events } = setUp({ definitions: definitionsBody([SPLIT]) })

    await client.getFeatureFlag('shelf-order', DISTINCT_ID, { sendFeatureFlagEvents: false })
    ;(await client.evaluateFlags(DISTINCT_ID)).getFlag('shelf-order', { sendFeatureFlagEvents: false })
    await client.shutdown()

    expect(events).toEqual([])
  })

  it('look a payload up for a match value from the evaluated record', async () => {
    const { client, remoteCalls } = setUp({ definitions: definitionsBody([NUMBER, SPLIT]) })

    expect(await client.getFeatureFlagPayload('page-size', DISTINCT_ID, true)).toBe(25)
    expect(await client.getFeatureFlagPayload('shelf-order', DISTINCT_ID, 'title')).toBeNull()
    expect(remoteCalls()).toBe(0)
  })
})

// --- The definition cache ----------------------------------------------------------------------

class MemoryCache {
  stored: Json | undefined
  constructor(
    stored?: Json,
    private readonly fetching = true
  ) {
    this.stored = stored
  }
  getFlagDefinitions(): Json | undefined {
    return this.stored === undefined ? undefined : structuredClone(this.stored)
  }
  shouldFetchFlagDefinitions(): boolean {
    return this.fetching
  }
  onFlagDefinitionsReceived(data: Json): void {
    this.stored = structuredClone(data)
  }
  shutdown(): void {}
}

describe('the definition cache', () => {
  it('keeps config version 2 flags out of `flags`', async () => {
    const cache = new MemoryCache()
    const { client } = setUp({ definitions: FEED.feed, options: { flagDefinitionCacheProvider: cache as any } })

    await client.getFeatureFlag('legacy-banner', DISTINCT_ID)

    const keys = (flags: Json[]): string[] => flags.map((flag) => flag.key)
    const v1Keys = FEED.feed.flags.filter((flag: Json) => v2.isConfigVersion1(flag)).map((flag: Json) => flag.key)
    const otherKeys = FEED.feed.flags.filter((flag: Json) => !v2.isConfigVersion1(flag)).map((flag: Json) => flag.key)
    expect(keys(cache.stored!.flags)).toEqual(v1Keys)
    expect(keys(cache.stored!.flags_v2)).toEqual(otherKeys)
    expect(otherKeys).toContain('future-config-version')
  })

  it('stores the data of version 1 flags as before', async () => {
    const cache = new MemoryCache()
    const flags = [v1Definition('legacy-banner'), v1Definition('legacy-plain', {}, { version: 1 })]
    const { client } = setUp({
      definitions: definitionsBody(flags),
      options: { flagDefinitionCacheProvider: cache as any },
    })

    await client.getFeatureFlag('legacy-banner', DISTINCT_ID)

    expect(cache.stored).toEqual({
      flags,
      group_type_mapping: {},
      groupTypeMapping: {},
      cohorts: {},
      minimal_flag_called_events: false,
      minimalFlagCalledEvents: false,
      property_matching_version: 2,
      propertyMatchingVersion: 2,
    })
  })

  it('evaluates the config version 2 flags it reads from `flags_v2`', async () => {
    const stored = { ...definitionsBody([v1Definition('legacy-banner')]), flags_v2: [BOOLEAN, UNKNOWN_VERSION] }
    const cache = new MemoryCache(stored, false)
    const { client, remoteCalls } = setUp({ options: { flagDefinitionCacheProvider: cache as any } })

    const snapshot = await client.evaluateFlags(DISTINCT_ID, { onlyEvaluateLocally: true })

    expect(snapshot.getFlag('legacy-banner')).toBe(true)
    expect(snapshot.getFlag('reading-mode')).toBe(true)
    expect(snapshot.unresolvedFlags).toEqual({ 'future-format': 'unsupported_definition' })
    expect(remoteCalls()).toBe(0)
  })

  it('has no config version 2 flags in data without `flags_v2`', async () => {
    const cache = new MemoryCache(definitionsBody([v1Definition('legacy-banner')]), false)
    const remote = remoteResponse({ 'reading-mode': { value: 'from-remote', reason: { code: 'targeting_match' } } })
    const { client, remoteCalls } = setUp({ remote, options: { flagDefinitionCacheProvider: cache as any } })

    expect(await client.getFeatureFlag('reading-mode', DISTINCT_ID)).toBe('from-remote')
    expect(remoteCalls()).toBe(1)
  })
})

// --- The corpora through the client ----------------------------------------------------------

type Case = Record<string, any>

function corpusCases(name: string): Case[] {
  const corpus = load(name)
  const defaults = corpus.defaults ?? {}
  return corpus.cases.map((testCase: Case) => ({
    ...testCase,
    flag: testCase.flag ?? defaults.flag,
    context: { ...defaults.context, ...testCase.context },
  }))
}

function localOutcome(expected: Case): Case {
  const [row] = LOCAL_OUTCOMES.rows.filter(
    (candidate: Case) =>
      candidate.status === expected.status && candidate.error === expected.error && candidate.kind === expected.kind
  )
  return row
}

const CASES = [
  'v2_boolean_evaluation.json',
  'v2_value_evaluation.json',
  'v2_experiment_evaluation.json',
  'v2_local_evaluation.json',
].flatMap(corpusCases)
const REPLAYED = CASES.filter((testCase) => localOutcome(testCase.expected).local_evaluation !== 'not_applicable')
// The client reads dates in UTC, so a case set in another timezone is replayed only by the
// evaluator's own tests.
const REPLAYABLE = REPLAYED.filter((testCase) => testCase.context.timezone === 'UTC')

const RULE_REASONS = new Set(['targeting_match', 'experiment_split', 'rollout_miss', 'experiment_paused', 'holdout'])

// A white-box case draws its hash through the SHA-1 digest the client hashes with. A hash that no
// 60-bit digest gives, such as the smallest subnormal number, cannot be drawn this way and is
// replayed only by the evaluator's own tests.
const THROUGH_CLIENT = (): Case[] =>
  REPLAYABLE.filter(
    (testCase) =>
      testCase.white_box === undefined || digestFor(binary64(testCase.white_box.hash01_binary64_hex)) !== undefined
  )

/** The SHA-1 hex digest whose 60-bit hash is exactly `hash01`, or `undefined` if none is. */
function digestFor(hash01: number): string | undefined {
  const scaled = hash01 * 2 ** 60
  if (!Number.isInteger(scaled)) {
    return undefined
  }
  const n = BigInt(scaled) >= BigInt(2) ** BigInt(60) ? BigInt(2) ** BigInt(60) - BigInt(1) : BigInt(scaled)
  const hex = n.toString(16).padStart(15, '0')
  return parseInt(hex, 16) / 2 ** 60 === hash01 ? hex + '0'.repeat(25) : undefined
}

function binary64(hexadecimal: string): number {
  return new DataView(Uint8Array.from(Buffer.from(hexadecimal, 'hex')).buffer).getFloat64(0)
}

/** The hash function of a case: a white-box case replaces every hash. */
function drawFor(testCase: Case): v2.ConfigV2Draw | undefined {
  const replaced: string | undefined = testCase.white_box?.hash01_binary64_hex
  return replaced === undefined ? undefined : () => binary64(replaced)
}

/**
 * Whether the client, which never knows that a property map is complete, can reproduce the case:
 * the evaluator gives the corpus result with a partial map.
 */
async function reachable(testCase: Case): Promise<boolean> {
  const context = testCase.context
  const properties = { distinct_id: context.identifier, ...(context.properties ?? {}) }
  const draw =
    drawFor(testCase) ??
    ((use, seed, subject) => {
      const prefix = use === 'holdout' ? seed : `${seed}.`
      return v2.hash01(prefix, subject, use === 'variant' ? 'variant' : '')
    })
  const outcome = await v2.evaluateConfigV2WithHash(
    v2.parseConfigV2(testCase.config),
    {
      identifier: context.identifier,
      properties,
      propertiesComplete: false,
      explicitExactMatching: context.explicit_exact_matching,
      timeZone: 'UTC',
      now: new Date(context.now),
    },
    draw,
    { active: testCase.flag.active }
  )
  if (outcome.outcome !== 'evaluated') {
    return false
  }
  const expected = testCase.expected
  // A partial rule keeps the fields it has, so it never equals a corpus rule or no rule.
  const fields = { id: outcome.ruleId, rule_type: outcome.ruleType, index: outcome.ruleIndex }
  const rule = Object.values(fields).some((field) => field !== undefined) ? fields : undefined
  return (
    JSON.stringify([outcome.value, outcome.reason, rule, outcome.variantKey]) ===
    JSON.stringify([expected.value, expected.reason, expected.rule, expected.variant])
  )
}

async function replayThroughClient(
  testCase: Case
): Promise<{ value: unknown; payload: unknown; snapshot: any; events: Event[] }> {
  const context = testCase.context
  const key = testCase.flag.key
  const flag = definition(key, testCase.config, { active: testCase.flag.active })
  vi.setSystemTime(new Date(context.now))
  const replaced = testCase.white_box?.hash01_binary64_hex
  if (replaced !== undefined) {
    const digest = digestFor(binary64(replaced))!
    vi.mocked(hashSHA1).mockImplementation(async () => digest)
  }
  const { client, events, remoteCalls } = setUp({
    definitions: definitionsBody([flag], { property_matching_version: context.explicit_exact_matching ? 2 : 1 }),
  })
  const options = { personProperties: context.properties ?? undefined, onlyEvaluateLocally: true }
  const value = await client.getFeatureFlag(key, context.identifier, options)
  const payload = await client.getFeatureFlagPayload(key, context.identifier, undefined, options)
  let snapshot: any
  if (context.identifier) {
    snapshot = await client.evaluateFlags(context.identifier, options)
    snapshot.getFlag(key)
  }
  await client.shutdown()
  expect(remoteCalls()).toBe(0)
  return { value, payload, snapshot, events }
}

describe('the corpora through the client', () => {
  it.each(THROUGH_CLIENT().map((testCase) => [testCase.id, testCase]))('%s', async (_id, testCase) => {
    const key = testCase.flag.key
    const expected = testCase.expected
    const isReachable = expected.status === 'success' && (await reachable(testCase))
    const { value: read, payload: readPayload, snapshot, events } = await replayThroughClient(testCase)

    if (isReachable) {
      const [value, payload] = legacyRendering(expected.value)
      if ('legacy' in testCase) {
        expect([value, payload]).toEqual([testCase.legacy.value, testCase.legacy.payload])
      }
      expect(read).toBe(value)
      expect(readPayload).toEqual(payload)
      if (snapshot !== undefined) {
        expect(snapshot.getFlag(key)).toBe(value)
        expect(snapshot.getFlagPayload(key) ?? null).toEqual(payload)
      }
      const expectedAttribution: Json = {
        $feature_flag_config_version: 2,
        $feature_flag_reason_code: expected.reason,
      }
      if (RULE_REASONS.has(expected.reason)) {
        expectedAttribution.$feature_flag_rule_id = expected.rule.id
        expectedAttribution.$feature_flag_rule_type = expected.rule.rule_type
      }
      if (expected.reason === 'experiment_split') {
        expectedAttribution.$feature_flag_variant_key = expected.variant
      }
      const [called] = named(events, FLAG_CALLED, key)
      expect(called.properties.locally_evaluated).toBe(true)
      expect(attribution(called.properties)).toEqual(expectedAttribution)
      const exposures = named(events, EXPOSURE, key)
      expect(exposures).toHaveLength(expected.reason === 'experiment_split' ? 1 : 0)
      for (const exposure of exposures) {
        expect(exposure.properties.locally_evaluated).toBe(true)
      }
      return
    }

    let reason: string
    if (expected.status === 'success') {
      // A complete property map with a key the read never passed: the client cannot know the key
      // is absent, so the rule is undecided. Or a filter number the client cannot read.
      reason = testCase.id === 'v2_boolean.property.exact_scalar' ? 'unsupported_definition' : 'missing_context'
      if (reason === 'missing_context') {
        expect(testCase.context.properties_complete).toBe(true)
      }
    } else {
      const local = localOutcome(expected)
      expect(local.local_evaluation).toBe('inconclusive')
      reason = local.unresolved_reason
    }
    expect(read).toBeUndefined()
    expect(readPayload).toBeUndefined()
    if (snapshot !== undefined) {
      expect(snapshot.unresolvedFlags).toEqual({ [key]: reason })
    }
  })

  it('replays the cases the client can reach', async () => {
    const succeeding = REPLAYABLE.filter((testCase) => testCase.expected.status === 'success')
    const reached: Case[] = []
    for (const testCase of succeeding) {
      if (await reachable(testCase)) {
        reached.push(testCase)
      }
    }

    // Results through the client; results it cannot reproduce; errors and parse errors; cases in
    // another timezone.
    expect([
      reached.length,
      succeeding.length - reached.length,
      REPLAYABLE.length - succeeding.length,
      REPLAYED.length - REPLAYABLE.length,
    ]).toEqual([209, 9, 36, 8])
    const throughClient = new Set(THROUGH_CLIENT())
    expect(REPLAYABLE.filter((testCase) => !throughClient.has(testCase)).map((testCase) => testCase.id)).toEqual([
      'v2_boolean.threshold.p0_above',
    ])
  })
})
