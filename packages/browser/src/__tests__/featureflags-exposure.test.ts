import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import type { PostHog } from '../posthog-core'
import type { CaptureResult, PostHogConfig } from '../types'
import { createPosthogInstance } from './helpers/posthog-instance'

// The config version 2 flag events through the real capture pipeline: super properties, minimal
// events, `before_send`, consent and identity. `flag-events.spec.ts` in browser-common covers which
// reads send which event, and `released-flags.test.ts` covers the released behaviour around them.

const FLAG = 'pricing-page'
const RULE = '7f3c2a10-8d4e-4b6a-9c21-5e0f1a2b3c4d'
const REQUEST_ID = '5d1e2f30-4a5b-4c6d-8e7f-90a1b2c3d4e5'
const EVALUATED_AT = 1_800_000_000_000

const EXPOSURE = '$experiment_exposure'
const FLAG_CALLED = '$feature_flag_called'

const ATTRIBUTION = {
    $feature_flag_config_version: 2,
    $feature_flag_reason_code: 'experiment_split',
    $feature_flag_rule_id: RULE,
    $feature_flag_rule_type: 'experiment',
    $feature_flag_variant_key: 'annual-first',
}

type RecordOptions = { key?: string; hasExperiment?: boolean; configVersion?: number }

const record = (code: string, value: unknown, rule: Record<string, unknown>, options: RecordOptions = {}): object => ({
    key: options.key ?? FLAG,
    value,
    reason: { code, condition_index: 0, description: 'Matched rule 1' },
    metadata: {
        id: 77,
        version: 3,
        config_version: options.configVersion ?? 2,
        description: null,
        payload: null,
        has_experiment: options.hasExperiment ?? true,
        ...rule,
    },
})

const split = (options: RecordOptions = {}): object =>
    record(
        'experiment_split',
        'annual',
        { rule_type: 'experiment', rule_id: RULE, variant_key: 'annual-first' },
        options
    )

const response = (records: any[], envelope: Record<string, unknown> = {}): Record<string, unknown> => ({
    flags: Object.fromEntries(records.map((flag) => [flag.key, flag])),
    errorsWhileComputingFlags: false,
    requestId: REQUEST_ID,
    evaluatedAt: EVALUATED_AT,
    ...envelope,
})

type Client = {
    posthog: PostHog
    /** Every event that reached `before_send`, as it was then. */
    events: CaptureResult[]
    load(body: Record<string, unknown>): Promise<void>
    reported(): Record<string, string[]>
}

async function startClient(
    config: Partial<PostHogConfig> = {},
    beforeSend: (event: CaptureResult) => CaptureResult | null = (event) => event
): Promise<Client> {
    const events: CaptureResult[] = []
    let nextBody: Record<string, unknown> = {}
    const posthog = await createPosthogInstance(uuidv7(), {
        advanced_disable_feature_flags_on_first_load: true,
        opt_out_useragent_filter: true,
        capture_pageview: false,
        persistence: 'localStorage',
        before_send: (event: CaptureResult | null) => {
            if (!event) {
                return event
            }
            events.push(JSON.parse(JSON.stringify(event)))
            return beforeSend(event)
        },
        ...config,
    })
    posthog._send_request = (options): void => {
        if (options.url.includes('/flags/')) {
            options.callback?.({ statusCode: 200, json: JSON.parse(JSON.stringify(nextBody)) })
        }
    }
    return {
        posthog,
        events,
        async load(body): Promise<void> {
            nextBody = body
            posthog.reloadFeatureFlags()
            await vi.advanceTimersByTimeAsync(10)
        },
        reported: () => JSON.parse(JSON.stringify(posthog.get_property('$flag_call_reported') ?? {})),
    }
}

const named = (events: CaptureResult[], name: string, key: string = FLAG): CaptureResult[] =>
    events.filter((event) => event.event === name && event.properties.$feature_flag === key)

const flagEventNames = (events: CaptureResult[]): string[] =>
    events.map((event) => event.event).filter((name) => name === FLAG_CALLED || name === EXPOSURE)

