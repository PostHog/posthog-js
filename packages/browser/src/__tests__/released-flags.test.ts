import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { typedFlagDetailOf } from '@posthog/browser-common/flags-response-v4'
import { PARITY_FLAGS, quietReads, runAll, startClient, trackedReads, type Shape } from './released-flags-scenarios'

// Flag results, events and stored state pinned to what posthog-js 1.448.0 returned, sent and
// stored, from the v2 response it requests. `released-flags-scenarios.ts` says how the recording
// was made.

type Results = Record<string, Record<string, any>>

const RELEASED_VERSION = '1.448.0'
const recordingOf = (version: string): string => path.resolve(__dirname, `fixtures/released-flags-${version}.json`)
const RECORDING = recordingOf(RELEASED_VERSION)
const recordVersion = process.env.RECORD_RELEASED_FLAGS

const run = async (shape: Shape): Promise<Results> => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
        return await runAll(shape)
    } finally {
        vi.restoreAllMocks()
        vi.useRealTimers()
    }
}

describe.runIf(recordVersion)('recording the released flag results', () => {
    it('writes the recording', async () => {
        const results = await run('v2')
        writeFileSync(
            recordingOf(recordVersion!),
            JSON.stringify({ version: recordVersion, shape: 'v2', results }, null, 2) + '\n'
        )
    })
})

const LEGACY_DETAIL_MEMBERS = [
    'key',
    'enabled',
    'variant',
    'reason',
    'metadata',
    'failed',
    'original_enabled',
    'original_variant',
]
const LEGACY_REASON_MEMBERS = ['code', 'condition_index', 'description']
const LEGACY_METADATA_MEMBERS = ['id', 'version', 'description', 'payload', 'has_experiment', 'original_payload']

// The members of `source` that `names` lists and that have a value. A v2 record carries `null`
// for a member it has no value for, and the rendering of a v4 record leaves that member out.
const pick = (source: Record<string, any> | null | undefined, names: string[]): Record<string, any> | undefined =>
    source
        ? Object.fromEntries(names.filter((name) => source[name] != null).map((name) => [name, source[name]]))
        : undefined

/** The members of a stored flag record that every released version reads. */
const legacyDetail = (detail: Record<string, any>): Record<string, any> => {
    const legacy = pick(detail, LEGACY_DETAIL_MEMBERS)!
    if (legacy.reason) {
        legacy.reason = pick(legacy.reason, LEGACY_REASON_MEMBERS)
    }
    if (legacy.metadata) {
        legacy.metadata = pick(legacy.metadata, LEGACY_METADATA_MEMBERS)
    }
    return legacy
}

const withLegacyDetails = (stored: Record<string, any>): Record<string, any> =>
    stored.$feature_flag_details
        ? {
              ...stored,
              $feature_flag_details: Object.fromEntries(
                  Object.entries<any>(stored.$feature_flag_details).map(([key, detail]) => [key, legacyDetail(detail)])
              ),
          }
        : stored

/**
 * A scenario's results with the stored flag records reduced to the members released versions read.
 * From the v4 response the reported calls of config version 2 flags are stored under other keys,
 * which their own test checks.
 */
const comparable = (results: Record<string, any>, shape: Shape): Record<string, any> => {
    const reduced = { ...results }
    for (const name of Object.keys(reduced)) {
        if (name.startsWith('stored')) {
            reduced[name] = withLegacyDetails(reduced[name])
            if (shape === 'v4') {
                delete reduced[name].$flag_call_reported
            }
        }
    }
    return reduced
}

const RULE_ID = '50000000-0000-4000-8000-000000000001'
const REASON_ONLY = (code: string): Record<string, unknown> => ({
    $feature_flag_config_version: 2,
    $feature_flag_reason_code: code,
})

// What the `$feature_flag_called` of each config version 2 flag in the scenarios carries from the
// v4 response, in place of `$feature_flag_reason`.
const ATTRIBUTION: Record<string, Record<string, unknown>> = {
    'v2-string': {
        ...REASON_ONLY('targeting_match'),
        $feature_flag_rule_id: RULE_ID,
        $feature_flag_rule_type: 'targeted_release',
    },
    'v2-split': {
        ...REASON_ONLY('experiment_split'),
        $feature_flag_rule_id: RULE_ID,
        $feature_flag_rule_type: 'experiment',
        $feature_flag_variant_key: 'arm-b',
    },
    'v2-false': REASON_ONLY('no_rule_match'),
    'v2-null': REASON_ONLY('no_rule_match'),
    // These name no rule, so they report their reason alone.
    'v2-number': REASON_ONLY('targeting_match'),
    'v2-zero': REASON_ONLY('targeting_match'),
    'v2-object': REASON_ONLY('targeting_match'),
    'v2-empty-object': REASON_ONLY('targeting_match'),
    failed: REASON_ONLY('dependency_error'),
}

type RecordedEvent = [event: string, properties: Record<string, any>]

