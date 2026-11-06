import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { FeatureFlagDetail, PostHogFeatureFlagsResponse, PostHogFetchOptions } from '@posthog/core'
import { PostHog } from '@/entrypoints/index.node'
import { FLAGS_RESPONSE_WITHOUT_TYPED_VALUES_MESSAGE, ParsedFlagRecord, parsedFlagRecordOf } from '@/flags-response'

// Reading the /flags?v=4 response, checked against the released wire contract. The files in
// `fixtures/feature_flag_rules_v2` are copied unchanged from a released
// PostHog/posthog-sdk-test-harness contract; `SOURCE.json` records the release and the digest
// of each file.

const FIXTURES = fileURLToPath(new URL('./fixtures/feature_flag_rules_v2/', import.meta.url))
const load = (name: string): any => JSON.parse(readFileSync(FIXTURES + name, 'utf8'))

const READERS = load('readers.json')
const RESPONSES = load('responses.json')
const LEGACY_PROJECTION = load('legacy_projection.json')
const VALUE_CORPUS = load('v2_value_evaluation.json')

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

/** Fixture cases as `it.each` rows named by their ID. */
const byId = (cases: any[]): [string, any][] => cases.map((testCase) => [testCase.id, testCase])

const REQUEST_ID = '60000000-0000-4000-8000-000000000000'

function createClient(responses: unknown[] = []) {
  const fetch = vi.fn(async (url: string, _options: PostHogFetchOptions) => {
    if (!url.includes('/flags/')) {
      return { status: 200, text: async () => 'ok', json: async () => ({ status: 'ok' }) }
    }
    const next = responses.length > 1 ? responses.shift() : responses[0]
    return { status: 200, text: async () => JSON.stringify(next), json: async () => structuredClone(next) }
  })
  const client = new PostHog('TEST_API_KEY', {
    host: 'http://example.com',
    fetch: fetch as any,
    fetchRetryCount: 0,
    flushAt: 1000,
  })
  return { client, fetch }
}

// The response through the client's reader: the legacy rendering of each record, with the parsed
// record kept beside it.
function read(body: unknown): PostHogFeatureFlagsResponse {
  const { client } = createClient()
  return (client as any).readFlagsResponse(structuredClone(body))
}

const recordOf = (body: unknown, key: string): ParsedFlagRecord => parsedFlagRecordOf(read(body).flags[key])

function captured(client: PostHog): any[] {
  const events: any[] = []
  client.on('capture', (message) => events.push(message))
  return events
}

function v4Record(overrides: Record<string, unknown> = {}): Record<string, any> {
  const flag: Record<string, any> = {
    key: 'garden-layout',
    value: 'compact',
    reason: { code: 'targeting_match', condition_index: 0, description: 'Matched rule 1' },
    metadata: {
      id: 201,
      version: 7,
      config_version: 2,
      has_experiment: false,
      payload: null,
      rule_type: 'targeted_release',
      rule_id: '10000000-0000-4000-8000-000000000001',
    },
  }
  return applyOverrides(flag, overrides)
}

function olderRecord(overrides: Record<string, unknown> = {}): Record<string, any> {
  const flag: Record<string, any> = {
    key: 'garden-layout',
    enabled: true,
    variant: 'compact',
    failed: false,
    reason: { code: 'condition_match', condition_index: 0, description: 'Matched condition set 1' },
    metadata: { id: 202, version: 9, description: 'Garden layout', payload: null, has_experiment: false },
  }
  return applyOverrides(flag, overrides)
}

function applyOverrides(flag: Record<string, any>, overrides: Record<string, unknown>): Record<string, any> {
  for (const [path, value] of Object.entries(overrides)) {
    const tokens = path.split('.')
    const parent = tokens.slice(0, -1).reduce((target, token) => target[token], flag)
    parent[tokens[tokens.length - 1]] = value
  }
  return flag
}

const envelope = (flags: Record<string, unknown>): Record<string, unknown> => ({
  flags,
  errorsWhileComputingFlags: false,
  requestId: REQUEST_ID,
  evaluatedAt: 1800000000000,
})

