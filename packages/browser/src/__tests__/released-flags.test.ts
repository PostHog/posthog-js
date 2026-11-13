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

/** A scenario's results with the stored flag records reduced to the members released versions read. */
const comparable = (results: Record<string, any>): Record<string, any> => {
    const reduced = { ...results }
    for (const name of Object.keys(reduced)) {
        if (name.startsWith('stored')) {
            reduced[name] = withLegacyDetails(reduced[name])
        }
    }
    return reduced
}

/** The recording as this source reproduces it: it requests `v=4` where the release requested `v=2`. */
const expected = (recorded: Record<string, any>): Record<string, any> =>
    comparable({ ...recorded, requests: recorded.requests.map((url: string) => url.replace('?v=2', '?v=4')) })

describe.skipIf(recordVersion || !existsSync(RECORDING)).each<Shape>(['v2', 'v4'])(
    'flag results from the %s response',
    (shape) => {
        const released: Results = existsSync(RECORDING) ? JSON.parse(readFileSync(RECORDING, 'utf8')).results : {}
        let results: Results

        beforeAll(async () => {
            results = await run(shape)
        })

        // Every getter result, flag event and callback, and every stored property that a released
        // version reads, is what 1.448.0 returned, sent and stored.
        it.each(Object.keys(released))(`match ${RELEASED_VERSION}: %s`, (scenario) => {
            expect(comparable(results[scenario])).toEqual(expected(released[scenario]))
        })

        it('stores no property that 1.448.0 does not store', () => {
            // A released version adds every stored property it does not know to each event it sends.
            for (const scenario of Object.keys(released)) {
                expect(Object.keys(results[scenario].stored)).toEqual(Object.keys(released[scenario].stored))
            }
        })

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
