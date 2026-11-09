import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020'

import { PostHog } from '@/entrypoints/index.node'
import type { PostHogOptions } from '@/types'

// `$experiment_exposure` and the attribution of `$feature_flag_called`. A remotely evaluated config
// version 2 record that assigns an experiment variant sends `$experiment_exposure` next to its
// `$feature_flag_called`, and every config version 2 record adds its rule attribution to
// `$feature_flag_called`. The reader fixtures and event schemas are copied unchanged from a released
// PostHog/posthog-sdk-test-harness contract; `fixtures/feature_flag_rules_v2/SOURCE.json` records which.

const FIXTURES = fileURLToPath(new URL('./fixtures/feature_flag_rules_v2/', import.meta.url))
const load = (name: string): any => JSON.parse(readFileSync(FIXTURES + name, 'utf8'))

const READERS = load('readers.json')

const FLAG = 'pricing-page'
const DISTINCT_ID = 'visitor-42'
const RULE = '7f3c2a10-8d4e-4b6a-9c21-5e0f1a2b3c4d'
const OTHER_RULE = '2b9d4e61-0c7a-4f35-8e12-6a4b3c2d1e0f'
const REQUEST_ID = '5d1e2f30-4a5b-4c6d-8e7f-90a1b2c3d4e5'
const OTHER_REQUEST_ID = '6e2f3a41-5b6c-4d7e-9f80-a1b2c3d4e5f6'
const EVALUATED_AT = 1_800_000_000_000

const EXPOSURE = '$experiment_exposure'
const FLAG_CALLED = '$feature_flag_called'
const ATTRIBUTION_PROPERTIES = [
  '$feature_flag_config_version',
  '$feature_flag_reason_code',
  '$feature_flag_rule_id',
  '$feature_flag_rule_type',
  '$feature_flag_variant',
]

// `$experiment_exposure` leaves these out. The config version, rule type and reason code stay on
// the `$feature_flag_called` of the same read. The schema projection drops undeclared properties,
// so their absence is asserted separately.
const EXPOSURE_LEAVES_OUT = [
  '$feature_flag_config_version',
  '$feature_flag_rule_type',
  '$feature_flag_reason_code',
  '$experiment_exposure_source',
]

// The contract's closed event schemas, applied to the properties each one declares.
const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

function contractSchema(name: string): (properties: Record<string, any>) => void {
  const schema = load(name)
  const validate = ajv.compile(schema)
  const declared = new Set(Object.keys(schema.properties))
  return (properties) => {
    const projection = Object.fromEntries(
      Object.entries(properties).filter(([key, value]) => declared.has(key) && value !== undefined)
    )
    if (!validate(projection)) {
      throw new Error(`${name} rejects ${JSON.stringify(projection)}: ${ajv.errorsText(validate.errors)}`)
    }
  }
}

const checkFlagCalled = contractSchema('feature_flag_called_context.schema.json')
const checkExposure = contractSchema('experiment_exposure_properties.schema.json')

// --- Responses ------------------------------------------------------------------------------

type RecordOptions = {
  key?: string
  ruleType?: string
  ruleId?: string
  variantKey?: string
  configVersion?: number
  hasExperiment?: boolean
  description?: string
  failed?: boolean
}

function v4Record(code: string, value: unknown = true, options: RecordOptions = {}): Record<string, any> {
  const metadata: Record<string, any> = {
    id: 77,
    version: 3,
    config_version: options.configVersion ?? 2,
    description: null,
    payload: null,
    has_experiment: options.hasExperiment ?? false,
  }
  if (options.ruleType !== undefined) {
    metadata.rule_type = options.ruleType
  }
  if (options.ruleId !== undefined) {
    metadata.rule_id = options.ruleId
  }
  if (options.variantKey !== undefined) {
    metadata.variant_key = options.variantKey
  }
  const reason: Record<string, any> = { code, condition_index: options.ruleId ? 0 : null }
  if (options.description !== undefined) {
    reason.description = options.description
  }
  const record: Record<string, any> = { key: options.key ?? FLAG, value, reason, metadata }
  if (options.failed) {
    record.failed = true
  }
  return record
}

function split(options: RecordOptions & { value?: unknown } = {}): Record<string, any> {
  const { value, ...rest } = options
  return v4Record('experiment_split', 'value' in options ? value : 'annual', {
    ruleType: 'experiment',
    ruleId: RULE,
    variantKey: 'annual-first',
    hasExperiment: true,
    ...rest,
  })
}

function response(records: Record<string, any>[], envelope: Record<string, unknown> = {}): Record<string, any> {
  return {
    flags: Object.fromEntries(records.map((record) => [record.key, record])),
    errorsWhileComputingFlags: false,
    requestId: REQUEST_ID,
    evaluatedAt: EVALUATED_AT,
    ...envelope,
  }
}

const pointer = (path: string): string[] =>
  path
    .split('/')
    .slice(1)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))

/** Applies a fixture case: copy its template, remove members, then set members. */
function build(fixture: any, testCase: any): any {
  const document = structuredClone(fixture.templates[testCase.template])
  for (const path of testCase.remove ?? []) {
    const tokens = pointer(path)
    const parent = tokens.slice(0, -1).reduce((target, token) => target[token], document)
    delete parent[tokens[tokens.length - 1]]
  }
  for (const [path, value] of Object.entries(testCase.set ?? {})) {
    const tokens = pointer(path)
    const parent = tokens.slice(0, -1).reduce((target, token) => target[token], document)
    parent[tokens[tokens.length - 1]] = structuredClone(value)
  }
  return document
}

const readerResponse = (source: string): any =>
  source.startsWith('readers.')
    ? build(
        READERS,
        READERS.cases.find((testCase: any) => testCase.id === source)
      )
    : build(READERS, { template: source })

// --- Clients and recorded events -----------------------------------------------------------

type Event = { event: string; distinct_id: unknown; properties: Record<string, any>; uuid: string }

/**
 * A client whose `/flags` answers with each response in turn, and the last one after that, plus
 * the events it queues.
 */
function createClient(
  responses: unknown[],
  options: Partial<PostHogOptions> = {},
  definitions?: unknown
): { client: PostHog; events: Event[]; fetch: ReturnType<typeof vi.fn> } {
  const remaining = [...responses]
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/flags/?')) {
      const next = remaining.length > 1 ? remaining.shift() : remaining[0]
      return { status: 200, text: async () => JSON.stringify(next), json: async () => structuredClone(next) }
    }
    if (url.includes('/flags/definitions')) {
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(definitions),
        json: async () => structuredClone(definitions),
      }
    }
    return { status: 200, text: async () => 'ok', json: async () => ({ status: 'ok' }) }
  })
  const client = new PostHog('TEST_API_KEY', {
    host: 'http://example.com',
    fetch: fetch as any,
    fetchRetryCount: 0,
    flushAt: 1000,
    ...options,
  })
  const events: Event[] = []
  client.on('capture', (message) => {
    // An opted-out client emits a notice string instead of an event.
    if (message && typeof message === 'object') {
      events.push(structuredClone(message))
    }
  })
  return { client, events, fetch }
}

