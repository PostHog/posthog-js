import { readFileSync } from 'node:fs'
import path from 'node:path'

import Ajv2020 from 'ajv/dist/2020'

import { isUndefined } from '@posthog/core'
import { PostHogFeatureFlags, type FlagsResponseFormat } from '../src/feature-flags'
import type { FeatureFlagsConfig, FeatureFlagsConfigSource } from '../src/feature-flags-config'
import { ruleAttribution } from '../src/flag-events'
import { flagsResponseV4, readFlagRecords } from '../src/flags-response-v4'
import { createTestClient, type TestCapturedEvent, type TestClient } from './helpers/test-client'

// `$experiment_exposure` and the attribution of `$feature_flag_called`. A stored config version 2
// record that assigns an experiment variant sends `$experiment_exposure` next to its
// `$feature_flag_called`, and every config version 2 record adds its rule attribution to
// `$feature_flag_called`. The reader fixtures and event schemas are the ones posthog-node vendors
// unchanged from a released PostHog/posthog-sdk-test-harness contract; its `SOURCE.json` records
// the release and the digest of each file, and `flags-response-v4.spec.ts` checks them.

const FIXTURES = path.resolve(__dirname, '../../node/src/__tests__/fixtures/feature_flag_rules_v2')
const load = (name: string): any => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))

const READERS = load('readers.json')

const FLAG = 'pricing-page'
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
    '$feature_flag_variant_key',
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
            Object.entries(properties).filter(([key, value]) => declared.has(key) && !isUndefined(value))
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