/** Whether the stored record of the flag supplied the value that a recorded call reports. */
const fromItsRecord = (scenario: string, properties: Record<string, any>): boolean =>
    properties.$feature_flag in ATTRIBUTION &&
    // A missing flag has no record.
    '$feature_flag_response' in properties &&
    // A value override replaces the record's value. A payload override does not.
    !('$feature_flag_original_response' in properties) &&
    // A bootstrapped value has no record.
    !(scenario === 'bootstrap' && properties.$used_bootstrap_value)

/**
 * The recorded events as the v4 response changes them. The `$feature_flag_called` of a config
 * version 2 flag reports its config version, reason code and rule in place of the reason
 * description, when the record supplied its value. The call of the experiment split is followed
 * by its `$experiment_exposure`, which is a full event even where the call is minimal. Nothing
 * else changes: the same reads send events, in the same order.
 */
const withConfigVersion2Events = (scenario: string, events: RecordedEvent[]): RecordedEvent[] =>
    events.flatMap(([event, properties]): RecordedEvent[] => {
        if (event !== '$feature_flag_called' || !fromItsRecord(scenario, properties)) {
            return [[event, properties]]
        }
        const { $feature_flag_reason: _reason, ...rest } = properties
        const called: RecordedEvent = [event, { ...rest, ...ATTRIBUTION[properties.$feature_flag] }]
        if (properties.$feature_flag !== 'v2-split') {
            return [called]
        }
        const exposure: Record<string, unknown> = {
            $feature_flag: 'v2-split',
            $feature_flag_response: properties.$feature_flag_response,
            $feature_flag_variant_key: 'arm-b',
            $feature_flag_rule_id: RULE_ID,
            locally_evaluated: false,
        }
        for (const name of [
            '$feature_flag_id',
            '$feature_flag_version',
            '$feature_flag_request_id',
            '$feature_flag_evaluated_at',
        ]) {
            if (name in properties) {
                exposure[name] = properties[name]
            }
        }
        // The scenarios register `plan` as a super property where they check minimal events.
        return [
            called,
            ['$experiment_exposure', scenario === 'minimal events' ? { ...exposure, plan: 'scale' } : exposure],
        ]
    })

/**
 * The recording as this source reproduces it: it requests `v=4` where the release requested `v=2`,
 * and from the v4 response it sends the config version 2 flag events.
 */
const expected = (scenario: string, recorded: Record<string, any>, shape: Shape): Record<string, any> => {
    const reproduced: Record<string, any> = {
        ...recorded,
        requests: recorded.requests.map((url: string) => url.replace('?v=2', '?v=4')),
    }
    if (shape === 'v4') {
        reproduced.events = withConfigVersion2Events(scenario, recorded.events)
        for (const name of ['firstPageEvents', 'eventsBeforeLoad']) {
            if (name in recorded) {
                reproduced[name] = withConfigVersion2Events(scenario, recorded[name])
            }
        }
        if (scenario === 'events dropped by before_send') {
            // The hook sees both events of the split, and discards both.
            reproduced.seen = [...recorded.seen, '$experiment_exposure:v2-split']
        }
        if (scenario === 'identity') {
            // The dedupe keys of both config version 2 events include the groups, so the read after
            // `group()` sends the split's events again. A config version 1 call is deduped by its
            // value alone, as before, and is not sent again.
            const split = reproduced.events.slice(0, 2)
            const afterGroup = reproduced.events.findIndex(([event]: RecordedEvent) => event === '$groupidentify') + 1
            reproduced.events = [
                ...reproduced.events.slice(0, afterGroup),
                ...split,
                ...reproduced.events.slice(afterGroup),
            ]
        }
        if (scenario === 'event controls') {
            // The tracked read of the split sends its exposure too.
            for (const name of ['eventsAfterTrackedRead', 'eventsWhileOptedOut', 'eventsAfterOptIn']) {
                reproduced[name] = recorded[name] + 1
            }
        }
        // The server names the reason of a config version 2 flag by another code at v4.
        for (const name of Object.keys(recorded).filter((member) => member.startsWith('stored'))) {
            const details = recorded[name].$feature_flag_details
            if (!details) {
                continue
            }
            reproduced[name] = {
                ...recorded[name],
                $feature_flag_details: Object.fromEntries(
                    Object.entries<any>(details).map(([key, detail]) => [
                        key,
                        key in ATTRIBUTION && detail.reason
                            ? {
                                  ...detail,
                                  reason: { ...detail.reason, code: ATTRIBUTION[key].$feature_flag_reason_code },
                              }
                            : detail,
                    ])
                ),
            }
        }
    }
    return comparable(reproduced, shape)
}