/** Waits until every capture the client started has been queued or has failed. */
const settle = (client: PostHog): Promise<void> => (client as any).promiseQueue.join()

type Read = (
  client: PostHog,
  key: string,
  distinctId: string,
  groups: Record<string, string> | undefined
) => Promise<unknown>

// Every read that sends flag events.
const READS: Record<string, Read> = {
  getFeatureFlag: (client, key, distinctId, groups) => client.getFeatureFlag(key, distinctId, { groups }),
  isFeatureEnabled: (client, key, distinctId, groups) => client.isFeatureEnabled(key, distinctId, { groups }),
  getFeatureFlagResult: (client, key, distinctId, groups) => client.getFeatureFlagResult(key, distinctId, { groups }),
  'snapshot.getFlag': async (client, key, distinctId, groups) =>
    (await client.evaluateFlags(distinctId, { groups })).getFlag(key),
  'snapshot.isEnabled': async (client, key, distinctId, groups) =>
    (await client.evaluateFlags(distinctId, { groups })).isEnabled(key),
}
const PATHS = Object.keys(READS)
const SINGLE_FLAG_PATHS = ['getFeatureFlag', 'isFeatureEnabled', 'getFeatureFlagResult']
const SNAPSHOT_PATHS = ['snapshot.getFlag', 'snapshot.isEnabled']
const TWO_PATHS = ['getFeatureFlagResult', 'snapshot.getFlag']
// Two reads that return the flag's value.
const VALUE_PATHS = ['getFeatureFlag', 'snapshot.getFlag']

function read(
  client: PostHog,
  path: string,
  options: { key?: string; distinctId?: string; groups?: Record<string, string> } = {}
): Promise<unknown> {
  return READS[path](client, options.key ?? FLAG, options.distinctId ?? DISTINCT_ID, options.groups)
}

/** Reads `FLAG` `reads` times through `path`, one response per read, on a new client. */
async function readEvents(
  path: string,
  responses: unknown[],
  options: { reads?: number; key?: string; groups?: Record<string, string>; client?: Partial<PostHogOptions> } = {}
): Promise<Event[]> {
  const { client, events } = createClient(responses, options.client)
  for (let i = 0; i < (options.reads ?? 1); i++) {
    await read(client, path, options)
  }
  await client.shutdown()
  return events
}

const named = (events: Event[], name: string, key: string = FLAG): Event[] =>
  events.filter((event) => event.event === name && event.properties.$feature_flag === key)

const attribution = (properties: Record<string, any>): Record<string, any> =>
  Object.fromEntries(
    ATTRIBUTION_PROPERTIES.filter((name) => properties[name] !== undefined).map((name) => [name, properties[name]])
  )

// The properties every queued event gets from the capture pipeline.
function withoutTransport(properties: Record<string, any>): Record<string, any> {
  const {
    $lib: _lib,
    $lib_version: _version,
    $is_server: _server,
    $groups: _groups,
    $geoip_disable: _geoip,
    ...rest
  } = properties
  return rest
}

/** A `before_send` hook that records each event it sees and keeps it. */
function recordingBeforeSend(): { seen: any[]; before_send: (event: any) => any } {
  const seen: any[] = []
  return {
    seen,
    before_send: (event) => {
      seen.push(structuredClone(event))
      return event
    },
  }
}

// The attribution of a split's `$feature_flag_called`.
const EXPECTED_ATTRIBUTION = {
  $feature_flag_config_version: 2,
  $feature_flag_reason_code: 'experiment_split',
  $feature_flag_rule_id: RULE,
  $feature_flag_rule_type: 'experiment',
  $feature_flag_variant: 'annual-first',
}

const EXPECTED_EXPOSURE = {
  $feature_flag: FLAG,
  $feature_flag_response: 'annual',
  $feature_flag_variant: 'annual-first',
  $feature_flag_rule_id: RULE,
  locally_evaluated: false,
  $feature_flag_id: 77,
  $feature_flag_version: 3,
  $feature_flag_request_id: REQUEST_ID,
  $feature_flag_evaluated_at: EVALUATED_AT,
}