function v4Record(code: string | undefined, value: unknown = true, options: RecordOptions = {}): Record<string, any> {
    const metadata: Record<string, any> = {
        id: 77,
        version: 3,
        config_version: options.configVersion ?? 2,
        description: null,
        payload: null,
        has_experiment: options.hasExperiment ?? false,
    }
    if (!isUndefined(options.ruleType)) {
        metadata.rule_type = options.ruleType
    }
    if (!isUndefined(options.ruleId)) {
        metadata.rule_id = options.ruleId
    }
    if (!isUndefined(options.variantKey)) {
        metadata.variant_key = options.variantKey
    }
    const reason: Record<string, any> = { condition_index: options.ruleId ? 0 : null }
    if (!isUndefined(code)) {
        reason.code = code
    }
    if (!isUndefined(options.description)) {
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

function olderRecord(key: string = FLAG): Record<string, any> {
    return {
        key,
        enabled: true,
        variant: 'annual',
        reason: { code: 'condition_match', condition_index: 0, description: 'Matched condition set 1' },
        metadata: { id: 77, version: 3, description: null, payload: null, has_experiment: true },
    }
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

const readerResponse = (source: string): any =>
    source.startsWith('readers.')
        ? build(
              READERS,
              READERS.cases.find((testCase: any) => testCase.id === source)
          )
        : build(READERS, { template: source })

// --- Clients and recorded events -----------------------------------------------------------

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

type Harness = {
    flags: PostHogFeatureFlags
    client: TestClient
    events: TestCapturedEvent[]
    load(body: unknown): Promise<void>
}

const instances: PostHogFeatureFlags[] = []

async function setup(
    options: { format?: FlagsResponseFormat | null; config?: Partial<FeatureFlagsConfig>; client?: TestClient } = {}
): Promise<Harness> {
    const config: FeatureFlagsConfig = {
        bootstrap: {},
        remoteRequestsDisabled: false,
        featureFlagsDisabled: false,
        onlyEvaluateSurveyFeatureFlags: false,
        deduplicateCallsPerSession: false,
        idleRefreshBackoff: false,
        requestTimeoutMs: 3000,
        evaluationContexts: [],
        ...options.config,
    }
    const client = options.client ?? createTestClient()
    const format = isUndefined(options.format) ? flagsResponseV4 : options.format
    const flags = format
        ? new OptedInFeatureFlags({ get: () => config }, format)
        : new PostHogFeatureFlags({ get: () => config })
    instances.push(flags)
    await flags.setup(client)
    return {
        flags,
        client,
        events: client.capturedEvents,
        async load(body: unknown): Promise<void> {
            vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: structuredClone(body) })
            flags.reloadFeatureFlags()
            await vi.advanceTimersByTimeAsync(10)
        },
    }
}

type Read = (flags: PostHogFeatureFlags, key: string) => unknown

// Every read that sends flag events.
const READS: Record<string, Read> = {
    getFeatureFlag: (flags, key) => flags.getFeatureFlag(key),
    isFeatureEnabled: (flags, key) => flags.isFeatureEnabled(key),
    getFeatureFlagResult: (flags, key) => flags.getFeatureFlagResult(key),
}
const PATHS = Object.keys(READS)

/** Loads `body` on a new client, reads `key` `reads` times through `readPath`, and returns its events. */
async function readEvents(
    readPath: string,
    body: unknown,
    options: { key?: string; reads?: number } = {}
): Promise<TestCapturedEvent[]> {
    const harness = await setup()
    await harness.load(body)
    for (let i = 0; i < (options.reads ?? 1); i++) {
        READS[readPath]!(harness.flags, options.key ?? FLAG)
    }
    return harness.events
}

const named = (events: TestCapturedEvent[], name: string, key: string = FLAG): TestCapturedEvent[] =>
    events.filter((event) => event.event === name && event.properties.$feature_flag === key)

const eventNames = (events: TestCapturedEvent[]): string[] => events.map((event) => event.event)

const attribution = (properties: Record<string, any>): Record<string, any> =>
    Object.fromEntries(
        ATTRIBUTION_PROPERTIES.filter((name) => !isUndefined(properties[name])).map((name) => [name, properties[name]])
    )

/** The properties of an event that the flags code sets, without the ones every event carries. */
const own = (properties: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
        Object.entries(properties).filter(
            ([name, value]) =>
                !isUndefined(value) &&
                !name.startsWith('$feature/') &&
                !['$active_feature_flags', '$feature_flag_payloads'].includes(name)
        )
    )

const storedReports = (client: TestClient): Record<string, string[]> => client.kv.get('$flag_call_reported') ?? {}

// The attribution of a split's `$feature_flag_called`.
const EXPECTED_ATTRIBUTION = {
    $feature_flag_config_version: 2,
    $feature_flag_reason_code: 'experiment_split',
    $feature_flag_rule_id: RULE,
    $feature_flag_rule_type: 'experiment',
    $feature_flag_variant_key: 'annual-first',
}

const EXPECTED_EXPOSURE = {
    $feature_flag: FLAG,
    $feature_flag_response: 'annual',
    $feature_flag_variant_key: 'annual-first',
    $feature_flag_rule_id: RULE,
    locally_evaluated: false,
    $feature_flag_id: 77,
    $feature_flag_version: 3,
    $feature_flag_request_id: REQUEST_ID,
    $feature_flag_evaluated_at: EVALUATED_AT,
}

// The dedupe keys of the split, as they are stored.
const SPLIT_CALLED_KEY = JSON.stringify(['annual', [], 2, 'experiment_split', RULE, 'experiment', 'annual-first'])
const SPLIT_EXPOSURE_KEY = JSON.stringify(['$experiment_exposure', [], 2, RULE, 'annual-first'])

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    instances.splice(0).forEach((flags) => flags.dispose())
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('$experiment_exposure', () => {
    describe('the contract reader cases', () => {
        const rows = READERS.cases
            .filter((testCase: any) => testCase.expected === 'reader')
            .flatMap((testCase: any) => PATHS.map((readPath) => [testCase.id, readPath, testCase]))

        it.each(rows)(
            '%s through %s sends an exposure exactly when the contract expects',
            async (_id, readPath, testCase) => {
                const harness = await setup()
                const body = build(READERS, testCase)
                await harness.load(body)
                const expectations = {
                    [testCase.reader.requested_key]: testCase.reader,
                    ...testCase.sibling_expectations,
                }
                for (const key of Object.keys(expectations)) {
                    READS[readPath]!(harness.flags, key)
                }

                for (const [key, expected] of Object.entries<any>(expectations)) {
                    const exposures = named(harness.events, EXPOSURE, key)
                    expect(exposures).toHaveLength(expected.experiment_exposure ? 1 : 0)
                    const calls = named(harness.events, FLAG_CALLED, key)
                    expect(calls).toHaveLength(1)
                    const called = calls[0]!
                    // A failed record of a response that reports errors is not stored: the read keeps
                    // the cached flag, and here there is none.
                    const isStored = !(body.errorsWhileComputingFlags && body.flags[key]?.failed)
                    const configVersion =
                        expected.error_code === 'PARSE_ERROR' || !isStored ? null : expected.config_version
                    expect(called.properties.$feature_flag_config_version).toBe(configVersion === 2 ? 2 : undefined)
                    if (!isUndefined(called.properties.$feature_flag_response)) {
                        checkFlagCalled(called.properties)
                    }
                    for (const exposure of exposures) {
                        checkExposure(exposure.properties)
                        for (const name of EXPOSURE_LEAVES_OUT) {
                            expect(exposure.properties).not.toHaveProperty(name)
                        }
                        expect(exposure.properties.$feature_flag_response).toEqual(
                            called.properties.$feature_flag_response
                        )
                    }
                    for (const event of [called, ...exposures]) {
                        // A flag may be named anything, so `$feature/<key>` is left out.
                        for (const name of Object.keys(event.properties).filter((n) => !n.startsWith('$feature/'))) {
                            for (const part of ['experiment_id', 'holdout', 'seed', 'forced_variant']) {
                                expect(name).not.toContain(part)
                            }
                        }
                    }
                }
            }
        )
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
                    $feature_flag_variant_key: 'arm_a',
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
            ...['no_rule_match', 'missing_group_key'].map((code): [string, Record<string, unknown>] => [
                code,
                { $feature_flag_config_version: 2, $feature_flag_reason_code: code },
            ]),
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

        it.each(ATTRIBUTION_CASES)('%s', async (source, expected) => {
            const events = await readEvents('getFeatureFlagResult', readerResponse(source), { key: 'garden-layout' })

            const called = named(events, FLAG_CALLED, 'garden-layout')[0]!
            expect(attribution(called.properties)).toEqual(expected)
            checkFlagCalled(called.properties)
            expect(named(events, EXPOSURE, 'garden-layout')).toHaveLength(
                '$feature_flag_variant_key' in expected ? 1 : 0
            )
        })

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

        it.each(STRAY_RULE_CASES)(
            'a %s record %j reports no rule (valid outcome: %s)',
            async (code, fields, validOutcome) => {
                const { value, ...options } = { value: false, ...(fields as Record<string, any>) }
                const record = v4Record(code, value, {
                    ruleType: 'experiment',
                    ruleId: RULE,
                    hasExperiment: true,
                    ...options,
                })

                const events = await readEvents('getFeatureFlag', response([record]))

                const called = named(events, FLAG_CALLED)[0]!
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

        it.each([
            ['targeting_match', 'targeted_release'],
            ['targeting_match', 'percentage_rollout'],
            ['rollout_miss', 'percentage_rollout'],
            ['rollout_miss', 'experiment'],
            ['experiment_paused', 'experiment'],
            ['holdout', 'experiment'],
        ])('a %s of a %s rule names its rule', async (code, ruleType) => {
            const events = await readEvents(
                'getFeatureFlag',
                response([v4Record(code, false, { ruleType, ruleId: RULE })])
            )

            const called = named(events, FLAG_CALLED)[0]!
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

        it.each(BROKEN_RULE_PAIRS)('a %s with the rule fields %j sends neither', async (code, fields) => {
            const events = await readEvents('getFeatureFlag', response([v4Record(code, false, fields)]))

            const called = named(events, FLAG_CALLED)[0]!
            expect(attribution(called.properties)).toEqual({
                $feature_flag_config_version: 2,
                $feature_flag_reason_code: code,
            })
            expect(named(events, EXPOSURE)).toEqual([])
            checkFlagCalled(called.properties)
        })

        // A failed record of a response that reports errors is not stored, so it supplies no value.
        it.each(['dependency_error', 'error'])(
            'a failed %s record of a response that reports errors leaves the cached record in charge',
            async (template) => {
                const failed = readerResponse(template)
                expect(failed.errorsWhileComputingFlags).toBe(true)
                expect(failed.flags['garden-layout'].failed).toBe(true)

                // Without a cached flag, the flag is missing.
                const missing = await readEvents('getFeatureFlag', failed, { key: 'garden-layout' })
                expect(eventNames(missing)).toEqual([FLAG_CALLED])
                expect(attribution(missing[0]!.properties)).toEqual({})
                expect(missing[0]!.properties.$feature_flag_error).toBe('errors_while_computing_flags,flag_missing')

                // With one, the read reports the record that still supplies its value.
                const harness = await setup()
                await harness.load(response([split({ key: 'garden-layout' })]))
                await harness.load(failed)
                expect(harness.flags.getFeatureFlag('garden-layout')).toBe('annual')
                expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
                expect(attribution(harness.events[0]!.properties)).toEqual(EXPECTED_ATTRIBUTION)
            }
        )

        it.each(PATHS)('a targeting match that names an experiment rule sends no exposure (%s)', async (readPath) => {
            // Even with a variant key and a linked experiment, a targeting match assigns no variant.
            const record = v4Record('targeting_match', 'annual', {
                ruleType: 'experiment',
                ruleId: RULE,
                variantKey: 'annual-first',
                hasExperiment: true,
            })

            const events = await readEvents(readPath, response([record]))

            expect(named(events, EXPOSURE)).toEqual([])
            expect(attribution(named(events, FLAG_CALLED)[0]!.properties)).toEqual({
                $feature_flag_config_version: 2,
                $feature_flag_reason_code: 'targeting_match',
            })
        })

        it.each(PATHS)('a record from a server without typed values reports no attribution (%s)', async (readPath) => {
            // The record names a rule, as a v4 record would, but has no typed value.
            const record = olderRecord()
            Object.assign(record.metadata, {
                config_version: 2,
                rule_type: 'experiment',
                rule_id: RULE,
                variant_key: 'annual-first',
            })
            record.reason.code = 'experiment_split'

            const events = await readEvents(readPath, response([record]))

            expect(named(events, EXPOSURE)).toEqual([])
            const called = named(events, FLAG_CALLED)[0]!
            expect(attribution(called.properties)).toEqual({})
            expect(called.properties.$feature_flag_reason).toBe('Matched condition set 1')
        })

        it.each([['future_reason'], [undefined], ['']])(
            'the reason code %j is reported as sent, with no rule and no exposure',
            async (code) => {
                const record = v4Record(code, 'annual', {
                    ruleType: 'experiment',
                    ruleId: RULE,
                    variantKey: 'annual-first',
                })

                const events = await readEvents('getFeatureFlag', response([record]))

                expect(attribution(named(events, FLAG_CALLED)[0]!.properties)).toEqual(
                    code
                        ? { $feature_flag_config_version: 2, $feature_flag_reason_code: code }
                        : { $feature_flag_config_version: 2 }
                )
                expect(named(events, EXPOSURE)).toEqual([])
            }
        )

        it.each([['rule-7'], [''], ['7f3c2a108d4e4b6a9c215e0f1a2b3c4d'], [`{${RULE}}`], [`${RULE} `]])(
            'the rule ID %j is not a UUID, so it counts as missing',
            async (ruleId) => {
                const events = await readEvents('getFeatureFlag', response([split({ ruleId })]))

                expect(attribution(named(events, FLAG_CALLED)[0]!.properties)).toEqual({
                    $feature_flag_config_version: 2,
                    $feature_flag_reason_code: 'experiment_split',
                })
                expect(named(events, EXPOSURE)).toEqual([])
            }
        )

        it('keeps an upper-case UUID rule ID', async () => {
            const events = await readEvents('getFeatureFlag', response([split({ ruleId: RULE.toUpperCase() })]))

            expect(named(events, FLAG_CALLED)[0]!.properties.$feature_flag_rule_id).toBe(RULE.toUpperCase())
            expect(named(events, EXPOSURE)[0]!.properties.$feature_flag_rule_id).toBe(RULE.toUpperCase())
        })

        it.each(PATHS)('an empty variant key is a complete split (%s)', async (readPath) => {
            const events = await readEvents(readPath, response([split({ variantKey: '' })]))

            expect(named(events, FLAG_CALLED)[0]!.properties.$feature_flag_variant_key).toBe('')
            expect(named(events, EXPOSURE)[0]!.properties.$feature_flag_variant_key).toBe('')
            checkExposure(named(events, EXPOSURE)[0]!.properties)
        })

        it.each(PATHS)('an experiment ID in the record is not sent (%s)', async (readPath) => {
            const record = split()
            record.metadata.experiment_id = 301

            const events = await readEvents(readPath, response([record]))

            expect(named(events, EXPOSURE)).toHaveLength(1)
            for (const event of events) {
                expect(JSON.stringify(event.properties)).not.toContain('experiment_id')
            }
        })

        it('reads the attribution of a stored record whose members have the wrong types as absent', () => {
            const record = readFlagRecords(response([split()]) as any).body.flags![FLAG] as any
            record.metadata.rule_id = 7
            record.metadata.variant_key = { nested: true }
            record.reason.code = ['experiment_split']

            expect(ruleAttribution(record)).toEqual({
                reasonCode: undefined,
                ruleId: undefined,
                ruleType: undefined,
                variantKey: undefined,
            })
        })

        // Other code, and other SDK versions, write the same storage. A stored member of the wrong
        // type is never sent: the call reports what is left, and the split is not an exposure.
        it.each([
            ['metadata.rule_id', 7, { $feature_flag_config_version: 2, $feature_flag_reason_code: 'experiment_split' }],
            [
                'metadata.variant_key',
                { nested: true },
                { $feature_flag_config_version: 2, $feature_flag_reason_code: 'experiment_split' },
            ],
            ['reason.code', ['experiment_split'], { $feature_flag_config_version: 2 }],
            // Without config version 2, or without the value the read returns, the record gets the
            // call that was sent before.
            ['metadata.config_version', '2', {}],
            ['value', ['annual'], {}],
        ])(
            'a stored record whose %s has the wrong type sends no exposure and no wrong attribution',
            async (memberPath, value, expectedAttribution) => {
                const harness = await setup()
                await harness.load(response([split()]))
                const stored = JSON.parse(JSON.stringify(harness.client.kv.get('$feature_flag_details')))
                const tokens = memberPath.split('.')
                const parent = tokens.slice(0, -1).reduce((target, token) => target[token], stored[FLAG])
                parent[tokens[tokens.length - 1]!] = value
                harness.client.kv.set({ $feature_flag_details: stored })

                expect(harness.flags.getFeatureFlag(FLAG)).toBe('annual')

                expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
                expect(attribution(harness.events[0]!.properties)).toEqual(expectedAttribution)
            }
        )
    })

    describe('$feature_flag_reason', () => {
        it.each([
            ['a split', split({ description: 'Matched rule 1' })],
            [
                'a targeting match',
                v4Record('targeting_match', true, {
                    ruleType: 'targeted_release',
                    ruleId: RULE,
                    description: 'Matched rule 1',
                }),
            ],
            ['a no-rule match', v4Record('no_rule_match', false, { description: 'No rule matched' })],
            ['a failed record', v4Record('error', null, { failed: true, description: 'Evaluation failed' })],
        ])('is left out of the config version 2 call of %s', async (_name, record) => {
            const events = await readEvents('getFeatureFlag', response([record]))

            const called = named(events, FLAG_CALLED)[0]!
            expect(called.properties).not.toHaveProperty('$feature_flag_reason')
            expect(called.properties.$feature_flag_reason_code).toBe(record.reason.code)
        })

        it.each([
            [
                'a config version 1 record',
                v4Record('condition_match', true, { configVersion: 1, description: 'Matched condition set 1' }),
            ],
            ['a record from a server without typed values', olderRecord()],
        ])('is kept on the call of %s', async (_name, record) => {
            const events = await readEvents('getFeatureFlag', response([record]))

            const called = named(events, FLAG_CALLED)[0]!
            expect(called.properties.$feature_flag_reason).toBe('Matched condition set 1')
            expect(called.properties).not.toHaveProperty('$feature_flag_reason_code')
        })
    })

    describe('the events of a split', () => {
        it.each(PATHS)('a split sends both events with exact properties (%s)', async (readPath) => {
            const events = await readEvents(readPath, response([split()]))

            expect(eventNames(events)).toEqual([FLAG_CALLED, EXPOSURE])
            expect(own(events[0]!.properties)).toEqual({
                $feature_flag: FLAG,
                $feature_flag_response: 'annual',
                $feature_flag_payload: null,
                $feature_flag_request_id: REQUEST_ID,
                $feature_flag_evaluated_at: EVALUATED_AT,
                $feature_flag_bootstrapped_response: null,
                $feature_flag_bootstrapped_payload: null,
                $used_bootstrap_value: false,
                $feature_flag_has_experiment: true,
                $feature_flag_version: 3,
                $feature_flag_id: 77,
                ...EXPECTED_ATTRIBUTION,
            })
            expect(own(events[1]!.properties)).toEqual(EXPECTED_EXPOSURE)
            checkFlagCalled(events[0]!.properties)
            checkExposure(events[1]!.properties)
        })

        it.each(PATHS)('a variant whose value is false is still reported (%s)', async (readPath) => {
            const events = await readEvents(readPath, response([split({ value: false })]))

            expect(named(events, FLAG_CALLED)[0]!.properties.$feature_flag_response).toBe(false)
            expect(own(named(events, EXPOSURE)[0]!.properties)).toEqual({
                ...EXPECTED_EXPOSURE,
                $feature_flag_response: false,
            })
        })

        it.each([
            ['a number', 25],
            ['zero', 0],
            ['an object', { layout: 'compact' }],
        ])('a variant whose value is %s reports the legacy rendering', async (_name, value) => {
            const events = await readEvents('getFeatureFlag', response([split({ value })]))

            expect(named(events, FLAG_CALLED)[0]!.properties.$feature_flag_response).toBe(true)
            expect(named(events, EXPOSURE)[0]!.properties.$feature_flag_response).toBe(true)
            checkExposure(named(events, EXPOSURE)[0]!.properties)
        })

        it('does not depend on a linked experiment', async () => {
            const events = await readEvents('getFeatureFlag', response([split({ hasExperiment: false })]))

            expect(named(events, EXPOSURE)).toHaveLength(1)
        })

        it('leaves out the request details the read does not have', async () => {
            const body = response([split()])
            delete body.requestId
            delete body.evaluatedAt
            body.flags[FLAG].metadata.id = null
            body.flags[FLAG].metadata.version = null

            const events = await readEvents('getFeatureFlag', body)

            expect(own(named(events, EXPOSURE)[0]!.properties)).toEqual({
                $feature_flag: FLAG,
                $feature_flag_response: 'annual',
                $feature_flag_variant_key: 'annual-first',
                $feature_flag_rule_id: RULE,
                locally_evaluated: false,
            })
        })
    })

    describe('what sends no exposure', () => {
        it.each(PATHS)('a read with send_event false sends neither event and stores nothing (%s)', async (readPath) => {
            const harness = await setup()
            await harness.load(response([split()]))
            const silent: Record<string, Read> = {
                getFeatureFlag: (flags, key) => flags.getFeatureFlag(key, { send_event: false }),
                isFeatureEnabled: (flags, key) => flags.isFeatureEnabled(key, { send_event: false }),
                getFeatureFlagResult: (flags, key) => flags.getFeatureFlagResult(key, { send_event: false }),
            }

            silent[readPath]!(harness.flags, FLAG)
            expect(harness.events).toEqual([])
            expect(storedReports(harness.client)).toEqual({})

            READS[readPath]!(harness.flags, FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
        })

        it('a payload read sends no flag events', async () => {
            const harness = await setup()
            await harness.load(response([split({ value: { layout: 'compact' } })]))

            expect(harness.flags.getFeatureFlagPayload(FLAG)).toEqual({ layout: 'compact' })
            expect(harness.flags.getAllFeatureFlags()).toHaveLength(1)

            expect(harness.events).toEqual([])
            expect(storedReports(harness.client)).toEqual({})
        })

        it('a bootstrapped value sends the call as before, and the response that replaces it sends both', async () => {
            const harness = await setup({ config: { bootstrap: { featureFlags: { [FLAG]: 'annual' } } } })

            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(attribution(harness.events[0]!.properties)).toEqual({})
            expect(storedReports(harness.client)).toEqual({ [FLAG]: ['annual'] })

            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, FLAG_CALLED, EXPOSURE])
            expect(attribution(harness.events[1]!.properties)).toEqual(EXPECTED_ATTRIBUTION)
        })

        it.each([
            ['another value', 'monthly'],
            // The override is the value now, even when it equals the record's.
            ['the same value', 'annual'],
        ])('a value override to %s sends the call as before', async (_name, overridden) => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.overrideFeatureFlags({ flags: { [FLAG]: overridden }, suppressWarning: true })

            expect(harness.flags.getFeatureFlag(FLAG)).toBe(overridden)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(attribution(harness.events[0]!.properties)).toEqual({})
            // The call of an overridden flag reads its reason from the stored record, as before.
            expect(harness.events[0]!.properties.$feature_flag_reason).toBe('experiment_split')
            expect(storedReports(harness.client)).toEqual({ [FLAG]: [overridden] })

            // The record supplies the value again once the override is gone.
            harness.flags.overrideFeatureFlags(false)
            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, FLAG_CALLED, EXPOSURE])
        })

        // The deprecated `override(true)` and a mistyped `flags` option store a value that is not a
        // map of flags. It overrides no flag, and a read must not fail on it.
        it.each([[true], ['another-flag'], [7]])(
            'a stored override state that is not an object (%j) overrides nothing',
            async (stored) => {
                const harness = await setup()
                await harness.load(
                    response([split(), v4Record('condition_match', true, { key: 'legacy', configVersion: 1 })])
                )
                harness.client.kv.set({ $override_feature_flags: stored })

                expect(harness.flags.getFeatureFlag(FLAG)).toBe('annual')
                expect(harness.flags.getFeatureFlag('legacy')).toBe(true)

                expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE, FLAG_CALLED])
                expect(attribution(harness.events[0]!.properties)).toEqual(EXPECTED_ATTRIBUTION)
            }
        )

        it('an override of another flag leaves the events of this one alone', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.overrideFeatureFlags({ flags: { 'another-flag': true }, suppressWarning: true })

            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
        })

        it('a payload override keeps the exposure of the value the record supplied', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.overrideFeatureFlags({ payloads: { [FLAG]: { forced: true } }, suppressWarning: true })

            expect(harness.flags.getFeatureFlagResult(FLAG)).toEqual({
                key: FLAG,
                enabled: true,
                variant: 'annual',
                payload: { forced: true },
            })

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
            expect(attribution(harness.events[0]!.properties)).toEqual(EXPECTED_ATTRIBUTION)
            expect(own(harness.events[1]!.properties)).toEqual(EXPECTED_EXPOSURE)
        })

        it('a value that updateFlags sets sends the call as before', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.updateFlags({ [FLAG]: 'annual' })

            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(attribution(harness.events[0]!.properties)).toEqual({})
        })

        it('a stored value that its stored record did not supply sends the call as before', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            // Early access enrollment writes the stored value and leaves the stored record alone.
            harness.flags.updateEarlyAccessFeatureEnrollment(FLAG, false)
            harness.events.length = 0

            expect(harness.flags.getFeatureFlag(FLAG)).toBe(false)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(attribution(harness.events[0]!.properties)).toEqual({})
        })

        it('a record that an older SDK version stored sends the call as before, and no request', async () => {
            const harness = await setup()
            harness.client.kv.set({
                $active_feature_flags: [FLAG],
                $enabled_feature_flags: { [FLAG]: 'annual' },
                $feature_flag_payloads: { [FLAG]: null },
                $feature_flag_details: { [FLAG]: olderRecord() },
            })

            expect(harness.flags.getFeatureFlag(FLAG)).toBe('annual')

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(attribution(harness.events[0]!.properties)).toEqual({})
            expect(harness.events[0]!.properties.$feature_flag_reason).toBe('Matched condition set 1')
            expect(harness.client.sentRequests).toEqual([])
        })

        it('a missing flag sends the call as before', async () => {
            const harness = await setup()
            await harness.load(response([split()]))

            harness.flags.getFeatureFlag('another-flag')

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(harness.events[0]!.properties.$feature_flag_error).toBe('flag_missing')
            expect(attribution(harness.events[0]!.properties)).toEqual({})
        })

        it('a client that does not opt in sends the call as before, whatever the stored record holds', async () => {
            const typed = await setup()
            await typed.load(response([split()]))
            // The same stored state, read by a client that keeps the v2 response format.
            const harness = await setup({ format: null, client: typed.client })

            expect(harness.flags.getFeatureFlag(FLAG)).toBe('annual')

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(attribution(harness.events[0]!.properties)).toEqual({})
            expect(storedReports(harness.client)).toEqual({ [FLAG]: ['annual'] })
        })
    })

    describe('dedupe', () => {
        it('repeated reads through every getter send each event once', async () => {
            const harness = await setup()
            await harness.load(response([split()]))

            for (let i = 0; i < 3; i++) {
                for (const readPath of PATHS) {
                    READS[readPath]!(harness.flags, FLAG)
                }
            }

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
        })

        it('stores both keys under the flag, next to the values of config version 1 calls', async () => {
            const harness = await setup()
            await harness.load(
                response([split(), v4Record('condition_match', true, { key: 'legacy', configVersion: 1 })])
            )

            harness.flags.getFeatureFlag(FLAG)
            harness.flags.getFeatureFlag('legacy')
            harness.flags.getFeatureFlag('missing')

            expect(storedReports(harness.client)).toEqual({
                [FLAG]: [SPLIT_CALLED_KEY, SPLIT_EXPOSURE_KEY],
                // A config version 1 call is stored by its value, as before.
                legacy: ['true'],
                missing: ['undefined'],
            })
        })

        it.each(PATHS)('equal-valued variants are each reported (%s)', async (readPath) => {
            const harness = await setup()
            await harness.load(response([split({ value: true, variantKey: 'control' })]))
            READS[readPath]!(harness.flags, FLAG)
            await harness.load(response([split({ value: true, variantKey: 'test' })]))
            READS[readPath]!(harness.flags, FLAG)

            expect(named(harness.events, FLAG_CALLED).map((e) => e.properties.$feature_flag_variant_key)).toEqual([
                'control',
                'test',
            ])
            expect(named(harness.events, EXPOSURE).map((e) => e.properties.$feature_flag_variant_key)).toEqual([
                'control',
                'test',
            ])
        })

        it('a later experiment on the flag is reported again', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)
            await harness.load(response([split({ ruleId: OTHER_RULE })]))
            harness.flags.getFeatureFlag(FLAG)

            expect(named(harness.events, EXPOSURE).map((e) => e.properties.$feature_flag_rule_id)).toEqual([
                RULE,
                OTHER_RULE,
            ])
            expect(named(harness.events, FLAG_CALLED)).toHaveLength(2)
        })

        it('the exposure dedupe leaves out the value, the request and the evaluation time', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)
            // The same assignment with another value, from another request.
            await harness.load(
                response([split({ value: 'yearly' })], { requestId: OTHER_REQUEST_ID, evaluatedAt: EVALUATED_AT + 1 })
            )
            harness.flags.getFeatureFlag(FLAG)

            expect(named(harness.events, FLAG_CALLED).map((e) => e.properties.$feature_flag_response)).toEqual([
                'annual',
                'yearly',
            ])
            expect(named(harness.events, EXPOSURE)).toHaveLength(1)
        })

        it('a holdout and a split of one rule are both reported', async () => {
            const harness = await setup()
            await harness.load(response([v4Record('holdout', 'annual', { ruleType: 'experiment', ruleId: RULE })]))
            harness.flags.getFeatureFlag(FLAG)
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)

            expect(named(harness.events, FLAG_CALLED).map((e) => e.properties.$feature_flag_reason_code)).toEqual([
                'holdout',
                'experiment_split',
            ])
            expect(named(harness.events, EXPOSURE)).toHaveLength(1)
        })

        it('moving a flag to config version 2 reports it again', async () => {
            const harness = await setup()
            await harness.load(response([v4Record('condition_match', 'annual', { configVersion: 1 })]))
            harness.flags.getFeatureFlag(FLAG)
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, FLAG_CALLED, EXPOSURE])
            expect(storedReports(harness.client)[FLAG]).toEqual(['annual', SPLIT_CALLED_KEY, SPLIT_EXPOSURE_KEY])
        })

        it('groups are part of both keys, in any order', async () => {
            const client = createTestClient({ groups: { company: 'acme', team: 'growth' } })
            const harness = await setup({ client })
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)
            // The same groups, set in another order.
            client.groups = { team: 'growth', company: 'acme' }
            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])

            client.groups = { company: 'another', team: 'growth' }
            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE, FLAG_CALLED, EXPOSURE])
            const groups = [
                ['company', 'acme'],
                ['team', 'growth'],
            ]
            expect(storedReports(client)[FLAG]!.slice(0, 2)).toEqual([
                JSON.stringify(['annual', groups, 2, 'experiment_split', RULE, 'experiment', 'annual-first']),
                JSON.stringify(['$experiment_exposure', groups, 2, RULE, 'annual-first']),
            ])
        })

        it('a reported call never suppresses its exposure, and the reverse', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)

            // The call is still reported, and the exposure is not.
            harness.client.kv.set({ $flag_call_reported: { [FLAG]: [SPLIT_CALLED_KEY] } })
            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE, EXPOSURE])

            harness.client.kv.set({ $flag_call_reported: { [FLAG]: [SPLIT_EXPOSURE_KEY] } })
            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE, EXPOSURE, FLAG_CALLED])
        })

        it('a flags reload does not repeat either event', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)
            await harness.load(response([split()], { requestId: OTHER_REQUEST_ID, evaluatedAt: EVALUATED_AT + 1 }))
            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
        })

        it('the next page load does not repeat either event', async () => {
            const first = await setup()
            await first.load(response([split()]))
            first.flags.getFeatureFlag(FLAG)
            // The stored flags and reported calls go through storage as JSON.
            const stored = JSON.parse(
                JSON.stringify(
                    Object.fromEntries(
                        [
                            '$enabled_feature_flags',
                            '$feature_flag_payloads',
                            '$feature_flag_details',
                            '$feature_flag_request_id',
                            '$feature_flag_evaluated_at',
                            '$flag_call_reported',
                        ].map((key) => [key, first.client.kv.get(key)])
                    )
                )
            )

            const next = await setup()
            next.client.kv.set(stored)
            expect(next.flags.getFeatureFlag(FLAG)).toBe('annual')
            expect(next.events).toEqual([])

            // A page that has not reported the read sends both events from the stored record.
            const fresh = await setup()
            fresh.client.kv.set({ ...stored, $flag_call_reported: {} })
            fresh.flags.getFeatureFlag(FLAG)
            expect(eventNames(fresh.events)).toEqual([FLAG_CALLED, EXPOSURE])
            expect(own(fresh.events[1]!.properties)).toEqual(EXPECTED_EXPOSURE)
        })

        it('an identity change clears both keys', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)

            harness.flags.resetFlagCallReported()
            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE, FLAG_CALLED, EXPOSURE])
        })

        it('with per-session dedupe, a new session reports both events again', async () => {
            const client = createTestClient()
            const harness = await setup({ client, config: { deduplicateCallsPerSession: true } })
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)
            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])

            client.session = { ...client.session!, sessionId: 'another-session' }
            harness.flags.getFeatureFlag(FLAG)
            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE, FLAG_CALLED, EXPOSURE])
            expect(storedReports(client)).toEqual({ [FLAG]: [SPLIT_CALLED_KEY, SPLIT_EXPOSURE_KEY] })
            expect(client.kv.get('$flag_call_reported_session_id')).toBe('another-session')
        })

        it('an older SDK version that shares the storage reads and writes its values as before', async () => {
            const harness = await setup()
            await harness.load(response([split()]))
            harness.flags.getFeatureFlag(FLAG)

            // An older version does not find its value among the keys, reports the read, and adds the value.
            const reported = storedReports(harness.client)[FLAG]!
            expect(reported.includes(String('annual'))).toBe(false)
            harness.client.kv.set({ $flag_call_reported: { [FLAG]: [...reported, 'annual'] } })

            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
        })
    })

    describe('capture failures', () => {
        /** A client whose capture runs `fail` for the events named `event`, the first `times` times. */
        function failing(event: string, fail: () => boolean, times: number = 1): TestClient {
            const client = createTestClient()
            const capture = client.capture.bind(client)
            let left = times
            vi.spyOn(client, 'capture').mockImplementation((name, properties, options) => {
                if (name === event && left > 0) {
                    left--
                    return fail()
                }
                return capture(name, properties, options)
            })
            return client
        }

        const throws = (): boolean => {
            throw new Error('capture failed')
        }

        it.each([FLAG_CALLED, EXPOSURE])(
            'a %s whose capture throws keeps no key, and the read returns',
            async (event) => {
                const client = failing(event, throws)
                const error = vi.spyOn(client.logger, 'error')
                const harness = await setup({ client })
                await harness.load(response([split()]))

                expect(harness.flags.getFeatureFlag(FLAG)).toBe('annual')

                // The other event is sent and keeps its key.
                const other = event === FLAG_CALLED ? EXPOSURE : FLAG_CALLED
                expect(eventNames(harness.events)).toEqual([other])
                expect(storedReports(client)[FLAG]).toEqual([
                    other === EXPOSURE ? SPLIT_EXPOSURE_KEY : SPLIT_CALLED_KEY,
                ])

                // The next read sends the event that failed, and only that one.
                harness.flags.getFeatureFlag(FLAG)
                expect(eventNames(harness.events)).toEqual([other, event])
                harness.flags.getFeatureFlag(FLAG)
                expect(harness.events).toHaveLength(2)
                expect(error).toHaveBeenCalledTimes(1)
            }
        )

        it.each([FLAG_CALLED, EXPOSURE])(
            'a %s whose capture always throws is tried twice, not on every read',
            async (event) => {
                const client = failing(event, throws, Infinity)
                const harness = await setup({ client })
                await harness.load(response([split()]))
                const attempts = (): number =>
                    vi.mocked(client.capture).mock.calls.filter(([name]) => name === event).length

                for (let i = 0; i < 10; i++) {
                    expect(harness.flags.getFeatureFlag(FLAG)).toBe('annual')
                }
                // Each capture uses a rate limit token, so a render loop must not capture on every read.
                expect(attempts()).toBe(2)
                const other = event === FLAG_CALLED ? EXPOSURE : FLAG_CALLED
                expect(eventNames(harness.events)).toEqual([other])
                expect(storedReports(client)[FLAG]).toEqual([
                    other === EXPOSURE ? SPLIT_EXPOSURE_KEY : SPLIT_CALLED_KEY,
                ])

                // The event is tried again for the next identity, as on the next page.
                harness.flags.resetFlagCallReported()
                harness.flags.getFeatureFlag(FLAG)
                expect(attempts()).toBe(3)
            }
        )

        it.each([FLAG_CALLED, EXPOSURE])(
            'a %s that the client rate limit drops keeps no key and is sent with the next capture',
            async (event) => {
                const client = failing(event, () => false)
                const harness = await setup({ client })
                await harness.load(response([split()]))

                harness.flags.getFeatureFlag(FLAG)
                const other = event === FLAG_CALLED ? EXPOSURE : FLAG_CALLED
                expect(eventNames(harness.events)).toEqual([other])
                expect(storedReports(client)[FLAG]).toEqual([
                    other === EXPOSURE ? SPLIT_EXPOSURE_KEY : SPLIT_CALLED_KEY,
                ])

                // The client calls this after each event it accepts.
                harness.flags.sendFlagCallsPendingCapture()

                expect(eventNames(harness.events)).toEqual([other, event])
                expect(storedReports(client)[FLAG]!.slice().sort()).toEqual(
                    [SPLIT_EXPOSURE_KEY, SPLIT_CALLED_KEY].sort()
                )
            }
        )

        it('a read while capture is off sends nothing, stores nothing, and is sent when capture is on', async () => {
            const client = createTestClient({ canCapture: false })
            const harness = await setup({ client })
            await harness.load(response([split()]))

            expect(harness.flags.getFeatureFlag(FLAG)).toBe('annual')
            expect(harness.events).toEqual([])
            expect(storedReports(client)).toEqual({})

            client.canCapture = true
            harness.flags.sendFlagCallsPendingCapture()

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
            expect(storedReports(client)[FLAG]).toEqual([SPLIT_CALLED_KEY, SPLIT_EXPOSURE_KEY])
        })

        it('a read that was held is dropped when the flag reports another assignment by then', async () => {
            const client = createTestClient({ canCapture: false })
            const harness = await setup({ client })
            await harness.load(response([split({ value: true, variantKey: 'control' })]))
            harness.flags.getFeatureFlag(FLAG)

            // The value is the same, and the assignment is not.
            await harness.load(response([split({ value: true, variantKey: 'test' })]))
            client.canCapture = true
            harness.flags.sendFlagCallsPendingCapture()

            expect(harness.events).toEqual([])
        })

        it('capture that is turned off while the call is captured keeps no exposure key', async () => {
            const client = createTestClient()
            const capture = client.capture.bind(client)
            let optsOut = true
            vi.spyOn(client, 'capture').mockImplementation((name, properties, options) => {
                if (!client.canCapture) {
                    // The client drops an event while capture is off, and says nothing.
                    return true
                }
                const result = capture(name, properties, options)
                if (name === FLAG_CALLED && optsOut) {
                    // The application opts out from a hook that runs while the call is captured.
                    optsOut = false
                    client.canCapture = false
                }
                return result
            })
            const harness = await setup({ client })
            await harness.load(response([split()]))

            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(storedReports(client)[FLAG]).toEqual([])

            client.canCapture = true
            harness.flags.sendFlagCallsPendingCapture()

            // The call may be sent twice. The exposure is not lost.
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, FLAG_CALLED, EXPOSURE])
        })

        it('a read that was held with a bootstrapped value is sent when a record supplies the same value by then', async () => {
            const client = createTestClient({ canCapture: false })
            const harness = await setup({ client, config: { bootstrap: { featureFlags: { [FLAG]: 'annual' } } } })
            expect(harness.flags.getFeatureFlag(FLAG)).toBe('annual')

            await harness.load(response([split()]))
            client.canCapture = true
            harness.flags.sendFlagCallsPendingCapture()

            // The user saw this value, and the record that supplies it now reports the read.
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
            expect(attribution(harness.events[0]!.properties)).toEqual(EXPECTED_ATTRIBUTION)
        })

        it('a read of the flag while its call is captured does not send a second exposure', async () => {
            const client = createTestClient()
            const harness = await setup({ client })
            const capture = client.capture.bind(client)
            let nested = true
            vi.spyOn(client, 'capture').mockImplementation((name, properties, options) => {
                if (name === FLAG_CALLED && nested) {
                    // A hook that runs while the call is captured reads the flag itself.
                    nested = false
                    harness.flags.getFeatureFlag(FLAG)
                }
                return capture(name, properties, options)
            })
            await harness.load(response([split()]))

            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events).sort()).toEqual([EXPOSURE, FLAG_CALLED].sort())
            expect(storedReports(client)[FLAG]).toEqual([SPLIT_CALLED_KEY, SPLIT_EXPOSURE_KEY])
        })

        it('an identity change while the call is captured sends no exposure for the earlier identity', async () => {
            const client = createTestClient()
            const harness = await setup({ client })
            const capture = client.capture.bind(client)
            vi.spyOn(client, 'capture').mockImplementation((name, properties, options) => {
                const result = capture(name, properties, options)
                if (name === FLAG_CALLED) {
                    // A hook that runs while the call is captured identifies the user.
                    client.distinctId = 'another-visitor'
                }
                return result
            })
            await harness.load(response([split()]))

            harness.flags.getFeatureFlag(FLAG)

            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(storedReports(client)[FLAG]).toEqual([SPLIT_CALLED_KEY])
        })

        it('a config version 1 call whose capture throws keeps its mark, as before', async () => {
            const client = failing(FLAG_CALLED, throws)
            const harness = await setup({ client })
            await harness.load(response([v4Record('condition_match', 'annual', { configVersion: 1 })]))

            harness.flags.getFeatureFlag(FLAG)
            harness.flags.getFeatureFlag(FLAG)

            expect(harness.events).toEqual([])
            expect(storedReports(client)).toEqual({ [FLAG]: ['annual'] })
        })
    })

    describe('how the client captures each event', () => {
        it('names what each event never carries, for the properties object it is captured with', async () => {
            const client = createTestClient()
            const captures: unknown[] = []
            const harness = await setup({ client })
            const capture = client.capture.bind(client)
            vi.spyOn(client, 'capture').mockImplementation((name, properties, options) => {
                const flagEvent = harness.flags.flagEventCapture(properties)
                captures.push([name, flagEvent && { omit: flagEvent.omit, keep: flagEvent.keep }])
                return capture(name, properties, options)
            })
            await harness.load(
                response([split(), v4Record('no_rule_match', false, { key: 'no-rule' }), olderRecord('older')])
            )

            harness.flags.getFeatureFlag(FLAG)
            harness.flags.getFeatureFlag('no-rule')
            harness.flags.getFeatureFlag('older')

            expect(captures).toEqual([
                [
                    FLAG_CALLED,
                    {
                        // The split reports its whole attribution, so only the other names are left.
                        omit: ['$feature_flag_reason', '$feature_flag_forced_variant', '$feature_flag_experiment_id'],
                        keep: ATTRIBUTION_PROPERTIES,
                    },
                ],
                [
                    EXPOSURE,
                    {
                        omit: [
                            '$feature_flag_config_version',
                            '$feature_flag_reason_code',
                            '$feature_flag_rule_type',
                            '$experiment_exposure_source',
                            '$feature_flag_experiment_id',
                            '$feature_flag_forced_variant',
                        ],
                        keep: [],
                    },
                ],
                [
                    FLAG_CALLED,
                    {
                        // A record that names no rule must not get one from a super property.
                        omit: [
                            '$feature_flag_rule_id',
                            '$feature_flag_rule_type',
                            '$feature_flag_variant_key',
                            '$feature_flag_reason',
                            '$feature_flag_forced_variant',
                            '$feature_flag_experiment_id',
                        ],
                        keep: ATTRIBUTION_PROPERTIES,
                    },
                ],
                // A config version 1 call is captured as before.
                [FLAG_CALLED, undefined],
            ])
            expect(harness.flags.flagEventCapture({})).toBeUndefined()
            expect(harness.flags.flagEventCapture(null)).toBeUndefined()
        })

        it('a hook that throws while the event is captured keeps no key', async () => {
            const client = createTestClient()
            const harness = await setup({ client })
            const capture = client.capture.bind(client)
            let failures = 1
            vi.spyOn(client, 'capture').mockImplementation((name, properties, options) => {
                if (name === EXPOSURE && failures > 0) {
                    failures--
                    // The client catches the error of a hook, drops the event, and reports the failure.
                    harness.flags.flagEventCapture(properties)?.failed?.()
                    return true
                }
                return capture(name, properties, options)
            })
            await harness.load(response([split()]))

            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED])
            expect(storedReports(client)[FLAG]).toEqual([SPLIT_CALLED_KEY])

            harness.flags.getFeatureFlag(FLAG)
            expect(eventNames(harness.events)).toEqual([FLAG_CALLED, EXPOSURE])
        })
    })
})
