import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { isNull, isUndefined } from '@posthog/core'
import type { FeatureFlagDetail } from '@posthog/types'
import { PostHogFeatureFlags, type FlagsResponseFormat } from '../src/feature-flags'
import type { FeatureFlagsConfig, FeatureFlagsConfigSource } from '../src/feature-flags-config'
import { flagsResponseV4, readFlagRecords, typedFlagDetailOf } from '../src/flags-response-v4'
import { createTestClient, type TestClient } from './helpers/test-client'

// Reading the /flags?v=4 response, checked against the released wire contract. The contract files
// are the ones posthog-node vendors unchanged from a released PostHog/posthog-sdk-test-harness
// contract; its `SOURCE.json` records the release and the digest of each file.

const FIXTURES = path.resolve(__dirname, '../../node/src/__tests__/fixtures/feature_flag_rules_v2')
const load = (name: string): any => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))

const READERS = load('readers.json')
const RESPONSES = load('responses.json')
const LEGACY_PROJECTION = load('legacy_projection.json')
const VALUE_CORPUS = load('v2_value_evaluation.json')

const pointer = (jsonPointer: string): string[] =>
    jsonPointer
        .split('/')
        .slice(1)
        .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))

/** Applies a fixture case: copy its template, remove members, then set members. */
function build(fixture: any, testCase: any): any {
    const document = structuredClone(fixture.templates[testCase.template])
    for (const jsonPointer of testCase.remove ?? []) {
        const tokens = pointer(jsonPointer)
        const parent = tokens.slice(0, -1).reduce((target, token) => target[token], document)
        delete parent[tokens[tokens.length - 1]!]
    }
    for (const [jsonPointer, value] of Object.entries(testCase.set ?? {})) {
        const tokens = pointer(jsonPointer)
        const parent = tokens.slice(0, -1).reduce((target, token) => target[token], document)
        parent[tokens[tokens.length - 1]!] = structuredClone(value)
    }
    return document
}

/** Fixture cases as `it.each` rows named by their ID. */
const byId = (cases: any[]): [string, any][] => cases.map((testCase) => [testCase.id, testCase])

const REQUEST_ID = '60000000-0000-4000-8000-000000000000'
const RULE_ID = '10000000-0000-4000-8000-000000000001'

function applyOverrides(flag: Record<string, any>, overrides: Record<string, unknown>): Record<string, any> {
    for (const [memberPath, value] of Object.entries(overrides)) {
        const tokens = memberPath.split('.')
        const parent = tokens.slice(0, -1).reduce((target, token) => target[token], flag)
        parent[tokens[tokens.length - 1]!] = value
    }
    return flag
}

function v4Record(overrides: Record<string, unknown> = {}): Record<string, any> {
    return applyOverrides(
        {
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
                rule_id: RULE_ID,
            },
        },
        overrides
    )
}

function olderRecord(overrides: Record<string, unknown> = {}): Record<string, any> {
    return applyOverrides(
        {
            key: 'garden-layout',
            enabled: true,
            variant: 'compact',
            failed: false,
            reason: { code: 'condition_match', condition_index: 0, description: 'Matched condition set 1' },
            metadata: { id: 202, version: 9, description: 'Garden layout', payload: null, has_experiment: false },
        },
        overrides
    )
}

const envelope = (flags: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, any> => ({
    flags,
    errorsWhileComputingFlags: false,
    requestId: REQUEST_ID,
    evaluatedAt: 1800000000000,
    ...extra,
})

/** The stored rendering of each record of a response body. */
const read = (body: unknown): Record<string, FeatureFlagDetail> =>
    readFlagRecords(structuredClone(body) as any).body.flags as Record<string, FeatureFlagDetail>

const UNREADABLE = { enabled: false, variant: undefined, reason: undefined, metadata: undefined, failed: true }

/** A client of the shared extension that opts in to a response format, as posthog-js does. */
class OptedInFeatureFlags extends PostHogFeatureFlags {
    private readonly _format: FlagsResponseFormat

    constructor(configSource: FeatureFlagsConfigSource, format: FlagsResponseFormat) {
        super(configSource)
        this._format = format
    }

    protected override get _responseFormat(): FlagsResponseFormat {
        return this._format
    }
}

const instances: PostHogFeatureFlags[] = []

// `null` builds the extension as a client that does not opt in builds it.
async function setup(
    responseFormat: FlagsResponseFormat | null = flagsResponseV4,
    overrides: Partial<FeatureFlagsConfig> = {}
): Promise<{ flags: PostHogFeatureFlags; client: TestClient; load(body: unknown): Promise<void> }> {
    const config: FeatureFlagsConfig = {
        bootstrap: {},
        remoteRequestsDisabled: false,
        featureFlagsDisabled: false,
        onlyEvaluateSurveyFeatureFlags: false,
        deduplicateCallsPerSession: false,
        idleRefreshBackoff: false,
        requestTimeoutMs: 3000,
        evaluationContexts: [],
        ...overrides,
    }
    const client = createTestClient()
    const flags = responseFormat
        ? new OptedInFeatureFlags({ get: () => config }, responseFormat)
        : new PostHogFeatureFlags({ get: () => config })
    instances.push(flags)
    await flags.setup(client)
    return {
        flags,
        client,
        async load(body: unknown): Promise<void> {
            vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: structuredClone(body) })
            flags.reloadFeatureFlags()
            await vi.advanceTimersByTimeAsync(10)
        },
    }
}