describe('$experiment_exposure', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('the contract reader cases', () => {
    const rows = READERS.cases
      .filter((testCase: any) => testCase.expected === 'reader')
      .flatMap((testCase: any) => PATHS.map((path) => [testCase.id, path, testCase]))

    it.each(rows)('%s through %s sends an exposure exactly when the contract expects', async (_id, path, testCase) => {
      const { client, events } = createClient([build(READERS, testCase)])
      const keys = [testCase.reader.requested_key, ...Object.keys(testCase.sibling_expectations ?? {})]
      for (const key of keys) {
        await read(client, path, { key })
      }
      await client.shutdown()

      const expectations = { [testCase.reader.requested_key]: testCase.reader, ...testCase.sibling_expectations }
      for (const [key, expected] of Object.entries<any>(expectations)) {
        const exposures = named(events, EXPOSURE, key)
        expect(exposures).toHaveLength(expected.experiment_exposure ? 1 : 0)
        const calls = named(events, FLAG_CALLED, key)
        expect(calls).toHaveLength(1)
        const [called] = calls
        const configVersion = expected.error_code === 'PARSE_ERROR' ? null : expected.config_version
        expect(called.properties.$feature_flag_config_version).toBe(configVersion === 2 ? 2 : undefined)
        if (called.properties.$feature_flag_response !== undefined) {
          checkFlagCalled(called.properties)
        }
        for (const exposure of exposures) {
          checkExposure(exposure.properties)
          for (const name of EXPOSURE_LEAVES_OUT) {
            expect(exposure.properties).not.toHaveProperty(name)
          }
          expect(exposure.properties.$feature_flag_response).toEqual(called.properties.$feature_flag_response)
          expect(exposure.uuid).toBeTruthy()
          expect(exposure.uuid).not.toBe(called.uuid)
        }
        for (const event of [called, ...exposures]) {
          // A flag may be named anything, so `$feature/<key>` is left out.
          for (const name of Object.keys(event.properties).filter((name) => !name.startsWith('$feature/'))) {
            for (const part of ['experiment_id', 'holdout', 'seed']) {
              expect(name).not.toContain(part)
            }
          }
        }
      }
    })
  })

  describe('attribution on $feature_flag_called', () => {
    const RULE_ID = '10000000-0000-4000-8000-000000000001'
    const ATTRIBUTION_CASES: [string, Record<string, unknown>][] = [
      [
        'experiment_split',
        {
          $feature_flag_config_version: 2,
          $feature_flag_reason_code: 'experiment_split',
          $feature_flag_rule_id: RULE_ID,
          $feature_flag_rule_type: 'experiment',
          $feature_flag_variant: 'arm_a',
        },
      ],
      ...(
        [
          ['targeting_match_targeted_release', 'targeting_match', 'targeted_release'],
          ['targeting_match_percentage_rollout', 'targeting_match', 'percentage_rollout'],
          ['rollout_miss_percentage_rollout', 'rollout_miss', 'percentage_rollout'],
          ['rollout_miss_experiment', 'rollout_miss', 'experiment'],
          ['experiment_paused', 'experiment_paused', 'experiment'],
          ['holdout', 'holdout', 'experiment'],
          // A holdout assigns no variant, even when its record names one.
          ['readers.holdout_variant_key', 'holdout', 'experiment'],
        ] as const
      ).map(([source, code, ruleType]): [string, Record<string, unknown>] => [
        source,
        {
          $feature_flag_config_version: 2,
          $feature_flag_reason_code: code,
          $feature_flag_rule_id: RULE_ID,
          $feature_flag_rule_type: ruleType,
        },
      ]),
      ...['no_rule_match', 'missing_group_key', 'dependency_error', 'error'].map(
        (code): [string, Record<string, unknown>] => [
          code,
          { $feature_flag_config_version: 2, $feature_flag_reason_code: code },
        ]
      ),
      // A malformed split keeps its config version and reason, and loses the whole rule tuple.
      ...[
        'readers.partial_split_missing_rule_type',
        'readers.partial_split_missing_rule_id',
        'readers.partial_split_missing_variant_key',
        'readers.wrong_rule_type_literal',
        'readers.partial_split_string_value',
      ].map((source): [string, Record<string, unknown>] => [
        source,
        { $feature_flag_config_version: 2, $feature_flag_reason_code: 'experiment_split' },
      ]),
      // Config version 1, from either kind of server, is unchanged.
      ['v1', {}],
      ['old_server', {}],
      ['readers.partial_split_missing_config_version', {}],
    ]

    it.each(ATTRIBUTION_CASES.flatMap(([source, expected]) => TWO_PATHS.map((path) => [source, path, expected])))(
      '%s through %s',
      async (source, path, expected) => {
        const events = await readEvents(path as string, [readerResponse(source as string)], { key: 'garden-layout' })

        const [called] = named(events, FLAG_CALLED, 'garden-layout')
        expect(attribution(called.properties)).toEqual(expected)
        checkFlagCalled(called.properties)
        expect(named(events, EXPOSURE, 'garden-layout')).toHaveLength(
          '$feature_flag_variant' in (expected as object) ? 1 : 0
        )
      }
    )

    // A record whose reason names no rule, or that failed, reports no rule even when it carries one.
    // The last element says whether the record is a valid server outcome, which the contract's event
    // schema then accepts.
    const STRAY_RULE_CASES: [string, Record<string, unknown>, boolean][] = [
      ['no_rule_match', {}, true],
      ['missing_group_key', {}, true],
      ['flag_disabled', {}, true],
      ['dependency_error', { failed: true, value: null }, true],
      ['error', { failed: true, value: null }, true],
      // A failed record reports no rule, whatever its reason code.
      ['experiment_split', { failed: true, value: null, variantKey: 'annual-first' }, true],
      ['holdout', { failed: true, value: null }, false],
      // A reason code this SDK does not know.
      ['future_reason', {}, false],
    ]

    it.each(STRAY_RULE_CASES.flatMap((row) => TWO_PATHS.map((path) => [...row, path])))(
      'a %s record %j reports no rule (valid outcome: %s, %s)',
      async (code, fields, validOutcome, path) => {
        const { value, ...options } = { value: false, ...(fields as Record<string, any>) }
        const record = v4Record(code as string, value, {
          ruleType: 'experiment',
          ruleId: RULE,
          hasExperiment: true,
          ...options,
        })

        const events = await readEvents(path as string, [response([record])])

        const [called] = named(events, FLAG_CALLED)
        expect(attribution(called.properties)).toEqual({
          $feature_flag_config_version: 2,
          $feature_flag_reason_code: code,
        })
        expect(named(events, EXPOSURE)).toEqual([])
        if (validOutcome) {
          checkFlagCalled(called.properties)
        }
      }
    )

    it.each(
      [
        ['targeting_match', 'targeted_release'],
        ['targeting_match', 'percentage_rollout'],
        ['rollout_miss', 'percentage_rollout'],
        ['rollout_miss', 'experiment'],
        ['experiment_paused', 'experiment'],
        ['holdout', 'experiment'],
      ].flatMap((row) => TWO_PATHS.map((path) => [...row, path]))
    )('a %s of a %s rule names its rule (%s)', async (code, ruleType, path) => {
      const events = await readEvents(path, [response([v4Record(code, false, { ruleType, ruleId: RULE })])])

      const [called] = named(events, FLAG_CALLED)
      expect(attribution(called.properties)).toEqual({
        $feature_flag_config_version: 2,
        $feature_flag_reason_code: code,
        $feature_flag_rule_id: RULE,
        $feature_flag_rule_type: ruleType,
      })
      expect(named(events, EXPOSURE)).toEqual([])
      checkFlagCalled(called.properties)
    })

    // The rule ID and rule type are sent together, with a rule type the reason allows, or not at
    // all. A call that drops a broken pair keeps its config version and reason code.
    const BROKEN_RULE_PAIRS: [string, RecordOptions][] = [
      // Half pairs.
      ['targeting_match', { ruleId: RULE }],
      ['rollout_miss', { ruleId: RULE }],
      ['experiment_paused', { ruleId: RULE }],
      ['holdout', { ruleId: RULE }],
      ['targeting_match', { ruleType: 'targeted_release' }],
      ['rollout_miss', { ruleType: 'percentage_rollout' }],
      ['experiment_paused', { ruleType: 'experiment' }],
      ['holdout', { ruleType: 'experiment' }],
      // Rule types the reason code does not allow.
      ['targeting_match', { ruleId: RULE, ruleType: 'experiment' }],
      ['rollout_miss', { ruleId: RULE, ruleType: 'targeted_release' }],
      ['experiment_paused', { ruleId: RULE, ruleType: 'percentage_rollout' }],
      ['holdout', { ruleId: RULE, ruleType: 'targeted_release' }],
      // A rule type this SDK does not know.
      ['targeting_match', { ruleId: RULE, ruleType: 'future_rule_type' }],
    ]

    it.each(BROKEN_RULE_PAIRS.flatMap((row) => TWO_PATHS.map((path) => [...row, path])))(
      'a %s with the rule fields %j sends neither (%s)',
      async (code, fields, path) => {
        const events = await readEvents(path as string, [response([v4Record(code as string, false, fields as any)])])

        const [called] = named(events, FLAG_CALLED)
        expect(attribution(called.properties)).toEqual({
          $feature_flag_config_version: 2,
          $feature_flag_reason_code: code,
        })
        expect(named(events, EXPOSURE)).toEqual([])
        checkFlagCalled(called.properties)
      }
    )

    it.each(PATHS)('a targeting match that names an experiment rule sends no exposure (%s)', async (path) => {
      // Even with a variant key and a linked experiment, a targeting match assigns no variant.
      const record = v4Record('targeting_match', 'annual', {
        ruleType: 'experiment',
        ruleId: RULE,
        variantKey: 'annual-first',
        hasExperiment: true,
      })

      const events = await readEvents(path, [response([record])])

      const [called] = named(events, FLAG_CALLED)
      expect(attribution(called.properties)).toEqual({
        $feature_flag_config_version: 2,
        $feature_flag_reason_code: 'targeting_match',
      })
      expect(named(events, EXPOSURE)).toEqual([])
      checkFlagCalled(called.properties)
    })

    it.each(PATHS)('a record from a server without typed values reports no attribution (%s)', async (path) => {
      // Its metadata is not read as config version 2, whatever it says.
      const record = {
        key: FLAG,
        enabled: true,
        variant: 'annual',
        reason: { code: 'condition_match', condition_index: 0 },
        metadata: {
          id: 77,
          version: 3,
          config_version: 2,
          rule_type: 'experiment',
          rule_id: RULE,
          variant_key: 'annual-first',
        },
      }

      const events = await readEvents(path, [response([record])])

      const [called] = named(events, FLAG_CALLED)
      expect(attribution(called.properties)).toEqual({})
      expect(named(events, EXPOSURE)).toEqual([])
    })

    it.each(TWO_PATHS.flatMap((path) => [['future_reason', path] as const, [undefined, path] as const]))(
      'a reason code of %s still reports config version 2 (%s)',
      async (code, path) => {
        const record = split()
        if (code === undefined) {
          delete record.reason
        } else {
          record.reason.code = code
        }

        const events = await readEvents(path, [response([record])])

        const [called] = named(events, FLAG_CALLED)
        expect(attribution(called.properties)).toEqual(
          code === undefined
            ? { $feature_flag_config_version: 2 }
            : { $feature_flag_config_version: 2, $feature_flag_reason_code: code }
        )
        expect(called.properties).not.toHaveProperty('$feature_flag_reason')
        expect(named(events, EXPOSURE)).toEqual([])
        checkFlagCalled(called.properties)
      }
    )

    const NOT_A_UUID = ['rule-1', '', '7F3C2A108D4E4B6A9C215E0F1A2B3C4D', `{${RULE}}`]

    it.each(NOT_A_UUID.flatMap((ruleId) => TWO_PATHS.map((path) => [ruleId, path])))(
      'a rule ID of %j counts as missing (%s)',
      async (ruleId, path) => {
        for (const record of [
          split({ ruleId }),
          v4Record('targeting_match', true, { ruleType: 'targeted_release', ruleId }),
        ]) {
          const events = await readEvents(path, [response([record])])

          const [called] = named(events, FLAG_CALLED)
          expect(attribution(called.properties)).toEqual({
            $feature_flag_config_version: 2,
            $feature_flag_reason_code: record.reason.code,
          })
          expect(named(events, EXPOSURE)).toEqual([])
          checkFlagCalled(called.properties)
        }
      }
    )

    it('keeps an upper-case UUID rule ID', async () => {
      const events = await readEvents('getFeatureFlagResult', [response([split({ ruleId: RULE.toUpperCase() })])])

      const [exposure] = named(events, EXPOSURE)
      expect(exposure.properties.$feature_flag_rule_id).toBe(RULE.toUpperCase())
    })

    it.each(PATHS)('an empty variant key is a complete split (%s)', async (path) => {
      const events = await readEvents(path, [response([split({ variantKey: '' })])])

      const [called] = named(events, FLAG_CALLED)
      expect(called.properties.$feature_flag_variant).toBe('')
      const [exposure] = named(events, EXPOSURE)
      expect(exposure.properties.$feature_flag_variant).toBe('')
      checkExposure(exposure.properties)
    })

    it.each(PATHS)('an experiment ID in the record is not sent (%s)', async (path) => {
      const record = split()
      record.metadata.experiment_id = 301

      const events = await readEvents(path, [response([record])])

      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
      for (const event of events) {
        expect(event.properties).not.toHaveProperty('$feature_flag_experiment_id')
      }
    })
  })

  describe('$feature_flag_reason', () => {
    const DESCRIPTION = 'Matched rule 1'

    it.each(
      [
        [
          'targeting_match',
          v4Record('targeting_match', true, { ruleType: 'targeted_release', ruleId: RULE, description: DESCRIPTION }),
        ],
        ['no_rule_match', v4Record('no_rule_match', false, { description: DESCRIPTION })],
        ['failed', v4Record('error', null, { failed: true, description: DESCRIPTION })],
        ['experiment_split', split({ description: DESCRIPTION })],
      ].flatMap(([name, record]) => PATHS.map((path) => [name, path, record]))
    )('a config version 2 call (%s) reports its reason by code only (%s)', async (_name, path, record) => {
      const events = await readEvents(path as string, [response([record as any])])

      const [called] = named(events, FLAG_CALLED)
      expect(called.properties.$feature_flag_reason_code).toBe((record as any).reason.code)
      expect(called.properties).not.toHaveProperty('$feature_flag_reason')
    })

    it.each(
      [
        ['config version 1', v4Record('condition_match', 'annual', { configVersion: 1, description: DESCRIPTION })],
        [
          'an older server',
          {
            key: FLAG,
            enabled: true,
            variant: 'annual',
            reason: { code: 'condition_match', condition_index: 0, description: DESCRIPTION },
            metadata: { id: 77, version: 3 },
          },
        ],
      ].flatMap(([name, record]) => PATHS.map((path) => [name, path, record]))
    )('a call from %s keeps its reason description (%s)', async (_name, path, record) => {
      const events = await readEvents(path as string, [response([record as any])])

      const [called] = named(events, FLAG_CALLED)
      expect(called.properties.$feature_flag_reason).toBe(DESCRIPTION)
      expect(attribution(called.properties)).toEqual({})
    })
  })

  describe('minimal events', () => {
    it.each([
      [1, 'condition_match', 'Matched rule 1'],
      [2, 'targeting_match', undefined],
    ])(
      'a minimized config version %s call keeps the reason description only without config version 2',
      async (configVersion, code, reason) => {
        const record = v4Record(code as string, true, {
          configVersion: configVersion as number,
          description: 'Matched rule 1',
        })
        const { client, events } = createClient([response([record], { minimalFlagCalledEvents: true })])

        ;(await client.evaluateFlags(DISTINCT_ID)).getFlag(FLAG)
        await client.getFeatureFlagResult(FLAG, 'visitor-43')
        await client.shutdown()

        expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, FLAG_CALLED])
        for (const event of events) {
          expect(event.properties.$feature_flag_reason).toBe(reason)
          // Minimized: the full event would carry `$feature/<key>`.
          expect(event.properties).not.toHaveProperty(`$feature/${FLAG}`)
        }
      }
    )

    it('a minimized config version 2 call keeps its attribution and its exposure stays full', async () => {
      // A split of an experiment rule no experiment links to: the flag reports no experiment, so its
      // $feature_flag_called is minimal.
      const { client, events } = createClient([
        response([split({ hasExperiment: false })], { minimalFlagCalledEvents: true }),
      ])
      await client.register({ plan: 'team' })

      ;(await client.evaluateFlags(DISTINCT_ID)).getFlag(FLAG)
      await client.shutdown()

      const [called, exposure] = events
      expect(called.event).toBe(FLAG_CALLED)
      expect(called.properties).not.toHaveProperty('plan')
      expect(called.properties).not.toHaveProperty(`$feature/${FLAG}`)
      expect(attribution(called.properties)).toEqual(EXPECTED_ATTRIBUTION)
      // The exposure is never minimized.
      expect(exposure.event).toBe(EXPOSURE)
      expect(exposure.properties.plan).toBe('team')
      expect(attribution(exposure.properties)).toEqual(attribution(EXPECTED_EXPOSURE))
    })

    it('a minimized config version 1 call drops super properties named like the attribution', async () => {
      const record = v4Record('condition_match', true, { configVersion: 1 })
      const { client, events } = createClient([response([record], { minimalFlagCalledEvents: true })])
      await client.register(Object.fromEntries(ATTRIBUTION_PROPERTIES.map((name) => [name, 'set-by-the-app'])))

      await client.getFeatureFlagResult(FLAG, DISTINCT_ID)
      await client.shutdown()

      const [called] = events
      expect(called.properties).not.toHaveProperty(`$feature/${FLAG}`)
      expect(attribution(called.properties)).toEqual({})
    })
  })

  describe('the events of a split', () => {
    it.each(PATHS)('a split sends both events with exact properties (%s)', async (path) => {
      const record = split({ description: "Assigned variant 'annual-first'" })

      const events = await readEvents(path, [response([record])], { groups: { company: 'company-7' } })

      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
      const [called, exposure] = events
      expect(withoutTransport(called.properties)).toEqual({
        $feature_flag: FLAG,
        $feature_flag_response: 'annual',
        locally_evaluated: false,
        [`$feature/${FLAG}`]: 'annual',
        $feature_flag_request_id: REQUEST_ID,
        $feature_flag_evaluated_at: EVALUATED_AT,
        // The reason code replaces the record's reason description.
        $feature_flag_version: 3,
        $feature_flag_id: 77,
        $feature_flag_has_experiment: true,
        ...EXPECTED_ATTRIBUTION,
      })
      expect(withoutTransport(exposure.properties)).toEqual(EXPECTED_EXPOSURE)
      expect(exposure.distinct_id).toBe(DISTINCT_ID)
      expect(called.distinct_id).toBe(DISTINCT_ID)
      expect(exposure.properties.$groups).toEqual({ company: 'company-7' })
      expect(called.properties.$groups).toEqual({ company: 'company-7' })
    })

    it('the two events share their capture identity but not their UUID', async () => {
      const { client, events } = createClient([response([split()])])

      const snapshot = await client.evaluateFlags(DISTINCT_ID, { groups: { company: 'company-7' }, disableGeoip: true })
      expect(snapshot.getFlag(FLAG)).toBe('annual')
      await client.shutdown()

      const [called, exposure] = events
      expect([called.event, exposure.event]).toEqual([FLAG_CALLED, EXPOSURE])
      expect(called.uuid).toBeTruthy()
      expect(exposure.uuid).toBeTruthy()
      expect(exposure.uuid).not.toBe(called.uuid)
      expect(exposure.distinct_id).toBe(DISTINCT_ID)
      expect(called.distinct_id).toBe(DISTINCT_ID)
      for (const name of ['$groups', '$lib', '$lib_version', '$is_server', '$geoip_disable']) {
        expect(exposure.properties[name]).toEqual(called.properties[name])
      }
      expect(exposure.properties.$groups).toEqual({ company: 'company-7' })
      expect(exposure.properties.$geoip_disable).toBe(true)
    })

    it.each(PATHS)('a variant whose value is false is still reported (%s)', async (path) => {
      const events = await readEvents(path, [response([split({ value: false, variantKey: 'no-banner' })])])

      const [exposure] = named(events, EXPOSURE)
      expect(exposure.properties.$feature_flag_response).toBe(false)
      expect(exposure.properties.$feature_flag_variant).toBe('no-banner')
    })

    it.each([
      ['a number', 25],
      ['an object', { layout: 'grid' }],
    ])('a variant with %s value is reported with the legacy rendering', async (_name, value) => {
      const events = await readEvents('snapshot.getFlag', [response([split({ value, variantKey: 'boosted' })])])

      const [called] = named(events, FLAG_CALLED)
      const [exposure] = named(events, EXPOSURE)
      expect(called.properties.$feature_flag_response).toBe(true)
      expect(exposure.properties.$feature_flag_response).toBe(true)
      expect(exposure.properties.$feature_flag_variant).toBe('boosted')
    })

    it('does not depend on a linked experiment', async () => {
      const events = await readEvents('getFeatureFlag', [response([split({ hasExperiment: false })])])

      expect(named(events, EXPOSURE)).toHaveLength(1)
    })
  })

  describe('what sends no exposure', () => {
    it.each(SINGLE_FLAG_PATHS)('a per-call opt-out suppresses both events and reserves nothing (%s)', async (path) => {
      const { client, events } = createClient([response([split()])])

      await (client as any)[path](FLAG, DISTINCT_ID, { sendFeatureFlagEvents: false })
      expect(events).toEqual([])
      await read(client, path)
      await client.shutdown()

      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
    })

    it.each(SNAPSHOT_PATHS)('a per-read opt-out suppresses both events and reserves nothing (%s)', async (path) => {
      const { client, events } = createClient([response([split()])])
      const method = path === 'snapshot.getFlag' ? 'getFlag' : 'isEnabled'

      const snapshot = await client.evaluateFlags(DISTINCT_ID)
      snapshot[method](FLAG, { sendFeatureFlagEvents: false })
      await settle(client)
      expect(events).toEqual([])
      snapshot[method](FLAG)
      await client.shutdown()

      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
    })

    it.each(PATHS)('a client-level opt-out suppresses both events (%s)', async (path) => {
      const events = await readEvents(path, [response([split()])], { client: { sendFeatureFlagEvent: false } })

      expect(events).toEqual([])
    })

    it('a payload read sends no flag events, even when asked to', async () => {
      const { client, events } = createClient([response([split()])])

      await client.getFeatureFlagPayload(FLAG, DISTINCT_ID)
      await client.getFeatureFlagPayload(FLAG, DISTINCT_ID, undefined, { sendFeatureFlagEvents: true })
      await client.getFeatureFlagPayload(FLAG, DISTINCT_ID, 'annual', { sendFeatureFlagEvents: true })
      ;(await client.evaluateFlags(DISTINCT_ID)).getFlagPayload(FLAG)
      await settle(client)
      expect(events).toEqual([])

      // Nothing was reserved, so a value read sends both events.
      await client.getFeatureFlag(FLAG, DISTINCT_ID)
      await client.shutdown()
      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
    })

    it.each(PATHS)('a locally evaluated flag is unchanged (%s)', async (path) => {
      const definitions = {
        flags: [
          {
            id: 9,
            name: 'Pricing page',
            key: FLAG,
            active: true,
            filters: {
              groups: [{ properties: [], rollout_percentage: 100 }],
              multivariate: { variants: [{ key: 'annual', rollout_percentage: 100 }] },
            },
          },
        ],
        group_type_mapping: {},
        cohorts: {},
      }
      const { client, events, fetch } = createClient([response([split()])], { personalApiKey: 'phx_test' }, definitions)

      await read(client, path)
      await client.shutdown()

      expect(fetch.mock.calls.filter(([url]) => String(url).includes('/flags/?'))).toEqual([])
      const [called] = events
      expect(events).toHaveLength(1)
      expect(called.event).toBe(FLAG_CALLED)
      expect(called.properties.locally_evaluated).toBe(true)
      expect(attribution(called.properties)).toEqual({})
    })

    it.each(PATHS)('a value override sends no exposure (%s)', async (path) => {
      const { client, events } = createClient([response([split()])])
      client.overrideFeatureFlags({ flags: { [FLAG]: 'annual' } })

      expect(await read(client, path)).toBeTruthy()
      await client.shutdown()

      expect(named(events, EXPOSURE)).toEqual([])
      for (const called of named(events, FLAG_CALLED)) {
        expect(attribution(called.properties)).toEqual({})
      }
    })

    it('a payload override keeps the exposure of the value the record supplied', async () => {
      const { client, events } = createClient([response([split()])])
      client.overrideFeatureFlags({ payloads: { [FLAG]: { plan: 'annual' } } })

      await read(client, 'snapshot.getFlag')
      await read(client, 'getFeatureFlag', { distinctId: 'visitor-43' })
      await client.shutdown()

      expect(named(events, EXPOSURE)).toHaveLength(2)
    })

    it('an empty snapshot sends nothing', async () => {
      const { client, events } = createClient([response([split()])])

      const snapshot = await client.evaluateFlags()
      snapshot.getFlag(FLAG)
      snapshot.isEnabled(FLAG)
      await client.shutdown()

      expect(events).toEqual([])
    })
  })

  describe('dedupe', () => {
    it.each([
      ['getFeatureFlag', 'getFeatureFlag'],
      ['snapshot.getFlag', 'snapshot.isEnabled'],
      ['isFeatureEnabled', 'snapshot.getFlag'],
      ['snapshot.getFlag', 'getFeatureFlagResult'],
    ])('a repeated read sends nothing new (%s, then %s)', async (first, second) => {
      // The second evaluation has a new request ID and time, which neither event's dedupe reads.
      const later = response([split()], { requestId: OTHER_REQUEST_ID, evaluatedAt: EVALUATED_AT + 1 })
      const { client, events } = createClient([response([split()]), later])

      await read(client, first)
      await read(client, second)
      await client.shutdown()

      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
    })

    it.each(PATHS)('equal-valued variants are each reported (%s)', async (path) => {
      // An A/A experiment: both variants return the same value.
      const events = await readEvents(
        path,
        [
          response([split({ value: true, variantKey: 'control' })]),
          response([split({ value: true, variantKey: 'test' })]),
        ],
        { reads: 2 }
      )

      expect(named(events, EXPOSURE).map((event) => event.properties.$feature_flag_variant)).toEqual([
        'control',
        'test',
      ])
      expect(named(events, FLAG_CALLED)).toHaveLength(2)
    })

    it.each(PATHS)('a later experiment on the flag is reported again (%s)', async (path) => {
      const events = await readEvents(
        path,
        [response([split({ ruleId: RULE })]), response([split({ ruleId: OTHER_RULE })])],
        {
          reads: 2,
        }
      )

      expect(named(events, EXPOSURE).map((event) => event.properties.$feature_flag_rule_id)).toEqual([RULE, OTHER_RULE])
      expect(named(events, FLAG_CALLED)).toHaveLength(2)
    })

    it.each(PATHS)('the exposure dedupe leaves out the value (%s)', async (path) => {
      // The variant's value changed, but the visitor is still in the same variant.
      const events = await readEvents(
        path,
        [response([split({ value: 'annual' })]), response([split({ value: 'annual-v2' })])],
        {
          reads: 2,
        }
      )

      expect(named(events, FLAG_CALLED)).toHaveLength(2)
      expect(named(events, EXPOSURE)).toHaveLength(1)
    })

    it.each(PATHS)('a holdout and a split of one rule are both reported (%s)', async (path) => {
      const holdout = v4Record('holdout', false, { ruleType: 'experiment', ruleId: RULE, hasExperiment: true })
      const events = await readEvents(path, [response([holdout]), response([split({ value: false })])], { reads: 2 })

      expect(named(events, FLAG_CALLED).map((event) => event.properties.$feature_flag_reason_code)).toEqual([
        'holdout',
        'experiment_split',
      ])
      expect(named(events, EXPOSURE)).toHaveLength(1)
    })

    it.each(PATHS)('moving a flag to config version 2 reports it again (%s)', async (path) => {
      const v1 = v4Record('condition_match', 'annual', { configVersion: 1 })
      const v2 = v4Record('targeting_match', 'annual', { ruleType: 'targeted_release', ruleId: RULE })
      const events = await readEvents(path, [response([v1]), response([v2])], { reads: 2 })

      expect(named(events, FLAG_CALLED).map((event) => event.properties.$feature_flag_config_version)).toEqual([
        undefined,
        2,
      ])
    })

    it('groups are part of the exposure identity, in any order', async () => {
      const { client, events } = createClient([response([split()])])

      await read(client, 'snapshot.getFlag', { groups: { company: 'a', team: 'b' } })
      await read(client, 'getFeatureFlag', { groups: { team: 'b', company: 'a' } })
      await read(client, 'snapshot.getFlag', { groups: { company: 'c' } })
      await client.shutdown()

      expect(named(events, EXPOSURE).map((event) => event.properties.$groups)).toEqual([
        { company: 'a', team: 'b' },
        { company: 'c' },
      ])
    })

    it('the exposure dedupe reads the distinct ID as a string', async () => {
      const { client, events } = createClient([response([split()])])

      await client.getFeatureFlag(FLAG, 42 as any)
      await read(client, 'snapshot.getFlag', { distinctId: '42' })
      await client.shutdown()

      expect(named(events, EXPOSURE)).toHaveLength(1)
    })

    it('a reported call never suppresses its exposure', async () => {
      const { client, events } = createClient([response([split()])])

      await read(client, 'getFeatureFlag')
      // The exposure namespace evicted the key, while the flag-called tracker still holds its own.
      ;(client as any)._experimentExposuresReported.clear()
      await read(client, 'snapshot.getFlag')
      await client.shutdown()

      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE, EXPOSURE])
    })

    it('one snapshot and its slices report each event once', async () => {
      const { client, events } = createClient([
        response([split({ value: true, variantKey: 'control' })]),
        response([split({ value: true, variantKey: 'control' })]),
        response([split({ value: true, variantKey: 'test' })]),
      ])

      for (let i = 0; i < 3; i++) {
        const snapshot = await client.evaluateFlags(DISTINCT_ID)
        snapshot.getFlag(FLAG)
        snapshot.isEnabled(FLAG)
        snapshot.only([FLAG]).getFlag(FLAG)
      }
      await client.shutdown()

      expect(events.map((event) => [event.event, event.properties.$feature_flag_variant])).toEqual([
        [FLAG_CALLED, 'control'],
        [EXPOSURE, 'control'],
        [FLAG_CALLED, 'test'],
        [EXPOSURE, 'test'],
      ])
    })

    it('keeps the config version 1 key and adds no exposure key for a config version 1 flag', async () => {
      const { client } = createClient([build(READERS, { template: 'v1' })])

      await client.getFeatureFlag('garden-layout', DISTINCT_ID)
      await settle(client)

      expect(client.distinctIdHasSentFlagCalls[DISTINCT_ID]).toEqual(new Set(['garden-layout_compact']))
      expect((client as any)._experimentExposuresReported.size).toBe(0)
      await client.shutdown()
    })

    it('shutdown clears the exposure dedupe', async () => {
      const { client } = createClient([response([split()])])

      await read(client, 'snapshot.getFlag')
      await settle(client)
      expect((client as any)._experimentExposuresReported.size).toBe(1)
      await client.shutdown()

      expect((client as any)._experimentExposuresReported.size).toBe(0)
    })

    it('a flags reload does not repeat an exposure', async () => {
      // Local evaluation is on, but the definitions do not have the flag, so it is evaluated remotely.
      const definitions = { flags: [], group_type_mapping: {}, cohorts: {} }
      const { client, events } = createClient([response([split()])], { personalApiKey: 'phx_test' }, definitions)

      await read(client, 'getFeatureFlag')
      await client.reloadFeatureFlags()
      await read(client, 'getFeatureFlag')
      await read(client, 'snapshot.getFlag')
      await client.shutdown()

      expect(named(events, FLAG_CALLED)).toHaveLength(1)
      expect(named(events, EXPOSURE)).toHaveLength(1)
    })

    it('bounds the exposure namespace like the flag-called tracker', async () => {
      const { client, events } = createClient([response([split()])], { maxCacheSize: 2 })

      for (const distinctId of ['visitor-1', 'visitor-2', 'visitor-3', 'visitor-3', 'visitor-2']) {
        await read(client, 'getFeatureFlag', { distinctId })
      }
      await settle(client)

      expect([...(client as any)._experimentExposuresReported.keys()]).toEqual(['visitor-3', 'visitor-2'])
      await client.shutdown()
      expect(named(events, EXPOSURE).map((event) => event.distinct_id)).toEqual(['visitor-1', 'visitor-2', 'visitor-3'])
    })
  })

  describe('capture failures', () => {
    /** The events that reached the queue over `reads` reads of a complete split. */
    async function sent(client: PostHog, events: Event[], path: string, reads = 2): Promise<string[]> {
      for (let i = 0; i < reads; i++) {
        expect(await read(client, path)).toBe('annual')
        await settle(client)
      }
      await client.shutdown()
      return events.map((event) => event.event)
    }

    const dropping = (eventName: string) => {
      let dropped = false
      return (event: any) => {
        if (event.event === eventName && !dropped) {
          dropped = true
          return null
        }
        return event
      }
    }

    const throwingOnce = (eventName: string) => {
      let thrown = false
      return (event: any) => {
        if (event.event === eventName && !thrown) {
          thrown = true
          throw new Error('rejected')
        }
        return event
      }
    }

    it.each([FLAG_CALLED, EXPOSURE].flatMap((event) => VALUE_PATHS.map((path) => [event, path])))(
      'a %s that before_send drops keeps its dedupe key (%s)',
      async (event, path) => {
        const { client, events } = createClient([response([split()])], { before_send: dropping(event) })

        // The application dropped the event, so the second read does not send it again. The other
        // event of the first read is still sent, once.
        expect(await sent(client, events, path)).toEqual([event === FLAG_CALLED ? EXPOSURE : FLAG_CALLED])
      }
    )

    it.each([FLAG_CALLED, EXPOSURE].flatMap((event) => VALUE_PATHS.map((path) => [event, path])))(
      'a %s whose before_send throws keeps no dedupe key (%s)',
      async (event, path) => {
        const { client, events } = createClient([response([split()])], { before_send: throwingOnce(event) })

        // The other event of the first read is still sent, and the failed one is sent by the second
        // read, once.
        expect((await sent(client, events, path)).sort()).toEqual([EXPOSURE, FLAG_CALLED].sort())
      }
    )

    it.each([FLAG_CALLED, EXPOSURE].flatMap((event) => VALUE_PATHS.map((path) => [event, path])))(
      'a %s the queue rejects keeps no dedupe key (%s)',
      async (event, path) => {
        const { client, events } = createClient([response([split()])])
        const enqueue = (client as any).enqueue.bind(client)
        let failed = false
        vi.spyOn(client as any, 'enqueue').mockImplementation((type: any, message: any, ...rest: any[]) => {
          if (message.event === event && !failed) {
            failed = true
            throw new Error('queue unavailable')
          }
          return enqueue(type, message, ...rest)
        })

        expect((await sent(client, events, path)).sort()).toEqual([EXPOSURE, FLAG_CALLED].sort())
      }
    )

    it.each(VALUE_PATHS)('an opted-out read keeps no dedupe key (%s)', async (path) => {
      const { client, events } = createClient([response([split()])])

      await client.optOut()
      await read(client, path)
      await settle(client)
      expect(events).toEqual([])
      await client.optIn()

      expect(await sent(client, events, path, 1)).toEqual([FLAG_CALLED, EXPOSURE])
    })

    it('an opted-out config version 1 read is deduped as before', async () => {
      // Config version 1 dedupe is unchanged: the attempt takes the key.
      const { client, events } = createClient([response([v4Record('condition_match', 'annual', { configVersion: 1 })])])

      await client.optOut()
      await read(client, 'getFeatureFlag')
      await settle(client)
      await client.optIn()
      await read(client, 'getFeatureFlag')
      await client.shutdown()

      expect(events).toEqual([])
    })

    it('a failed exposure capture does not change the read', async () => {
      const { client } = createClient([response([split()])], {
        before_send: (event) => {
          if (event?.event === EXPOSURE) {
            throw new Error('rejected')
          }
          return event
        },
      })

      expect(await client.getFeatureFlag(FLAG, DISTINCT_ID)).toBe('annual')
      expect((await client.evaluateFlags(DISTINCT_ID)).getFlag(FLAG)).toBe('annual')
      await client.shutdown()
    })

    it('a capture call that throws is logged and keeps no dedupe key', async () => {
      const { client, events } = createClient([response([split()])])
      const send = (client as any)._sendPreparedEvent.bind(client)
      let thrown = false
      vi.spyOn(client as any, '_sendPreparedEvent').mockImplementation((type: any, props: any, ...rest: any[]) => {
        if (props.event === EXPOSURE && !thrown) {
          thrown = true
          throw new Error('capture failed')
        }
        return send(type, props, ...rest)
      })
      const logged = vi.spyOn((client as any)._logger, 'error')

      const snapshot = await client.evaluateFlags(DISTINCT_ID)
      expect(snapshot.getFlag(FLAG)).toBe('annual')
      expect(snapshot.getFlag(FLAG)).toBe('annual')
      await client.shutdown()

      expect(logged).toHaveBeenCalledWith(`[FEATURE FLAGS] Failed to capture ${EXPOSURE}:`, expect.any(Error))
      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
    })

    it.each([
      ['delivered', false],
      ['failed', true],
    ])('a read while the events are being captured does not send them again (%s)', async (_name, fails) => {
      const { client, events } = createClient([response([split()])])
      const enqueue = (client as any).enqueue.bind(client)
      let failed = false
      vi.spyOn(client as any, 'enqueue').mockImplementation((type: any, message: any, ...rest: any[]) => {
        if (fails && message.event === EXPOSURE && !failed) {
          failed = true
          throw new Error('queue unavailable')
        }
        return enqueue(type, message, ...rest)
      })

      const snapshot = await client.evaluateFlags(DISTINCT_ID)
      snapshot.getFlag(FLAG)
      // The first read's events are still being prepared, so their keys are reserved.
      snapshot.getFlag(FLAG)
      await settle(client)
      expect(events.map((event) => event.event)).toEqual(fails ? [FLAG_CALLED] : [FLAG_CALLED, EXPOSURE])

      // A capture that failed released its key, so a later read sends the event.
      snapshot.getFlag(FLAG)
      await client.shutdown()
      expect(events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
    })
  })

  describe('super and context properties', () => {
    const SPOOFED = {
      $feature_flag_config_version: 7,
      $feature_flag_reason_code: 'spoofed',
      $feature_flag_rule_type: 'spoofed',
      $feature_flag_rule_id: OTHER_RULE,
      $feature_flag_variant: 'spoofed',
      $feature_flag_reason: 'spoofed',
      $feature_flag_forced_variant: true,
      $feature_flag_experiment_id: 301,
      $experiment_exposure_source: 'spoofed',
    }

    async function eventsWithSpoofedProperties(
      record: Record<string, any>,
      via: 'super' | 'context'
    ): Promise<Event[]> {
      const { client, events } = createClient([response([record])])
      if (via === 'super') {
        await client.register({ ...SPOOFED })
        await read(client, 'getFeatureFlag')
      } else {
        await client.withContext({ properties: { ...SPOOFED } }, () => read(client, 'getFeatureFlag'))
      }
      await client.shutdown()
      return events
    }

    it.each(['super', 'context'] as const)('%s properties cannot change config version 2 attribution', async (via) => {
      const events = await eventsWithSpoofedProperties(split(), via)

      const [called] = named(events, FLAG_CALLED)
      expect(attribution(called.properties)).toEqual(EXPECTED_ATTRIBUTION)
      for (const name of ['$feature_flag_reason', '$feature_flag_forced_variant', '$feature_flag_experiment_id']) {
        expect(called.properties).not.toHaveProperty(name)
      }
      const [exposure] = named(events, EXPOSURE)
      expect(attribution(exposure.properties)).toEqual(attribution(EXPECTED_EXPOSURE))
      for (const name of [...EXPOSURE_LEAVES_OUT, '$feature_flag_experiment_id', '$feature_flag_forced_variant']) {
        expect(exposure.properties).not.toHaveProperty(name)
      }
      checkExposure(exposure.properties)
    })

    it.each(['super', 'context'] as const)(
      '%s properties cannot add rule fields a config version 2 call omits',
      async (via) => {
        const events = await eventsWithSpoofedProperties(v4Record('no_rule_match', false), via)

        const [called] = events
        expect(attribution(called.properties)).toEqual({
          $feature_flag_config_version: 2,
          $feature_flag_reason_code: 'no_rule_match',
        })
      }
    )

    it.each(['super', 'context'] as const)('%s properties still apply to config version 1 calls', async (via) => {
      const [called] = await eventsWithSpoofedProperties(
        v4Record('condition_match', 'annual', { configVersion: 1 }),
        via
      )

      for (const [name, value] of Object.entries(SPOOFED)) {
        if (name !== '$feature_flag_reason') {
          expect(called.properties[name]).toEqual(value)
        }
      }
    })
  })

  it('before_send sees both events and may still change them', async () => {
    const { seen, before_send } = recordingBeforeSend()
    const { client, events } = createClient([response([split()])], {
      before_send: (event) => {
        before_send(event)
        return event && { ...event, properties: { ...event.properties, edited: true } }
      },
    })

    await read(client, 'getFeatureFlag')
    await client.shutdown()

    expect(seen.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
    expect(events.map((event) => event.properties.edited)).toEqual([true, true])
  })
})