describe.skipIf(recordVersion || !existsSync(RECORDING)).each<Shape>(['v2', 'v4'])(
    'flag results from the %s response',
    (shape) => {
        const released: Results = existsSync(RECORDING) ? JSON.parse(readFileSync(RECORDING, 'utf8')).results : {}
        let results: Results

        beforeAll(async () => {
            results = await run(shape)
        })

        // Every getter result and callback, and every stored property that a released version
        // reads, is what 1.448.0 returned and stored. So is every flag event from the v2 response.
        // From the v4 response, the flag events of config version 2 flags change as
        // `withConfigVersion2Events` says, and nothing else does.
        it.each(Object.keys(released))(`match ${RELEASED_VERSION}: %s`, (scenario) => {
            expect(comparable(results[scenario], shape)).toEqual(expected(scenario, released[scenario], shape))
        })

        it('stores no property that 1.448.0 does not store', () => {
            // A released version adds every stored property it does not know to each event it sends.
            for (const scenario of Object.keys(released)) {
                expect(Object.keys(results[scenario].stored)).toEqual(Object.keys(released[scenario].stored))
            }
        })

        it(
            shape === 'v4'
                ? 'stores the reported calls of config version 2 flags by their dedupe keys, in the property 1.448.0 uses'
                : 'stores the reported calls as 1.448.0 does',
            () => {
                const reported = results.getters.stored.$flag_call_reported
                const recorded = released.getters.stored.$flag_call_reported
                if (shape === 'v2') {
                    expect(reported).toEqual(recorded)
                    return
                }
                // The calls of config version 1 flags, and of the missing flag, are stored by value as before.
                const called = (response: unknown, ...attribution: (string | null)[]): string =>
                    JSON.stringify([response, [], 2, ...attribution])
                expect(reported).toEqual({
                    ...recorded,
                    'v2-string': [called('compact', 'targeting_match', RULE_ID, 'targeted_release', null)],
                    'v2-split': [
                        called('arm-b', 'experiment_split', RULE_ID, 'experiment', 'arm-b'),
                        JSON.stringify(['$experiment_exposure', [], 2, RULE_ID, 'arm-b']),
                    ],
                    'v2-false': [called(false, 'no_rule_match', null, null, null)],
                    'v2-null': [called(false, 'no_rule_match', null, null, null)],
                    'v2-number': [called(true, 'targeting_match', null, null, null)],
                    'v2-zero': [called(true, 'targeting_match', null, null, null)],
                    'v2-object': [called(true, 'targeting_match', null, null, null)],
                    'v2-empty-object': [called(true, 'targeting_match', null, null, null)],
                })
            }
        )

        it(
            shape === 'v4'
                ? 'keeps the typed value and rule metadata beside each stored flag record'
                : 'stores each flag record as the server sent it',
            () => {
                const details = results.getters.stored.$feature_flag_details
                if (shape === 'v2') {
                    expect(details).toEqual(released.getters.stored.$feature_flag_details)
                    return
                }
                expect(details['v2-split']).toMatchObject({
                    enabled: true,
                    variant: 'arm-b',
                    value: 'arm-b',
                    metadata: {
                        config_version: 2,
                        rule_type: 'experiment',
                        rule_id: '50000000-0000-4000-8000-000000000001',
                        variant_key: 'arm-b',
                    },
                })
                expect(details['v2-number']).toMatchObject({
                    enabled: true,
                    value: 12.5,
                    metadata: { payload: '12.5' },
                })
                expect(details['v2-null']).toMatchObject({ enabled: false, value: null })
                expect(details['bool-on']).toMatchObject({
                    enabled: true,
                    value: true,
                    metadata: { config_version: 1 },
                })
            }
        )
    }
)

describe.skipIf(recordVersion || !existsSync(RECORDING))('flag state that 1.448.0 stored', () => {
    const released: Results = existsSync(RECORDING) ? JSON.parse(readFileSync(RECORDING, 'utf8')).results : {}

    beforeEach(() => {
        vi.useFakeTimers()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    // The page that 1.448.0 loaded stored its flags and reported some reads. The next page loads
    // this source, which reads that state before its own response arrives.
    it('is read as 1.448.0 read it, with no typed record and no request', async () => {
        const recorded = released.getters
        const { $flag_call_reported: _reported, ...storedFlags } = recorded.stored
        const persistenceName = `released-flags-${uuidv7()}`
        window.localStorage.setItem(`ph_${persistenceName}`, JSON.stringify(storedFlags))
        const keys = [...PARITY_FLAGS.map((flag) => flag.key), 'missing']

        const client = await startClient({}, persistenceName)
        const reads = quietReads(client.posthog, keys)
        const tracked = trackedReads(client.posthog, keys)

        for (const name of Object.keys(reads)) {
            expect([name, reads[name]]).toEqual([name, recorded[name]])
        }
        expect(tracked).toEqual(recorded.tracked)
        // The reads send the events that 1.448.0 sent for the same stored flags.
        expect(client.events).toEqual(
            recorded.events
                .filter(([event]: [string]) => event === '$feature_flag_called')
                .map(([event, properties]: [string, Record<string, unknown>]) => [
                    event,
                    // The page has not loaded flags itself yet.
                    { ...properties, $used_bootstrap_value: true },
                ])
        )
        const details = client.stored().$feature_flag_details as Record<string, any>
        expect(Object.keys(details)).toEqual(Object.keys(recorded.stored.$feature_flag_details))
        expect(Object.values(details).map((detail) => typedFlagDetailOf(detail))).toEqual(
            Object.values(details).map(() => undefined)
        )
        expect(client.requests).toEqual([])
        await client.close()
    })
})