describe('config version 2 flag events in posthog-js', () => {
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

    it('sends the call and the exposure of a split as two events of one capture identity', async () => {
        const client = await startClient()
        client.posthog.identify('visitor-42')
        client.posthog.group('company', 'acme')
        await client.load(response([split()]))
        client.events.length = 0

        expect(client.posthog.getFeatureFlag(FLAG)).toBe('annual')

        expect(client.events.map((event) => event.event)).toEqual([FLAG_CALLED, EXPOSURE])
        const [called, exposure] = client.events as [CaptureResult, CaptureResult]
        expect(called.properties).toMatchObject({
            $feature_flag: FLAG,
            $feature_flag_response: 'annual',
            ...ATTRIBUTION,
        })
        expect(called.properties).not.toHaveProperty('$feature_flag_reason')
        expect(exposure.properties).toMatchObject({
            $feature_flag: FLAG,
            $feature_flag_response: 'annual',
            $feature_flag_variant_key: 'annual-first',
            $feature_flag_rule_id: RULE,
            locally_evaluated: false,
            $feature_flag_id: 77,
            $feature_flag_version: 3,
            $feature_flag_request_id: REQUEST_ID,
            $feature_flag_evaluated_at: EVALUATED_AT,
        })
        for (const name of ['$feature_flag_config_version', '$feature_flag_reason_code', '$feature_flag_rule_type']) {
            expect(exposure.properties).not.toHaveProperty(name)
        }
        // The same distinct ID, groups, session and person-processing setting, and another UUID.
        for (const name of [
            'distinct_id',
            '$groups',
            '$session_id',
            '$window_id',
            '$process_person_profile',
            'token',
        ]) {
            expect([name, exposure.properties[name]]).toEqual([name, called.properties[name]])
        }
        expect(exposure.properties.distinct_id).toBe('visitor-42')
        expect(exposure.properties.$groups).toEqual({ company: 'acme' })
        expect(exposure.uuid).toBeTruthy()
        expect(exposure.uuid).not.toBe(called.uuid)
    })

    it('stores both dedupe keys with the reported calls, and a new page sends neither event again', async () => {
        const persistenceName = `exposure-${uuidv7()}`
        const client = await startClient({ persistence_name: persistenceName })
        await client.load(response([split()]))
        client.posthog.getFeatureFlag(FLAG)

        expect(client.reported()).toEqual({
            [FLAG]: [
                JSON.stringify(['annual', [], 2, 'experiment_split', RULE, 'experiment', 'annual-first']),
                JSON.stringify(['$experiment_exposure', [], 2, RULE, 'annual-first']),
            ],
        })

        const nextPage = await startClient({ persistence_name: persistenceName })
        expect(nextPage.posthog.getFeatureFlag(FLAG)).toBe('annual')
        expect(nextPage.events).toEqual([])
    })

    describe('super properties', () => {
        const REGISTERED = {
            plan: 'scale',
            // Names that a config version 2 flag event sets itself, or never carries.
            $feature_flag_config_version: 1,
            $feature_flag_reason_code: 'registered',
            $feature_flag_rule_id: 'registered',
            $feature_flag_rule_type: 'registered',
            $feature_flag_variant_key: 'registered',
            $feature_flag_reason: 'registered',
            $feature_flag_forced_variant: true,
            $feature_flag_experiment_id: 301,
            $experiment_exposure_source: 'registered',
        }

        it('cannot change the attribution of a split, or add what its events never carry', async () => {
            const client = await startClient()
            client.posthog.register(REGISTERED)
            await client.load(response([split()]))

            client.posthog.getFeatureFlag(FLAG)

            const [called, exposure] = client.events as [CaptureResult, CaptureResult]
            expect(called.properties).toMatchObject({ plan: 'scale', ...ATTRIBUTION })
            for (const name of [
                '$feature_flag_reason',
                '$feature_flag_forced_variant',
                '$feature_flag_experiment_id',
            ]) {
                expect(called.properties).not.toHaveProperty(name)
            }
            expect(exposure.properties).toMatchObject({
                plan: 'scale',
                $feature_flag_variant_key: 'annual-first',
                $feature_flag_rule_id: RULE,
            })
            for (const name of [
                '$feature_flag_config_version',
                '$feature_flag_reason_code',
                '$feature_flag_rule_type',
                '$experiment_exposure_source',
                '$feature_flag_experiment_id',
                '$feature_flag_forced_variant',
            ]) {
                expect(exposure.properties).not.toHaveProperty(name)
            }
        })

        it('cannot add a rule to the call of a record that names none', async () => {
            const client = await startClient()
            client.posthog.register(REGISTERED)
            await client.load(response([record('no_rule_match', false, {})]))

            client.posthog.getFeatureFlag(FLAG)

            const called = named(client.events, FLAG_CALLED)[0]!
            expect(called.properties).toMatchObject({
                $feature_flag_config_version: 2,
                $feature_flag_reason_code: 'no_rule_match',
            })
            for (const name of ['$feature_flag_rule_id', '$feature_flag_rule_type', '$feature_flag_variant_key']) {
                expect(called.properties).not.toHaveProperty(name)
            }
            expect(named(client.events, EXPOSURE)).toEqual([])
        })

        it('still apply to config version 1 calls and to other events', async () => {
            const client = await startClient()
            client.posthog.register(REGISTERED)
            await client.load(response([record('condition_match', 'annual', {}, { configVersion: 1 })]))

            client.posthog.getFeatureFlag(FLAG)
            client.posthog.capture('another-event')

            const called = named(client.events, FLAG_CALLED)[0]!
            expect(called.properties).toMatchObject({
                ...REGISTERED,
                // The call's own reason wins over the registered one, as before.
                $feature_flag_reason: 'Matched rule 1',
            })
            expect(client.events.find((event) => event.event === 'another-event')!.properties).toMatchObject(REGISTERED)
        })
    })

    describe('minimal events', () => {
        it('a minimal config version 2 call keeps its attribution, and its exposure stays full', async () => {
            const client = await startClient()
            client.posthog.register({ plan: 'scale' })
            // No experiment links to the rule yet, so the call is minimal while the split assigns a variant.
            await client.load(response([split({ hasExperiment: false })], { minimalFlagCalledEvents: true }))

            client.posthog.getFeatureFlag(FLAG)

            const [called, exposure] = client.events as [CaptureResult, CaptureResult]
            expect(called.properties).toMatchObject({
                $feature_flag: FLAG,
                $feature_flag_response: 'annual',
                $feature_flag_has_experiment: false,
                ...ATTRIBUTION,
            })
            expect(called.properties).not.toHaveProperty('plan')
            expect(called.properties).not.toHaveProperty('$feature_flag_reason')
            expect(called.properties).not.toHaveProperty('$current_url_search')
            expect(exposure.properties).toMatchObject({ plan: 'scale', $feature_flag_variant_key: 'annual-first' })
            expect(exposure.properties).toHaveProperty('$lib_version')
        })

        it('a minimal config version 1 call drops super properties named like the attribution', async () => {
            const client = await startClient()
            client.posthog.register({ $feature_flag_rule_id: RULE, $feature_flag_config_version: 2 })
            await client.load(
                response([record('condition_match', true, {}, { configVersion: 1, hasExperiment: false })], {
                    minimalFlagCalledEvents: true,
                })
            )

            client.posthog.getFeatureFlag(FLAG)

            const called = named(client.events, FLAG_CALLED)[0]!
            expect(called.properties).toMatchObject({ $feature_flag: FLAG, $feature_flag_reason: 'Matched rule 1' })
            expect(called.properties).not.toHaveProperty('$feature_flag_rule_id')
            expect(called.properties).not.toHaveProperty('$feature_flag_config_version')
        })
    })

    describe('before_send', () => {
        it('sees both events and may still change them', async () => {
            const client = await startClient({}, (event) => {
                event.properties.changed = event.event
                return event
            })
            const sent: CaptureResult[] = []
            client.posthog._addCaptureHook((_name, event) => {
                if (event) {
                    sent.push(event)
                }
            })
            await client.load(response([split()]))

            client.posthog.getFeatureFlag(FLAG)

            expect(sent.map((event) => [event.event, event.properties.changed])).toEqual([
                [FLAG_CALLED, FLAG_CALLED],
                [EXPOSURE, EXPOSURE],
            ])
        })

        it.each([FLAG_CALLED, EXPOSURE])('a hook that throws for %s keeps no key for it', async (failing) => {
            let failures = 1
            const client = await startClient({}, (event) => {
                if (event.event === failing && failures > 0) {
                    failures--
                    throw new Error('before_send failed')
                }
                return event
            })
            const sent: string[] = []
            client.posthog._addCaptureHook((name) => sent.push(name))
            await client.load(response([split()]))

            expect(client.posthog.getFeatureFlag(FLAG)).toBe('annual')
            const other = failing === FLAG_CALLED ? EXPOSURE : FLAG_CALLED
            expect(sent).toEqual([other])

            // The next read sends the event whose hook threw, and only that one.
            client.posthog.getFeatureFlag(FLAG)
            client.posthog.getFeatureFlag(FLAG)
            expect(sent).toEqual([other, failing])
        })

        it('a hook that discards an event keeps its key', async () => {
            const client = await startClient({}, (event) => (event.event === EXPOSURE ? null : event))
            await client.load(response([split()]))

            client.posthog.getFeatureFlag(FLAG)
            client.posthog.getFeatureFlag(FLAG)

            expect(flagEventNames(client.events)).toEqual([FLAG_CALLED, EXPOSURE])
        })
    })

    describe('consent', () => {
        it('a read while opted out sends and stores nothing, and both events are sent after the opt-in', async () => {
            const client = await startClient()
            await client.load(response([split()]))
            client.posthog.opt_out_capturing()

            expect(client.posthog.getFeatureFlag(FLAG)).toBe('annual')
            expect(client.events).toEqual([])
            expect(client.reported()).toEqual({})

            client.posthog.opt_in_capturing({ captureEventName: false })
            client.posthog.capture('after-opt-in')

            expect(flagEventNames(client.events)).toEqual([FLAG_CALLED, EXPOSURE])
            client.posthog.getFeatureFlag(FLAG)
            expect(flagEventNames(client.events)).toEqual([FLAG_CALLED, EXPOSURE])
        })

        it('an opt-out while the call is captured does not lose the exposure', async () => {
            let optsOut = true
            const page: { posthog?: PostHog } = {}
            const client = await startClient({}, (event) => {
                if (event.event === FLAG_CALLED && optsOut) {
                    optsOut = false
                    page.posthog?.opt_out_capturing()
                }
                return event
            })
            page.posthog = client.posthog
            await client.load(response([split()]))

            client.posthog.getFeatureFlag(FLAG)
            // The exposure was dropped, so its key is not kept.
            expect(flagEventNames(client.events)).toEqual([FLAG_CALLED])
            expect(client.reported()[FLAG] ?? []).not.toContain(
                JSON.stringify(['$experiment_exposure', [], 2, RULE, 'annual-first'])
            )

            client.posthog.opt_in_capturing({ captureEventName: false })
            client.posthog.capture('after-opt-in')

            expect(flagEventNames(client.events).filter((name) => name === EXPOSURE)).toEqual([EXPOSURE])
        })
    })

    describe('identity', () => {
        it('identify and reset clear both dedupe keys', async () => {
            const client = await startClient()
            await client.load(response([split()]))
            client.posthog.getFeatureFlag(FLAG)
            expect(flagEventNames(client.events)).toEqual([FLAG_CALLED, EXPOSURE])

            client.posthog.identify('visitor-42')
            await vi.advanceTimersByTimeAsync(10)
            client.posthog.getFeatureFlag(FLAG)
            client.posthog.getFeatureFlag(FLAG)

            expect(flagEventNames(client.events)).toEqual([FLAG_CALLED, EXPOSURE, FLAG_CALLED, EXPOSURE])
            expect(named(client.events, EXPOSURE).map((event) => event.properties.distinct_id)[1]).toBe('visitor-42')

            client.posthog.reset()
            expect(client.reported()).toEqual({})
        })
    })

    it('sends nothing when flags are disabled', async () => {
        const client = await startClient({ advanced_disable_feature_flags: true })
        await client.load(response([split()]))

        expect(client.posthog.getFeatureFlag(FLAG)).toBeUndefined()

        expect(flagEventNames(client.events)).toEqual([])
    })
})