const storedDetails = (client: TestClient): Record<string, any> => client.kv.get('$feature_flag_details') ?? {}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    instances.splice(0).forEach((flags) => flags.dispose())
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('the /flags?v=4 response', () => {
    it('reads the contract fixtures of the release that posthog-node records', () => {
        const source = load('SOURCE.json')
        expect(source.release).toBe('1.30.0')
        expect(source.contract_version).toBe('10.0.0')
        for (const name of ['readers.json', 'responses.json', 'legacy_projection.json', 'v2_value_evaluation.json']) {
            const digest = createHash('sha256')
                .update(readFileSync(path.join(FIXTURES, name)))
                .digest('hex')
            expect(digest).toBe(source.files[name].sha256)
        }
    })

    describe('the request', () => {
        it('asks for v=2 and reads the response as sent, unless the client opts in', async () => {
            const { flags, client, load: loadFlags } = await setup(null)
            const record = olderRecord()

            await loadFlags(envelope({ 'garden-layout': record }))

            expect(vi.mocked(client.sendRequest).mock.calls.map(([url]) => url)).toEqual(['/flags/?v=2'])
            expect(flags.getFeatureFlag('garden-layout', { send_event: false })).toBe('compact')
            expect(storedDetails(client)['garden-layout']).toEqual(record)
        })

        it.each([
            ['a v4 response', envelope({ 'garden-layout': v4Record() })],
            ['an older response', envelope({ 'garden-layout': olderRecord() })],
        ])('asks for v=4 once, and reads %s without retrying', async (_name, body) => {
            const { flags, client, load: loadFlags } = await setup()

            await loadFlags(body)

            expect(vi.mocked(client.sendRequest).mock.calls.map(([url]) => url)).toEqual(['/flags/?v=4'])
            expect(flags.getFeatureFlag('garden-layout', { send_event: false })).toBe('compact')
        })

        it('asks for v=4 when only survey flags are evaluated', async () => {
            const { client, load: loadFlags } = await setup(flagsResponseV4, { onlyEvaluateSurveyFeatureFlags: true })

            await loadFlags(envelope({ 'garden-layout': v4Record() }))

            expect(vi.mocked(client.sendRequest).mock.calls.map(([url]) => url)).toEqual([
                '/flags/?v=4&only_evaluate_survey_feature_flags=true',
            ])
        })

        it('logs once per client that the response has no typed values', async () => {
            const { client, load: loadFlags } = await setup()
            const info = vi.spyOn(client.logger, 'info')
            const flagsLogger = vi.spyOn(client.logger, 'createLogger')
            expect(flagsLogger).not.toHaveBeenCalled()

            await loadFlags(envelope({ 'garden-layout': v4Record() }))
            await loadFlags(envelope({}))
            expect(info).not.toHaveBeenCalled()

            await loadFlags(envelope({ 'garden-layout': olderRecord() }))
            await loadFlags(envelope({ 'garden-layout': olderRecord() }))
            expect(info.mock.calls).toEqual([
                ['The /flags response has no typed flag values. Its flags are read as before.'],
            ])
        })
    })

    describe('valid producer responses', () => {
        const validCases = RESPONSES.cases.filter((testCase: any) => testCase.expected === 'valid')

        it.each(byId(validCases))('retains %s as sent', (_id, testCase) => {
            const body = build(RESPONSES, testCase)
            const details = read(body)

            expect(Object.keys(details).sort()).toEqual(Object.keys(body.flags).sort())
            for (const [key, sent] of Object.entries<any>(body.flags)) {
                const typed = typedFlagDetailOf(details[key])!
                expect(typed.value).toEqual(sent.failed ? null : sent.value)
                expect(typed.failed === true).toBe(sent.failed === true)
                expect(typed.reason?.code).toBe(sent.reason.code)
                expect(typed.reason?.condition_index ?? null).toBe(sent.reason.condition_index)
                const { payload: _payload, ...metadata } = typed.metadata!
                expect(metadata).toEqual({
                    id: sent.metadata.id,
                    version: sent.metadata.version,
                    description: sent.metadata.description ?? undefined,
                    has_experiment: sent.metadata.has_experiment,
                    config_version: sent.metadata.config_version,
                    rule_type: sent.metadata.rule_type,
                    rule_id: sent.metadata.rule_id,
                    variant_key: sent.metadata.variant_key,
                    forced_variant: sent.metadata.forced_variant,
                })
            }
        })
    })

    describe('the reader corpus', () => {
        // The reader expectations are what the typed flag API will return, which depends only on
        // the stored record. This projects a stored record onto them.
        function readerCells(detail: FeatureFlagDetail | undefined, callerDefault: unknown): Record<string, unknown> {
            if (isUndefined(detail)) {
                return {
                    value: callerDefault,
                    config_version: null,
                    experiment_exposure: false,
                    error_code: 'FLAG_NOT_FOUND',
                }
            }
            const typed = typedFlagDetailOf(detail)
            if (isUndefined(typed)) {
                if (detail.failed && isUndefined(detail.metadata) && isUndefined(detail.reason)) {
                    // A record that could not be read is stored as a failed flag with nothing else.
                    return {
                        value: callerDefault,
                        config_version: null,
                        experiment_exposure: false,
                        error_code: 'PARSE_ERROR',
                    }
                }
                // A record without a typed value reads as config version 1.
                return {
                    value: detail.failed ? callerDefault : (detail.variant ?? detail.enabled),
                    config_version: 1,
                    experiment_exposure: false,
                    error_code: detail.failed ? 'GENERAL' : null,
                }
            }
            const errorCode = typed.failed
                ? 'GENERAL'
                : typed.reason?.code === 'missing_group_key'
                  ? 'INVALID_CONTEXT'
                  : null
            const metadata = typed.metadata
            return {
                value: !isNull(errorCode) || isNull(typed.value) ? callerDefault : typed.value,
                config_version: metadata?.config_version ?? null,
                experiment_exposure:
                    isNull(errorCode) &&
                    metadata?.config_version === 2 &&
                    typed.reason?.code === 'experiment_split' &&
                    metadata.rule_type === 'experiment' &&
                    !isUndefined(metadata.rule_id) &&
                    !isUndefined(metadata.variant_key),
                error_code: errorCode,
            }
        }

        it.each(byId(READERS.cases))('reads %s', (_id, testCase) => {
            const details = read(build(READERS, testCase))
            const {
                requested_key: key,
                caller_default: callerDefault,
                legacy_payload: _legacyPayload,
                ...expected
            } = testCase.reader

            expect(readerCells(details[key], callerDefault)).toEqual(expected)
            for (const [siblingKey, siblingExpected] of Object.entries<any>(testCase.sibling_expectations ?? {})) {
                expect(readerCells(details[siblingKey], callerDefault)).toMatchObject(siblingExpected)
            }
        })

        // `legacy_payload` is the decoded payload the legacy payload getter returns, or `null` for none.
        it.each(byId(READERS.cases.filter((testCase: any) => 'legacy_payload' in testCase.reader)))(
            'returns the legacy payload of %s',
            async (_id, testCase) => {
                const { requested_key: key, legacy_payload: expected } = testCase.reader
                const { flags, load: loadFlags } = await setup()

                await loadFlags(build(READERS, testCase))

                expect(flags.getFeatureFlagPayload(key) ?? null).toEqual(expected)
            }
        )
    })

    describe('older records', () => {
        it('returns a record without value as sent, and keeps no typed record of it', () => {
            const record = olderRecord({
                future_field: [1],
                'metadata.config_version': 2,
                'metadata.rule_type': 'experiment',
                'metadata.rule_id': RULE_ID,
                'metadata.variant_key': 'compact',
            })

            const detail = read(envelope({ 'garden-layout': record }))['garden-layout']

            expect(detail).toEqual(record)
            expect(typedFlagDetailOf(detail)).toBeUndefined()
        })

        // posthog-js never checked the types of a v2 record, and a server that does not serve v4
        // is read exactly as before.
        it.each([
            ['metadata.version', '9'],
            ['metadata.id', '202'],
            ['reason', 'condition_match'],
        ])('returns an older record with a %s of the wrong type as sent', async (memberPath, value) => {
            const record = olderRecord({ [memberPath]: value })
            const { flags, client, load: loadFlags } = await setup()

            await loadFlags(envelope({ 'garden-layout': record }))

            expect(storedDetails(client)['garden-layout']).toEqual(record)
            expect(flags.getFeatureFlag('garden-layout', { send_event: false })).toBe('compact')
        })

        it('reports whether a response has a record without a typed value', () => {
            const typed = envelope({ 'garden-layout': v4Record() })
            const older = envelope({ 'garden-layout': v4Record(), older: olderRecord() })

            expect(readFlagRecords(typed).withoutTypedValues).toBe(false)
            expect(readFlagRecords(older).withoutTypedValues).toBe(true)
            expect(readFlagRecords(envelope({})).withoutTypedValues).toBe(false)
        })

        it.each([
            // A v1 response with flags also comes from a server that does not serve v4.
            [
                'the oldest response shape',
                { featureFlags: { 'garden-layout': 'compact' }, featureFlagPayloads: {} },
                true,
            ],
            ['the oldest response shape without flags', { featureFlags: {}, featureFlagPayloads: {} }, false],
            ['a body without flags', { errorsWhileComputingFlags: false }, false],
            ['an empty body', {}, false],
        ])('returns %s unchanged', (_name, body, withoutTypedValues) => {
            expect(readFlagRecords(body as any)).toEqual({ body, withoutTypedValues })
        })

        it.each([[undefined], [null], ['oops'], [[1]]])(
            'returns a body that is not an object (%j) unchanged',
            (body) => {
                expect(readFlagRecords(body as any)).toEqual({ body, withoutTypedValues: false })
            }
        )
    })

    describe('records that cannot be read', () => {
        function expectOnlyThisRecordUnreadable(details: Record<string, FeatureFlagDetail>): void {
            expect(details['garden-layout']).toEqual({ key: 'garden-layout', ...UNREADABLE })
            expect(typedFlagDetailOf(details['garden-layout'])).toBeUndefined()
            expect(typedFlagDetailOf(details.sibling)).toMatchObject({
                key: 'sibling',
                value: 'compact',
                variant: 'compact',
            })
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
        ])('a v4 record with a %s of the wrong type fails only itself', (memberPath, value) => {
            // structuredClone keeps Infinity, which a JSON round trip would turn into null.
            const body = envelope({
                'garden-layout': v4Record({ [memberPath]: value }),
                sibling: v4Record({ key: 'sibling' }),
            })

            expectOnlyThisRecordUnreadable(read(body))
        })

        it.each([['compact'], [null], [7], [[1]]])(
            'a record that is not an object (%j) fails only itself',
            (record) => {
                expectOnlyThisRecordUnreadable(
                    read(envelope({ 'garden-layout': record, sibling: v4Record({ key: 'sibling' }) }))
                )
            }
        )

        it('a value too deeply nested to encode as a payload fails only its own record', () => {
            const deep: Record<string, any> = {}
            let inner = deep
            for (let depth = 0; depth < 200_000; depth++) {
                inner.a = {}
                inner = inner.a
            }
            const body = envelope({ 'garden-layout': v4Record({ value: deep }), sibling: v4Record({ key: 'sibling' }) })

            // Not through `read`, which copies the body: the copy itself overflows.
            expectOnlyThisRecordUnreadable(readFlagRecords(body).body.flags as Record<string, FeatureFlagDetail>)
        })

        it('reads as a disabled flag with no payload, and leaves the other flags alone', async () => {
            const { flags, load: loadFlags } = await setup()

            await loadFlags(
                envelope({
                    'garden-layout': v4Record({ 'metadata.id': '201', 'metadata.payload': '{"columns":2}' }),
                    sibling: v4Record({ key: 'sibling' }),
                })
            )

            expect(flags.getFeatureFlag('garden-layout', { send_event: false })).toBe(false)
            expect(flags.getFeatureFlagPayload('garden-layout')).toBeUndefined()
            expect(flags.getFeatureFlagResult('garden-layout', { send_event: false })).toEqual({
                key: 'garden-layout',
                enabled: false,
                variant: undefined,
                payload: undefined,
            })
            expect(flags.getFeatureFlag('sibling', { send_event: false })).toBe('compact')
        })

        it('a server-failed record keeps its reason and metadata, and has no value', () => {
            const details = read(
                envelope({ 'garden-layout': build(RESPONSES, { template: 'error' }).flags['garden-layout'] })
            )

            expect(typedFlagDetailOf(details['garden-layout'])).toMatchObject({
                enabled: false,
                value: null,
                failed: true,
                reason: { code: 'error' },
                metadata: { config_version: 2 },
            })
        })

        it.each([
            ['a string value', { value: 'compact' }],
            ['a payload', { 'metadata.payload': '{"columns":2}' }],
            ['an object value', { value: { columns: 2 } }],
        ])('a failed v4 record that carries %s renders no value and no payload', async (_carried, overrides) => {
            const record = v4Record({
                failed: true,
                reason: { code: 'missing_dependency', condition_index: null },
                ...overrides,
            })
            const { flags, load: loadFlags } = await setup()

            expect(typedFlagDetailOf(read(envelope({ 'garden-layout': record }))['garden-layout'])).toMatchObject({
                enabled: false,
                variant: null,
                value: null,
                metadata: { payload: null },
            })
            await loadFlags(envelope({ 'garden-layout': record }))
            expect(flags.getFeatureFlag('garden-layout', { send_event: false })).toBe(false)
            expect(flags.getFeatureFlagPayload('garden-layout')).toBeUndefined()
        })
    })

    describe('field rules', () => {
        it('ignores unknown fields and null optional fields, and stores only the fields it reads', () => {
            const record = v4Record({ future_field: { nested: true }, conditions: 'not read' })
            record.reason.future_reason = 1
            Object.assign(record.metadata, { future_metadata: [1], variant_key: null, holdout_id: '401' })

            const detail = JSON.parse(JSON.stringify(read(envelope({ 'garden-layout': record }))['garden-layout']))

            expect(detail).toEqual({
                key: 'garden-layout',
                enabled: true,
                variant: 'compact',
                value: 'compact',
                reason: { code: 'targeting_match', condition_index: 0, description: 'Matched rule 1' },
                metadata: {
                    id: 201,
                    version: 7,
                    payload: null,
                    has_experiment: false,
                    config_version: 2,
                    rule_type: 'targeted_release',
                    rule_id: RULE_ID,
                },
            })
        })

        it('checks an experiment ID but does not keep it', () => {
            const detail = read(envelope({ 'garden-layout': v4Record({ 'metadata.experiment_id': 301 }) }))

            expect(JSON.parse(JSON.stringify(detail['garden-layout'])).metadata).not.toHaveProperty('experiment_id')
        })

        it.each([
            ['a string that differs from the map key', 'another-key'],
            ['absent', undefined],
            ['null', null],
        ])('stores the map key when the key member is %s', (_name, key) => {
            const record = v4Record({ key })

            expect(read(envelope({ 'garden-layout': record }))['garden-layout']!.key).toBe('garden-layout')
        })

        it('reads a flag whose key is the name of an object member like any other', async () => {
            // JSON.parse defines `__proto__` as an own key, as it does for every flag key.
            const body = JSON.parse(
                JSON.stringify(
                    envelope({ placeholder: v4Record({ key: '__proto__' }), constructor: v4Record() })
                ).replace('"placeholder":', '"__proto__":')
            )
            const details = readFlagRecords(body).body.flags!

            expect(Object.keys(details).sort()).toEqual(['__proto__', 'constructor'])
            expect(typedFlagDetailOf(Object.getOwnPropertyDescriptor(details, '__proto__')!.value)).toMatchObject({
                key: '__proto__',
                value: 'compact',
            })
            expect(typedFlagDetailOf(details.constructor)).toMatchObject({ key: 'constructor', value: 'compact' })
            expect(Object.getPrototypeOf(details)).toBe(Object.prototype)
        })

        it('reads integral JSON numbers as integers', () => {
            const body = JSON.parse(
                JSON.stringify(envelope({ 'garden-layout': v4Record() })).replace(
                    '"config_version":2',
                    '"config_version":2.0'
                )
            )

            expect(typedFlagDetailOf(read(body)['garden-layout'])!.metadata!.config_version).toBe(2)
        })

        it('reads a record without metadata or reason', () => {
            const detail = read(envelope({ 'garden-layout': { key: 'garden-layout', value: true } }))

            expect(detail['garden-layout']).toEqual({
                key: 'garden-layout',
                enabled: true,
                variant: null,
                value: true,
                reason: undefined,
                metadata: undefined,
            })
        })
    })

    describe('legacy rendering', () => {
        it.each([
            // An enabled flag without a payload has a null payload, as from a v2 record.
            [true, true, null],
            [false, false, undefined],
            [null, false, undefined],
            ['compact', 'compact', null],
            [12.5, true, 12.5],
            [0, true, 0],
            [{ columns: 2 }, true, { columns: 2 }],
        ])('renders the value %j as %j with payload %j', async (value, legacyValue, payload) => {
            const { flags, load: loadFlags } = await setup()

            await loadFlags(envelope({ 'garden-layout': v4Record({ value }) }))

            expect(flags.getFeatureFlag('garden-layout', { send_event: false })).toEqual(legacyValue)
            expect(flags.isFeatureEnabled('garden-layout', { send_event: false })).toBe(!!legacyValue)
            expect(flags.getFeatureFlagPayload('garden-layout')).toEqual(payload)
        })

        it.each([
            [25, '25'],
            [{ columns: 2 }, '{"columns":2}'],
        ])('uses a number or object value %j as its own payload and ignores a sent payload', (value, encoded) => {
            const detail = read(envelope({ 'garden-layout': v4Record({ value, 'metadata.payload': '999' }) }))

            expect(detail['garden-layout']!.metadata?.payload).toBe(encoded)
        })

        it('keeps the payload of a boolean or string value as sent', () => {
            const details = read(
                envelope({
                    'bool-flag': v4Record({ key: 'bool-flag', value: true, 'metadata.payload': '{"columns": 2}' }),
                    'string-flag': v4Record({ key: 'string-flag', 'metadata.payload': { columns: 2 } }),
                    'no-payload': v4Record({ key: 'no-payload' }),
                })
            )

            expect(details['bool-flag']!.metadata?.payload).toBe('{"columns": 2}')
            expect(details['string-flag']!.metadata?.payload).toEqual({ columns: 2 })
            expect(details['no-payload']!.metadata?.payload).toBeNull()
        })

        it('encodes number and object payloads as compact JSON in wire key order', () => {
            const details = read(
                envelope({
                    number: v4Record({ key: 'number', value: 1.5e-7 }),
                    object: v4Record({ key: 'object', value: { b: 'ü', a: [1, true, null] } }),
                })
            )

            expect(details.number!.metadata?.payload).toBe('1.5e-7')
            expect(details.object!.metadata?.payload).toBe('{"b":"ü","a":[1,true,null]}')
        })

        // A v2 record carries `variant: null` for a flag without a variant, and the events of an
        // overridden flag depend on it.
        it.each([[true], [false], [null], [12.5], [{ columns: 2 }]])(
            'renders a null variant for the value %j, as a v2 record carries it',
            (value) => {
                expect(read(envelope({ 'garden-layout': v4Record({ value }) }))['garden-layout']!.variant).toBeNull()
            }
        )
    })

    describe('legacy parity corpus', () => {
        /** The v4 record of a v1 flag: `value` is the variant, or `enabled` without one. */
        function v4RecordForV1Outcome(outcome: any): Record<string, unknown> {
            const metadata: Record<string, unknown> = {
                id: outcome.flag_id,
                version: outcome.flag_version,
                config_version: 1,
                payload: outcome.payload,
                has_experiment: false,
            }
            if (!isNull(outcome.variant)) {
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

        /** What the legacy getters return for `keys` after the client loads `body`. */
        async function legacyReads(body: unknown, keys: string[]): Promise<Record<string, unknown>> {
            const { flags, load: loadFlags } = await setup()
            await loadFlags(body)
            return Object.fromEntries(
                keys.map((key) => [
                    key,
                    {
                        value: flags.getFeatureFlag(key, { send_event: false }),
                        payload: flags.getFeatureFlagPayload(key) ?? null,
                    },
                ])
            )
        }

        it.each(byId(LEGACY_PROJECTION.cases))(
            'returns the same legacy values for %s from both shapes',
            async (_id, testCase) => {
                const { flags_v2: v2Response, flags_v1: v1Maps } = testCase.projections
                const outcome = testCase.outcome
                const v4Response = {
                    errorsWhileComputingFlags: v2Response.errorsWhileComputingFlags,
                    flags: outcome.omitted ? {} : { [outcome.key]: v4RecordForV1Outcome(outcome) },
                }
                const keys = [outcome.key]

                expect(await legacyReads(v4Response, keys)).toEqual(await legacyReads(v2Response, keys))
                // A failed record of a response that reports errors is not stored, so it has no value.
                if (outcome.key in v1Maps.featureFlags && !outcome.failed) {
                    const payload = v1Maps.featureFlagPayloads[outcome.key]
                    expect(await legacyReads(v4Response, keys)).toEqual({
                        [outcome.key]: {
                            value: v1Maps.featureFlags[outcome.key],
                            payload: isUndefined(payload) ? null : JSON.parse(payload),
                        },
                    })
                }
            }
        )

        const valueSuccessCases = VALUE_CORPUS.cases.filter((testCase: any) => testCase.expected.status === 'success')

        it.each(byId(valueSuccessCases))('renders the legacy cells of %s from both shapes', async (_id, testCase) => {
            const { expected, legacy } = testCase
            const rule = expected.rule
            const reason = {
                code: expected.reason,
                condition_index: rule ? rule.index : null,
                description: 'Evaluated',
            }
            const metadata = { id: 401, version: 3, description: null, has_experiment: false }
            const v2Record = {
                key: 'typed-flag',
                enabled: legacy.enabled,
                variant: legacy.variant,
                reason,
                metadata: { ...metadata, payload: isNull(legacy.payload) ? null : JSON.stringify(legacy.payload) },
            }
            const typedRecord = {
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

            for (const record of [v2Record, typedRecord]) {
                const { flags, client, load: loadFlags } = await setup()
                await loadFlags(envelope({ 'typed-flag': record }))

                expect(client.kv.get('$enabled_feature_flags')).toEqual({ 'typed-flag': legacy.value })
                // Only an enabled flag has a stored payload, which is null when the flag has none.
                expect(client.kv.get('$feature_flag_payloads')).toEqual(
                    legacy.enabled
                        ? { 'typed-flag': isNull(legacy.payload) ? null : JSON.stringify(legacy.payload) }
                        : {}
                )
                expect(flags.getFeatureFlagResult('typed-flag', { send_event: false })).toEqual({
                    key: 'typed-flag',
                    enabled: legacy.enabled,
                    variant: legacy.variant ?? undefined,
                    payload: legacy.enabled ? legacy.payload : undefined,
                })
            }
        })
    })

    describe('stored flag state', () => {
        const split = (overrides: Record<string, unknown> = {}): Record<string, any> =>
            v4Record({
                key: 'split',
                value: 'arm-b',
                'reason.code': 'experiment_split',
                'metadata.rule_type': 'experiment',
                'metadata.variant_key': 'arm-b',
                ...overrides,
            })

        it('stores the typed record under the existing key, and adds no stored key', async () => {
            const typed = await setup()
            await typed.load(envelope({ split: split() }))
            const older = await setup(null)
            await older.load(envelope({ split: olderRecord({ key: 'split', variant: 'arm-b' }) }))

            const storedKeys = (client: TestClient): string[] =>
                [
                    '$active_feature_flags',
                    '$enabled_feature_flags',
                    '$feature_flag_details',
                    '$feature_flag_errors',
                    '$feature_flag_evaluated_at',
                    '$feature_flag_payloads',
                    '$feature_flag_request_id',
                    '$minimal_flag_called_events',
                ].filter((key) => !isUndefined(client.kv.get(key)))

            expect(typedFlagDetailOf(storedDetails(typed.client).split)).toMatchObject({
                value: 'arm-b',
                metadata: { config_version: 2, rule_type: 'experiment', rule_id: RULE_ID, variant_key: 'arm-b' },
            })
            expect(storedKeys(typed.client)).toEqual(storedKeys(older.client))
            for (const key of ['$active_feature_flags', '$enabled_feature_flags', '$feature_flag_payloads']) {
                expect(typed.client.kv.get(key)).toEqual(older.client.kv.get(key))
            }
        })

        it('keeps the typed record of a flag whose next record failed, when the response reports errors', async () => {
            const { flags, client, load: loadFlags } = await setup()
            await loadFlags(envelope({ split: split(), other: v4Record({ key: 'other' }) }))

            await loadFlags(
                envelope(
                    {
                        split: split({ value: null, failed: true, 'reason.code': 'error' }),
                        other: v4Record({ key: 'other', value: 'wide' }),
                    },
                    { errorsWhileComputingFlags: true }
                )
            )

            expect(flags.getFeatureFlag('split', { send_event: false })).toBe('arm-b')
            expect(typedFlagDetailOf(storedDetails(client).split)).toMatchObject({
                value: 'arm-b',
                reason: { code: 'experiment_split' },
            })
            expect(typedFlagDetailOf(storedDetails(client).other)).toMatchObject({ value: 'wide' })
        })

        it('keeps the cached flag of a record that cannot be read, when the response reports errors', async () => {
            const { flags, client, load: loadFlags } = await setup()
            await loadFlags(envelope({ split: split() }))

            await loadFlags(envelope({ split: split({ 'metadata.rule_id': 3 }) }, { errorsWhileComputingFlags: true }))

            expect(flags.getFeatureFlag('split', { send_event: false })).toBe('arm-b')
            expect(typedFlagDetailOf(storedDetails(client).split)).toMatchObject({ value: 'arm-b' })
        })

        it('replaces the cached flag with a record that cannot be read, in a complete response', async () => {
            const { flags, client, load: loadFlags } = await setup()
            await loadFlags(envelope({ split: split() }))

            await loadFlags(envelope({ split: split({ 'metadata.rule_id': 3 }) }))

            expect(flags.getFeatureFlag('split', { send_event: false })).toBe(false)
            expect(storedDetails(client).split).toEqual({ key: 'split', enabled: false, failed: true })
        })

        it('merges the typed records of a survey-only response into the stored flags', async () => {
            const {
                flags,
                client,
                load: loadFlags,
            } = await setup(flagsResponseV4, {
                onlyEvaluateSurveyFeatureFlags: true,
            })
            await loadFlags(envelope({ split: split(), other: v4Record({ key: 'other' }) }))

            await loadFlags(
                envelope({
                    other: v4Record({ key: 'other', value: 12.5 }),
                    survey: v4Record({ key: 'survey', value: true }),
                })
            )

            expect(flags.getFlagVariants()).toEqual({ split: 'arm-b', other: true, survey: true })
            expect(flags.getFlagPayloads()).toEqual({ split: null, other: '12.5', survey: null })
            expect(typedFlagDetailOf(storedDetails(client).split)).toMatchObject({ value: 'arm-b' })
            expect(typedFlagDetailOf(storedDetails(client).other)).toMatchObject({ value: 12.5 })
            expect(typedFlagDetailOf(storedDetails(client).survey)).toMatchObject({ value: true })
        })

        it('replaces the typed records with those of the next complete response', async () => {
            const { client, load: loadFlags } = await setup()
            await loadFlags(envelope({ split: split(), other: v4Record({ key: 'other' }) }))

            await loadFlags(envelope({ split: olderRecord({ key: 'split', variant: 'arm-b' }) }))

            expect(Object.keys(storedDetails(client))).toEqual(['split'])
            expect(typedFlagDetailOf(storedDetails(client).split)).toBeUndefined()
        })

        it('keeps no typed record of bootstrapped flags', async () => {
            const { flags, client } = await setup(flagsResponseV4, {
                bootstrap: { featureFlags: { split: 'arm-a' }, featureFlagPayloads: { split: { columns: 2 } } },
            })

            expect(flags.getFeatureFlag('split', { send_event: false })).toBe('arm-a')
            expect(flags.getFeatureFlagDetails('split')).toBeUndefined()
            expect(storedDetails(client)).toEqual({})
        })

        it('keeps no typed record of flags that updateFlags sets', async () => {
            const { flags, client, load: loadFlags } = await setup()
            await loadFlags(envelope({ split: split() }))

            flags.updateFlags({ other: 'wide' }, undefined, { merge: true })

            expect(flags.getFlagVariants()).toEqual({ split: 'arm-b', other: 'wide' })
            expect(typedFlagDetailOf(storedDetails(client).split)).toBeUndefined()
            expect(typedFlagDetailOf(storedDetails(client).other)).toBeUndefined()
        })

        it('leaves the stored record alone when the flag is overridden', async () => {
            const { flags, client, load: loadFlags } = await setup()
            await loadFlags(envelope({ split: split() }))
            const stored = structuredClone(storedDetails(client).split)

            flags.overrideFeatureFlags({
                flags: { split: 'arm-a' },
                payloads: { split: { forced: true } },
                suppressWarning: true,
            })

            expect(flags.getFeatureFlag('split', { send_event: false })).toBe('arm-a')
            expect(storedDetails(client).split).toEqual(stored)
        })

        it('reads a stored record without a typed value, as an older SDK version stores it', async () => {
            const { flags, client } = await setup()
            const record = olderRecord({ key: 'split', variant: 'arm-b' })
            client.kv.set({
                $active_feature_flags: ['split'],
                $enabled_feature_flags: { split: 'arm-b' },
                $feature_flag_payloads: { split: null },
                $feature_flag_details: { split: record },
            })

            expect(flags.getFeatureFlag('split', { send_event: false })).toBe('arm-b')
            expect(flags.getFeatureFlagDetails('split')).toEqual(record)
            expect(typedFlagDetailOf(flags.getFeatureFlagDetails('split'))).toBeUndefined()
            expect(client.sentRequests).toEqual([])
        })
    })
})