describe('the /flags?v=4 response', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('vendors the contract fixtures unchanged from the recorded release', () => {
    const source = load('SOURCE.json')
    expect(source.release).toBe('1.27.0')
    expect(source.contract_version).toBe('8.0.0')
    for (const [name, entry] of Object.entries<any>(source.files)) {
      const digest = createHash('sha256')
        .update(readFileSync(FIXTURES + name))
        .digest('hex')
      expect(digest).toBe(entry.sha256)
    }
  })

  describe('the request', () => {
    it.each([
      ['a v4 response', envelope({ 'garden-layout': v4Record() })],
      ['an older response', envelope({ 'garden-layout': olderRecord() })],
    ])('asks for v=4 once, and reads %s without retrying', async (_name, body) => {
      const { client, fetch } = createClient([body])

      expect(await client.getFeatureFlag('garden-layout', 'user-1')).toBe('compact')

      const flagsCalls = fetch.mock.calls.filter(([url]) => url.includes('/flags/'))
      expect(flagsCalls.map(([url]) => url)).toEqual(['http://example.com/flags/?v=4'])
      await client.shutdown()
    })
  })

  describe('valid producer responses', () => {
    const validCases = RESPONSES.cases.filter((testCase: any) => testCase.expected === 'valid')

    it.each(byId(validCases))('retains %s as sent', (_id, testCase) => {
      const body = build(RESPONSES, testCase)
      const response = read(body)

      expect(Object.keys(response.flags).sort()).toEqual(Object.keys(body.flags).sort())
      for (const [key, sent] of Object.entries<any>(body.flags)) {
        const record = parsedFlagRecordOf(response.flags[key])
        expect(record.value).toEqual(sent.value)
        expect(record.failed).toBe(sent.failed === true)
        expect(record.unreadableField).toBeUndefined()
        expect(record.reason?.code).toBe(sent.reason.code)
        expect(record.reason?.conditionIndex ?? null).toBe(sent.reason.condition_index)
        expect(record.metadata).toEqual({
          id: sent.metadata.id,
          version: sent.metadata.version,
          configVersion: sent.metadata.config_version,
          description: sent.metadata.description ?? undefined,
          hasExperiment: sent.metadata.has_experiment,
          ruleType: sent.metadata.rule_type,
          ruleId: sent.metadata.rule_id,
          variantKey: sent.metadata.variant_key,
          forcedVariant: sent.metadata.forced_variant,
        })
      }
    })
  })

  describe('the reader corpus', () => {
    // The reader expectations are what the typed flag API will return, which depends only on the
    // parsed record. This projects a parsed record onto them.
    function readerCells(record: ParsedFlagRecord | undefined, callerDefault: unknown): Record<string, unknown> {
      if (record === undefined) {
        return { value: callerDefault, config_version: null, experiment_exposure: false, error_code: 'FLAG_NOT_FOUND' }
      }
      if (record.unreadableField !== undefined) {
        return { value: callerDefault, config_version: null, experiment_exposure: false, error_code: 'PARSE_ERROR' }
      }
      const errorCode = record.failed
        ? 'GENERAL'
        : record.reason?.code === 'missing_group_key'
          ? 'INVALID_CONTEXT'
          : null
      const { configVersion, ruleType, ruleId, variantKey } = record.metadata
      return {
        value: errorCode !== null || record.value === null ? callerDefault : record.value,
        config_version: configVersion ?? null,
        experiment_exposure:
          errorCode === null &&
          configVersion === 2 &&
          record.reason?.code === 'experiment_split' &&
          ruleType === 'experiment' &&
          ruleId !== undefined &&
          variantKey !== undefined,
        error_code: errorCode,
      }
    }

    it.each(byId(READERS.cases))('reads %s', (_id, testCase) => {
      const response = read(build(READERS, testCase))
      const { requested_key: key, caller_default: callerDefault, ...expected } = testCase.reader
      const detail: FeatureFlagDetail | undefined = response.flags[key]

      expect(readerCells(detail && parsedFlagRecordOf(detail), callerDefault)).toEqual(expected)
      for (const [siblingKey, siblingExpected] of Object.entries<any>(testCase.sibling_expectations ?? {})) {
        const cells = readerCells(parsedFlagRecordOf(response.flags[siblingKey]), callerDefault)
        expect(cells).toMatchObject(siblingExpected)
      }
    })
  })

  describe('older records', () => {
    it('reads a record without value as config version 1 and ignores its rule context', () => {
      const record = olderRecord({
        'metadata.config_version': 2,
        'metadata.rule_type': 'experiment',
        'metadata.rule_id': '10000000-0000-4000-8000-000000000001',
        'metadata.variant_key': 'compact',
      })

      expect(recordOf(envelope({ 'garden-layout': record }), 'garden-layout')).toEqual({
        value: 'compact',
        failed: false,
        reason: { code: 'condition_match', conditionIndex: 0, description: 'Matched condition set 1' },
        metadata: { id: 202, version: 9, configVersion: 1, description: 'Garden layout', hasExperiment: false },
      })
    })

    it('keeps the legacy rendering of a valid older record as sent', () => {
      const record = olderRecord({ future_field: [1] })

      expect(read(envelope({ 'garden-layout': record })).flags['garden-layout']).toEqual(record)
    })

    it('keeps a failed older record as failed', () => {
      const record = olderRecord({
        enabled: false,
        variant: null,
        failed: true,
        reason: { code: 'timeout', condition_index: null, description: 'Timed out' },
      })

      const parsed = recordOf(envelope({ 'garden-layout': record }), 'garden-layout')
      expect(parsed).toMatchObject({ value: false, failed: true, reason: { description: 'Timed out' } })
      expect(parsed.unreadableField).toBeUndefined()
    })

    it('reads a v1 response as config version 1', () => {
      const response = read({ featureFlags: { 'garden-layout': 'compact' }, featureFlagPayloads: {} })

      expect(parsedFlagRecordOf(response.flags['garden-layout'])).toMatchObject({
        value: 'compact',
        failed: false,
        metadata: { configVersion: 1 },
      })
    })
  })

  describe('records that cannot be read', () => {
    function expectOnlyThisRecordUnreadable(response: PostHogFeatureFlagsResponse, field: string): void {
      const unreadable = response.flags['garden-layout']
      expect(parsedFlagRecordOf(unreadable)).toEqual({
        value: null,
        failed: true,
        unreadableField: field,
        metadata: {},
      })
      expect(unreadable).toMatchObject({
        key: 'garden-layout',
        enabled: false,
        variant: undefined,
        metadata: undefined,
      })
      expect(response.featureFlags['garden-layout']).toBe(false)
      expect(response.featureFlagPayloads).not.toHaveProperty('garden-layout')

      const sibling = parsedFlagRecordOf(response.flags.sibling)
      expect(sibling.unreadableField).toBeUndefined()
      expect(sibling.value).toBe('compact')
      expect(response.featureFlags.sibling).toBe('compact')
    }

    it.each([
      ['value', []],
      // JSON.parse reads an out-of-range number such as 1e999 as Infinity.
      ['value', JSON.parse('1e999')],
      ['key', 123],
      ['failed', 'true'],
      ['reason', 'targeting_match'],
      ['reason', ''],
      ['reason.code', 3],
      ['reason.condition_index', '0'],
      ['reason.condition_index', 0.5],
      ['reason.description', ['Matched']],
      ['metadata', []],
      ['metadata.id', '201'],
      ['metadata.version', true],
      ['metadata.config_version', '2'],
      ['metadata.description', 1],
      ['metadata.has_experiment', 'false'],
      ['metadata.rule_type', 2],
      ['metadata.rule_id', 3],
      ['metadata.experiment_id', '301'],
      ['metadata.variant_key', true],
      ['metadata.forced_variant', 'yes'],
    ])('a v4 record with a %s of the wrong type fails only itself', (path, value) => {
      const response = read(
        envelope({ 'garden-layout': v4Record({ [path]: value }), sibling: v4Record({ key: 'sibling' }) })
      )

      expectOnlyThisRecordUnreadable(response, path)
    })

    it.each([
      ['key', 123],
      ['enabled', 'true'],
      ['variant', 3],
      ['failed', 'yes'],
      ['reason', 'condition_match'],
      ['reason', ''],
      ['reason.code', 3],
      ['reason.condition_index', '0'],
      ['reason.condition_index', 0.5],
      ['reason.description', ['Matched']],
      ['metadata', []],
      ['metadata.id', '202'],
      ['metadata.version', true],
      ['metadata.description', 1],
      ['metadata.has_experiment', 'false'],
    ])('an older record with a %s of the wrong type fails only itself', (path, value) => {
      const response = read(
        envelope({ 'garden-layout': olderRecord({ [path]: value }), sibling: olderRecord({ key: 'sibling' }) })
      )

      expectOnlyThisRecordUnreadable(response, path)
    })

    it.each([['compact'], [null], [7]])('a record that is not an object (%j) fails only itself', (record) => {
      const response = read(envelope({ 'garden-layout': record, sibling: v4Record({ key: 'sibling' }) }))

      expectOnlyThisRecordUnreadable(response, 'record')
    })

    it('a value too deeply nested to encode as a payload fails only its own record', () => {
      const deep: Record<string, any> = {}
      let inner = deep
      for (let depth = 0; depth < 200_000; depth++) {
        inner.a = {}
        inner = inner.a
      }
      const { client } = createClient()
      const body = envelope({ 'garden-layout': v4Record({ value: deep }), sibling: v4Record({ key: 'sibling' }) })

      expectOnlyThisRecordUnreadable((client as any).readFlagsResponse(body), 'value')
    })

    it('a server-failed record is not marked unreadable', () => {
      const response = read(
        envelope({
          v4: build(RESPONSES, { template: 'error' }).flags['garden-layout'],
          older: olderRecord({ failed: true, enabled: false, variant: null }),
        })
      )

      for (const detail of Object.values(response.flags)) {
        expect(parsedFlagRecordOf(detail)).toMatchObject({ failed: true })
        expect(parsedFlagRecordOf(detail).unreadableField).toBeUndefined()
      }
    })

    it('a failed v4 record never renders the value it carries', () => {
      const body = build(RESPONSES, { template: 'error' })
      body.flags['garden-layout'].value = 'compact'
      const response = read(body)

      expect(parsedFlagRecordOf(response.flags['garden-layout']).value).toBeNull()
      expect(response.featureFlags['garden-layout']).toBe(false)
    })
  })

  describe('field rules', () => {
    it('ignores unknown fields and null optional fields', () => {
      const record = v4Record({ future_field: { nested: true }, conditions: 'not read' })
      record.reason.future_reason = 1
      Object.assign(record.metadata, { future_metadata: [1], variant_key: null, holdout_id: '401' })

      expect(recordOf(envelope({ 'garden-layout': record }), 'garden-layout')).toEqual({
        value: 'compact',
        failed: false,
        reason: { code: 'targeting_match', conditionIndex: 0, description: 'Matched rule 1' },
        metadata: {
          id: 201,
          version: 7,
          configVersion: 2,
          hasExperiment: false,
          ruleType: 'targeted_release',
          ruleId: '10000000-0000-4000-8000-000000000001',
        },
      })
    })

    it('checks an experiment ID but does not keep it', () => {
      const parsed = recordOf(
        envelope({ 'garden-layout': v4Record({ 'metadata.experiment_id': 301 }) }),
        'garden-layout'
      )

      expect(parsed.unreadableField).toBeUndefined()
      expect(parsed.metadata).not.toHaveProperty('experimentId')
    })

    it.each([
      [v4Record, 'other-flag'],
      [v4Record, null],
      [olderRecord, 'other-flag'],
      [olderRecord, null],
    ])('reads a record under its map key', (makeRecord, key) => {
      const response = read(envelope({ 'garden-layout': makeRecord({ key }) }))

      expect(parsedFlagRecordOf(response.flags['garden-layout'])).toMatchObject({ value: 'compact', failed: false })
      expect(response.featureFlags).toEqual({ 'garden-layout': 'compact' })
    })

    it('reads integral JSON numbers as integers', () => {
      const parsed = recordOf(
        envelope({ 'garden-layout': v4Record({ 'metadata.config_version': 2.0, 'metadata.id': 201.0 }) }),
        'garden-layout'
      )

      expect(parsed.metadata).toMatchObject({ id: 201, configVersion: 2 })
    })
  })

  describe('legacy rendering', () => {
    it.each([
      [true, true, undefined],
      [false, false, undefined],
      [null, false, undefined],
      ['compact', 'compact', undefined],
      [12.5, true, 12.5],
      [0, true, 0],
      [{ columns: 2 }, true, { columns: 2 }],
    ])('renders the value %j as %j with payload %j', (value, legacyValue, payload) => {
      const response = read(envelope({ 'garden-layout': v4Record({ value }) }))

      expect(response.featureFlags['garden-layout']).toEqual(legacyValue)
      expect(response.featureFlagPayloads['garden-layout']).toEqual(payload)
    })

    it.each([
      [25, '25'],
      [{ columns: 2 }, '{"columns":2}'],
    ])('uses a number or object value %j as its own payload and ignores a sent payload', (value, encoded) => {
      const response = read(envelope({ 'garden-layout': v4Record({ value, 'metadata.payload': '999' }) }))

      expect(response.flags['garden-layout'].metadata?.payload).toBe(encoded)
      expect(response.featureFlagPayloads['garden-layout']).toEqual(value)
    })

    it('keeps the payload of a boolean or string value as sent', () => {
      const response = read(
        envelope({
          'bool-flag': v4Record({ key: 'bool-flag', value: true, 'metadata.payload': '{"columns": 2}' }),
          'string-flag': v4Record({ key: 'string-flag', 'metadata.payload': '{"columns": 2}' }),
        })
      )

      expect(response.flags['bool-flag'].metadata?.payload).toBe('{"columns": 2}')
      expect(response.flags['string-flag'].metadata?.payload).toBe('{"columns": 2}')
    })

    it('encodes number and object payloads as compact JSON in wire key order', () => {
      const response = read(
        envelope({
          number: v4Record({ key: 'number', value: 1.5e-7 }),
          object: v4Record({ key: 'object', value: { b: 'ü', a: [1, true, null] } }),
        })
      )

      expect(response.flags.number.metadata?.payload).toBe('1.5e-7')
      expect(response.flags.object.metadata?.payload).toBe('{"b":"ü","a":[1,true,null]}')
    })
  })

  describe('legacy parity corpus', () => {
    // The legacy maps the getters read: flag values, and payloads decoded from JSON.
    function legacyMaps(body: unknown): { featureFlags: unknown; featureFlagPayloads: unknown } {
      const response = read(body)
      return { featureFlags: response.featureFlags, featureFlagPayloads: response.featureFlagPayloads }
    }

    /** The v4 record of a v1 flag: `value` is the variant, or `enabled` without one. */
    function v4RecordForV1Outcome(outcome: any): Record<string, unknown> {
      const metadata: Record<string, unknown> = {
        id: outcome.flag_id,
        version: outcome.flag_version,
        config_version: 1,
        payload: outcome.payload,
        has_experiment: false,
      }
      if (outcome.variant !== null) {
        metadata.variant_key = outcome.variant
      }
      return {
        key: outcome.key,
        value: outcome.failed ? null : (outcome.variant ?? outcome.enabled),
        reason: outcome.reason,
        metadata,
        ...(outcome.failed ? { failed: true } : {}),
      }
    }

    it.each(byId(LEGACY_PROJECTION.cases))(
      'renders the same legacy values for %s from both shapes',
      (_id, testCase) => {
        const { flags_v2: v2Response, flags_v1: v1Maps } = testCase.projections
        const outcome = testCase.outcome
        const v4Response = {
          errorsWhileComputingFlags: v2Response.errorsWhileComputingFlags,
          flags: outcome.omitted ? {} : { [outcome.key]: v4RecordForV1Outcome(outcome) },
        }
        const expected = {
          featureFlags: v1Maps.featureFlags,
          featureFlagPayloads: Object.fromEntries(
            Object.entries<string>(v1Maps.featureFlagPayloads).map(([key, payload]) => [key, JSON.parse(payload)])
          ),
        }

        expect(legacyMaps(v2Response)).toEqual(expected)
        expect(legacyMaps(v4Response)).toEqual(expected)
      }
    )

    const valueSuccessCases = VALUE_CORPUS.cases.filter((testCase: any) => testCase.expected.status === 'success')

    it.each(byId(valueSuccessCases))('renders the legacy cells of %s from both shapes', async (_id, testCase) => {
      const { expected, legacy } = testCase
      const rule = expected.rule
      const reason = { code: expected.reason, condition_index: rule ? rule.index : null, description: 'Evaluated' }
      const metadata = { id: 401, version: 3, description: null, has_experiment: false }
      const v2Record = {
        key: 'typed-flag',
        enabled: legacy.enabled,
        variant: legacy.variant,
        reason,
        metadata: { ...metadata, payload: legacy.payload === null ? null : JSON.stringify(legacy.payload) },
      }
      const v4Record = {
        key: 'typed-flag',
        value: expected.value,
        reason,
        metadata: {
          ...metadata,
          config_version: 2,
          payload: null,
          ...(rule ? { rule_type: rule.rule_type, rule_id: rule.id } : {}),
        },
      }

      for (const record of [v2Record, v4Record]) {
        const body = envelope({ 'typed-flag': record })
        expect(legacyMaps(body)).toEqual({
          featureFlags: { 'typed-flag': legacy.value },
          featureFlagPayloads: legacy.payload === null ? {} : { 'typed-flag': legacy.payload },
        })

        const { client } = createClient([body])
        const result = await client.getFeatureFlagResult('typed-flag', 'user-1', { sendFeatureFlagEvents: false })
        expect(result).toMatchObject({
          enabled: legacy.enabled,
          variant: legacy.variant ?? undefined,
          payload: legacy.payload,
        })
        await client.shutdown()
      }
    })
  })

  describe('the client', () => {
    it.each([
      ['older records', envelope({ 'garden-layout': olderRecord() }), 2],
      ['a v1 response', { featureFlags: { 'garden-layout': 'compact' }, featureFlagPayloads: {} }, 2],
      ['v4 records', envelope({ 'garden-layout': v4Record() }), 0],
    ])('logs once per client when /flags sends %s', async (_name, body, expectedLogs) => {
      const clients = [createClient([body]).client, createClient([body]).client]
      const info = clients.map((client) => vi.spyOn((client as any)._logger, 'info'))

      await clients[0].getAllFlags('user-1')
      await clients[0].getAllFlags('user-1')
      await clients[1].getAllFlags('user-1')

      const logged = info.flatMap((spy) =>
        spy.mock.calls.filter(([message]) => message === FLAGS_RESPONSE_WITHOUT_TYPED_VALUES_MESSAGE)
      )
      expect(logged).toHaveLength(expectedLogs)
      await Promise.all(clients.map((client) => client.shutdown()))
    })

    it.each([
      ['v4', v4Record({ 'metadata.id': '201' })],
      ['older', olderRecord({ reason: 'oops' })],
    ])(
      'a single-flag read of an unreadable %s record reads as disabled and reports an unknown error',
      async (_shape, record) => {
        const { client } = createClient([{ ...envelope({ 'garden-layout': record }), errorsWhileComputingFlags: true }])
        const events = captured(client)

        expect(await client.getFeatureFlag('garden-layout', 'user-1')).toBe(false)
        expect(await client.getFeatureFlagPayload('garden-layout', 'user-1')).toBeNull()
        await client.shutdown()

        expect(events.map((event) => event.properties)).toEqual([
          expect.objectContaining({
            $feature_flag: 'garden-layout',
            $feature_flag_response: false,
            $feature_flag_error: 'unknown_error',
          }),
        ])
        const properties = events[0].properties
        for (const absent of [
          '$feature_flag_request_id',
          '$feature_flag_evaluated_at',
          '$feature_flag_id',
          '$feature_flag_version',
          '$feature_flag_reason',
          '$feature_flag_has_experiment',
        ]) {
          expect(properties[absent]).toBeUndefined()
        }
      }
    )

    it('keeps the parsed record of each remotely evaluated flag in a snapshot', async () => {
      const body = envelope({
        'object-flag': v4Record({ key: 'object-flag', value: { layout: 'compact' } }),
        split: build(READERS, { template: 'experiment_split' }).flags['garden-layout'],
        older: olderRecord({ key: 'older' }),
      })
      const { client } = createClient([body])

      const snapshot = await client.evaluateFlags('user-1')
      const flags = (snapshot as any)._flags

      expect(flags['object-flag'].parsed).toMatchObject({ value: { layout: 'compact' }, failed: false })
      expect(flags.split.parsed).toMatchObject({
        value: false,
        reason: { code: 'experiment_split' },
        metadata: { configVersion: 2, ruleType: 'experiment', variantKey: 'arm_a' },
      })
      expect(flags.older.parsed).toMatchObject({ value: 'compact', metadata: { configVersion: 1 } })
      expect(snapshot.getFlag('object-flag', { sendFeatureFlagEvents: false })).toBe(true)
      expect(snapshot.getFlagPayload('object-flag')).toEqual({ layout: 'compact' })
      expect(snapshot.getFlag('split', { sendFeatureFlagEvents: false })).toBe(false)
      await client.shutdown()
    })

    it.each([
      ['v4', () => v4Record()],
      ['older', () => olderRecord()],
    ])('leaves an absent flag ID and version out of events (%s record)', async (_shape, makeRecord) => {
      const record = makeRecord()
      delete record.metadata.id
      delete record.metadata.version
      const { client } = createClient([envelope({ 'garden-layout': record })])
      const events = captured(client)

      await client.getFeatureFlagResult('garden-layout', 'user-1')
      ;(await client.evaluateFlags('user-2')).getFlag('garden-layout')
      await client.shutdown()

      expect(events).toHaveLength(2)
      for (const event of events) {
        expect(event.properties.$feature_flag_id).toBeUndefined()
        expect(event.properties.$feature_flag_version).toBeUndefined()
        expect(event.properties.$feature_flag_request_id).toBe(REQUEST_ID)
      }
    })

    it('sends the same $feature_flag_called properties for a v1 flag at v4', async () => {
      const { client } = createClient([build(READERS, { template: 'v1' })])
      const events = captured(client)

      const result = await client.getFeatureFlagResult('garden-layout', 'user-1')
      await client.shutdown()

      expect(result).toEqual({
        key: 'garden-layout',
        enabled: true,
        variant: 'compact',
        payload: { columns: 2 },
        reason: 'condition_match',
        reasonCode: 'condition_match',
      })
      expect(events).toHaveLength(1)
      expect(events[0].event).toBe('$feature_flag_called')
      expect(JSON.parse(JSON.stringify(events[0].properties))).toMatchObject({
        $feature_flag: 'garden-layout',
        $feature_flag_response: 'compact',
        $feature_flag_id: 202,
        $feature_flag_version: 9,
        $feature_flag_reason: 'condition_match',
        locally_evaluated: false,
        '$feature/garden-layout': 'compact',
        $feature_flag_request_id: '20000000-0000-4000-8000-000000000002',
        $feature_flag_evaluated_at: 1800000000000,
        $feature_flag_has_experiment: false,
      })
      expect(events[0].properties).not.toHaveProperty('$feature_flag_error')
    })
  })
})
