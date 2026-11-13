/**
 * Feature flag scenarios, written against a real client and its public API, with only the
 * transport replaced.
 *
 * `fixtures/released-flags-1.448.0.json` holds what posthog-js 1.448.0 returned, sent and stored
 * for each scenario, from the `v2` response shape it requests. `released-flags.test.ts` runs the
 * scenarios on this source from the `v2` and the `v4` shape and compares them with that recording.
 *
 * To record again, check out the release and run, from `packages/browser`:
 *
 *   RECORD_RELEASED_FLAGS=<version> pnpm exec vitest run src/__tests__/released-flags.test.ts
 */
import type { PostHog } from '../posthog-core'
import type { CaptureResult, PostHogConfig } from '../types'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { isUndefined } from '@posthog/core'
import { createPosthogInstance } from './helpers/posthog-instance'

export type Shape = 'v2' | 'v4'

type Reason = { code: string; condition_index: number | null; description: string }

export type FlagSpec = {
    key: string
    // The record a server sends at v2.
    enabled: boolean
    variant: string | null
    payload: unknown
    // The record a server sends at v4.
    value: unknown
    configVersion: 1 | 2
    rule?: { rule_type: string; rule_id: string; variant_key?: string }
    id?: number
    version?: number
    hasExperiment?: boolean
    failed?: boolean
    reason: Reason
}

const MATCHED: Reason = { code: 'condition_match', condition_index: 0, description: 'Matched condition set 1' }
const NOT_MATCHED: Reason = {
    code: 'no_condition_match',
    condition_index: null,
    description: 'No matching condition set',
}
const RULE_ID = '50000000-0000-4000-8000-000000000001'

export const PARITY_FLAGS: FlagSpec[] = [
    {
        key: 'bool-on',
        enabled: true,
        variant: null,
        payload: '{"plan":"pro"}',
        value: true,
        configVersion: 1,
        reason: MATCHED,
    },
    {
        key: 'bool-off',
        enabled: false,
        variant: null,
        payload: null,
        value: false,
        configVersion: 1,
        reason: NOT_MATCHED,
    },
    {
        key: 'v1-variant',
        enabled: true,
        variant: 'control',
        payload: '{"columns": 2}',
        value: 'control',
        configVersion: 1,
        hasExperiment: true,
        reason: MATCHED,
    },
    {
        key: 'v1-object-payload',
        enabled: true,
        variant: null,
        // A payload the server sends as decoded JSON, not as a string.
        payload: { columns: 3 },
        value: true,
        configVersion: 1,
        reason: MATCHED,
    },
    {
        key: 'v2-string',
        enabled: true,
        variant: 'compact',
        payload: null,
        value: 'compact',
        configVersion: 2,
        rule: { rule_type: 'targeted_release', rule_id: RULE_ID },
        reason: MATCHED,
    },
    {
        key: 'v2-split',
        enabled: true,
        variant: 'arm-b',
        payload: null,
        value: 'arm-b',
        configVersion: 2,
        rule: { rule_type: 'experiment', rule_id: RULE_ID, variant_key: 'arm-b' },
        hasExperiment: true,
        reason: MATCHED,
    },
    { key: 'v2-false', enabled: false, variant: null, payload: null, value: false, configVersion: 2, reason: MATCHED },
    {
        key: 'v2-null',
        enabled: false,
        variant: null,
        payload: null,
        value: null,
        configVersion: 2,
        reason: NOT_MATCHED,
    },
    { key: 'v2-number', enabled: true, variant: null, payload: '12.5', value: 12.5, configVersion: 2, reason: MATCHED },
    { key: 'v2-zero', enabled: true, variant: null, payload: '0', value: 0, configVersion: 2, reason: MATCHED },
    {
        key: 'v2-object',
        enabled: true,
        variant: null,
        payload: '{"layout":"compact","columns":[1,2],"beta":null}',
        value: { layout: 'compact', columns: [1, 2], beta: null },
        configVersion: 2,
        reason: MATCHED,
    },
    {
        key: 'v2-empty-object',
        enabled: true,
        variant: null,
        payload: '{}',
        value: {},
        configVersion: 2,
        reason: MATCHED,
    },
]

export const FAILED_FLAG: FlagSpec = {
    key: 'failed',
    enabled: false,
    variant: null,
    payload: null,
    value: null,
    configVersion: 2,
    failed: true,
    reason: { code: 'dependency_error', condition_index: null, description: 'A dependency could not be evaluated' },
}

const HEALTHY_FLAG: FlagSpec = {
    key: 'healthy',
    enabled: true,
    variant: 'compact',
    payload: '{"columns":2}',
    value: 'compact',
    configVersion: 1,
    id: 601,
    reason: MATCHED,
}

const SURVEY_FLAG: FlagSpec = {
    key: 'survey-targeting',
    enabled: true,
    variant: null,
    payload: null,
    value: true,
    configVersion: 1,
    id: 701,
    reason: MATCHED,
}

const spec = (key: string): FlagSpec => {
    const found = [...PARITY_FLAGS, FAILED_FLAG, HEALTHY_FLAG, SURVEY_FLAG].find((flag) => flag.key === key)
    if (!found) {
        throw new Error(`No flag spec for ${key}`)
    }
    return found
}

/** The config version of each flag the scenarios serve, by key. */
export const CONFIG_VERSIONS: Record<string, 1 | 2> = Object.fromEntries(
    [...PARITY_FLAGS, FAILED_FLAG, HEALTHY_FLAG, SURVEY_FLAG].map((flag) => [flag.key, flag.configVersion])
)

let nextId = 500

/** The record a server sends for a flag, at the given response version. */
export function record(flagSpec: FlagSpec, shape: Shape): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
        id: flagSpec.id ?? nextId++,
        version: flagSpec.version ?? 4,
        description: null,
        payload: flagSpec.payload,
        has_experiment: flagSpec.hasExperiment ?? false,
    }
    const flag: Record<string, unknown> = { key: flagSpec.key }
    if (shape === 'v2') {
        flag.enabled = flagSpec.enabled
        flag.variant = flagSpec.variant
    } else {
        flag.value = flagSpec.failed ? null : flagSpec.value
        metadata.config_version = flagSpec.configVersion
        // v4 sends no payload for config version 2 flags; a number or object value is its own payload.
        if (flagSpec.configVersion === 2) {
            metadata.payload = null
        }
        Object.assign(metadata, flagSpec.rule ?? {})
    }
    if (flagSpec.failed) {
        flag.failed = true
    }
    flag.reason = flagSpec.reason
    flag.metadata = metadata
    return flag
}

const REQUEST_IDS = [
    '50000000-0000-4000-8000-00000000000a',
    '50000000-0000-4000-8000-00000000000b',
    '50000000-0000-4000-8000-00000000000c',
]

export function responseFor(
    shape: Shape,
    specs: FlagSpec[],
    extra: Record<string, unknown> = {},
    sequence = 0
): Record<string, unknown> {
    nextId = 500
    return {
        flags: Object.fromEntries(specs.map((flagSpec) => [flagSpec.key, record(flagSpec, shape)])),
        errorsWhileComputingFlags: false,
        requestId: REQUEST_IDS[sequence],
        evaluatedAt: 1800000000000 + sequence,
        ...extra,
    }
}

const UNDEFINED = '<undefined>'

// JSON semantics below the top level, with an explicit marker for an undefined result, so the
// recording tells an undefined result apart from a missing one.
function plain(value: unknown): unknown {
    return isUndefined(value) ? UNDEFINED : JSON.parse(JSON.stringify(value))
}

// The event properties the flags code owns, plus the one custom super property the scenarios
// register. Every event also carries the loaded flags (`$feature/<key>`, `$active_feature_flags`
// and `$feature_flag_payloads`); the recording keeps them on the events that are not flag events.
function flagProperties(event: string, properties: Record<string, unknown>): Record<string, unknown> {
    const isFlagEvent = event === '$feature_flag_called' || event === '$experiment_exposure'
    return Object.fromEntries(
        Object.entries(properties).filter(([key]) =>
            isFlagEvent
                ? (key.startsWith('$feature_flag') && key !== '$feature_flag_payloads') ||
                  ['$used_bootstrap_value', 'locally_evaluated', 'plan'].includes(key)
                : key.startsWith('$feature') || ['$active_feature_flags', '$override_feature_flags'].includes(key)
        )
    )
}

const FLAG_STATE_KEY =
    /^\$(feature_flag|enabled_feature_flags|active_feature_flags|flag_call|minimal_flag|override_feature)/

type FlagsRequest = { url: string; body: Record<string, unknown> }
type FlagsResponse = { statusCode: number; json?: unknown; error?: unknown }

export type ScenarioClient = {
    posthog: PostHog
    events: unknown[]
    requests: FlagsRequest[]
    callbacks: unknown[]
    /** Reloads the flags and answers the request with `response`. */
    load(response: FlagsResponse | Record<string, unknown>): Promise<void>
    /** Every stored property the flags code owns. */
    stored(): Record<string, unknown>
    close(): Promise<void>
}

export async function startClient(
    config: Partial<PostHogConfig> = {},
    persistenceName: string = `released-flags-${uuidv7()}`
): Promise<ScenarioClient> {
    const events: unknown[] = []
    const requests: FlagsRequest[] = []
    const callbacks: unknown[] = []
    let nextResponse: FlagsResponse = { statusCode: 200, json: {} }

    const posthog = await createPosthogInstance(uuidv7(), {
        advanced_disable_feature_flags_on_first_load: true,
        opt_out_useragent_filter: true,
        capture_pageview: false,
        persistence: 'localStorage',
        persistence_name: persistenceName,
        before_send: (event: CaptureResult | null) => {
            if (event) {
                events.push([event.event, plain(flagProperties(event.event, event.properties))])
            }
            return event
        },
        ...config,
    })
    posthog._send_request = (options): void => {
        if (!options.url.includes('/flags/')) {
            return
        }
        requests.push({
            url: options.url.replace(/^.*(\/flags\/)/, '$1'),
            body: plain(options.data) as Record<string, unknown>,
        })
        options.callback?.(JSON.parse(JSON.stringify(nextResponse)))
    }
    posthog.onFeatureFlags((flags, variants, context) => {
        callbacks.push(plain({ flags, variants, context }))
    })

    return {
        posthog,
        events,
        requests,
        callbacks,
        async load(response): Promise<void> {
            nextResponse = 'statusCode' in response ? (response as FlagsResponse) : { statusCode: 200, json: response }
            posthog.reloadFeatureFlags()
            await vi.advanceTimersByTimeAsync(10)
        },
        stored(): Record<string, unknown> {
            const props = posthog.persistence?.props ?? {}
            return plain(
                Object.fromEntries(
                    Object.keys(props)
                        .filter((key) => FLAG_STATE_KEY.test(key))
                        .sort()
                        .map((key) => [key, props[key]])
                )
            ) as Record<string, unknown>
        },
        async close(): Promise<void> {
            posthog.featureFlags?.dispose()
            await vi.advanceTimersByTimeAsync(0)
        },
    }
}

/** What every legacy reader returns for each key, without sending flag events. */
function quietReads(posthog: PostHog, keys: string[]): Record<string, unknown> {
    const outputs: Record<string, unknown> = {}
    for (const key of keys) {
        outputs[`getFeatureFlag:${key}`] = plain(posthog.getFeatureFlag(key, { send_event: false }))
        outputs[`isFeatureEnabled:${key}`] = plain(posthog.isFeatureEnabled(key, { send_event: false }))
        outputs[`getFeatureFlagPayload:${key}`] = plain(posthog.getFeatureFlagPayload(key))
        outputs[`getFeatureFlagResult:${key}`] = plain(posthog.getFeatureFlagResult(key, { send_event: false }))
    }
    outputs.getFlags = plain(posthog.featureFlags?.getFlags())
    outputs.getFlagVariants = plain(posthog.featureFlags?.getFlagVariants())
    outputs.getFlagPayloads = plain(posthog.featureFlags?.getFlagPayloads())
    return outputs
}

/** Reads each key with every getter that sends `$feature_flag_called`. */
function trackedReads(posthog: PostHog, keys: string[]): Record<string, unknown> {
    const outputs: Record<string, unknown> = {}
    for (const key of keys) {
        outputs[`getFeatureFlag:${key}`] = plain(posthog.getFeatureFlag(key))
        outputs[`isFeatureEnabled:${key}`] = plain(posthog.isFeatureEnabled(key))
        outputs[`getFeatureFlagResult:${key}`] = plain(posthog.getFeatureFlagResult(key))
    }
    return outputs
}

function results(client: ScenarioClient, outputs: Record<string, unknown>): Record<string, unknown> {
    return {
        ...outputs,
        events: [...client.events],
        requests: client.requests.map((request) => request.url),
        callbacks: [...client.callbacks],
        stored: client.stored(),
    }
}

async function getters(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient()
    const keys = [...PARITY_FLAGS.map((flag) => flag.key), 'missing']
    await client.load(responseFor(shape, PARITY_FLAGS))
    const outputs = {
        ...quietReads(client.posthog, keys),
        tracked: trackedReads(client.posthog, keys),
        // A second read of each value sends nothing.
        repeated: trackedReads(client.posthog, keys),
    }
    // Every other event carries the loaded flags.
    client.posthog.capture('released-flags-event')
    const result = results(client, outputs)
    await client.close()
    return result
}

async function failedRecordInACompleteResponse(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient()
    const served: FlagSpec = { ...FAILED_FLAG, enabled: true, variant: 'compact', value: 'compact', failed: false }
    await client.load(responseFor(shape, [served, HEALTHY_FLAG]))
    const before = trackedReads(client.posthog, ['failed', 'healthy'])
    // The next response is complete and reports no response-wide error, yet one record failed.
    await client.load(responseFor(shape, [FAILED_FLAG, HEALTHY_FLAG], {}, 1))
    const result = results(client, {
        before,
        ...quietReads(client.posthog, ['failed', 'healthy']),
        tracked: trackedReads(client.posthog, ['failed', 'healthy']),
    })
    await client.close()
    return result
}

async function errorsWhileComputingFlags(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient()
    const served: FlagSpec = { ...FAILED_FLAG, enabled: true, variant: 'compact', value: 'compact', failed: false }
    await client.load(responseFor(shape, [served, HEALTHY_FLAG, spec('bool-on')]))
    const before = trackedReads(client.posthog, ['failed', 'healthy', 'bool-on'])
    // The failed flag keeps its cached value, the healthy flag changes, and the flag the
    // response leaves out stays.
    const changed: FlagSpec = { ...HEALTHY_FLAG, variant: 'wide', value: 'wide', payload: '{"columns":4}' }
    await client.load(responseFor(shape, [FAILED_FLAG, changed], { errorsWhileComputingFlags: true }, 1))
    const result = results(client, {
        before,
        ...quietReads(client.posthog, ['failed', 'healthy', 'bool-on']),
        tracked: trackedReads(client.posthog, ['failed', 'healthy', 'bool-on', 'missing']),
    })
    await client.close()
    return result
}

async function quotaLimited(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient()
    await client.load(responseFor(shape, [HEALTHY_FLAG, spec('bool-on')]))
    const before = trackedReads(client.posthog, ['healthy'])
    await client.load({ flags: {}, errorsWhileComputingFlags: false, quotaLimited: ['feature_flags'] })
    const result = results(client, {
        before,
        ...quietReads(client.posthog, ['healthy', 'bool-on']),
        tracked: trackedReads(client.posthog, ['healthy', 'bool-on']),
    })
    await client.close()
    return result
}

async function failedRequests(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient({ feature_flag_request_max_retries: 0 })
    await client.load(responseFor(shape, [HEALTHY_FLAG, spec('bool-on')]))
    const before = trackedReads(client.posthog, ['healthy'])
    await client.load({ statusCode: 500, json: { type: 'server_error' } })
    const afterServerError = {
        ...quietReads(client.posthog, ['healthy', 'bool-on']),
        tracked: trackedReads(client.posthog, ['bool-on']),
    }
    await client.load({ statusCode: 0, error: 'offline' })
    const result = results(client, {
        before,
        afterServerError,
        ...quietReads(client.posthog, ['healthy', 'bool-on']),
        tracked: trackedReads(client.posthog, ['missing']),
    })
    await client.close()
    return result
}

async function bootstrap(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient({
        bootstrap: {
            featureFlags: { 'v2-split': 'arm-a', 'bool-on': true, 'bootstrap-only': 'kept-until-load' },
            featureFlagPayloads: { 'bool-on': { plan: 'bootstrapped' } },
        },
    })
    const keys = ['v2-split', 'bool-on', 'bootstrap-only', 'bool-off']
    const beforeLoad = { ...quietReads(client.posthog, keys), tracked: trackedReads(client.posthog, keys) }
    const storedBeforeLoad = client.stored()
    await client.load(responseFor(shape, PARITY_FLAGS))
    const result = results(client, {
        beforeLoad,
        storedBeforeLoad,
        ...quietReads(client.posthog, keys),
        tracked: trackedReads(client.posthog, keys),
    })
    await client.close()
    return result
}

async function overrides(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient()
    await client.load(responseFor(shape, PARITY_FLAGS))
    const keys = ['v2-split', 'v2-string', 'bool-on', 'bool-off']
    client.posthog.featureFlags?.overrideFeatureFlags({
        // A value override on one flag, a payload override on another, and both on a third.
        flags: { 'v2-split': 'arm-a', 'bool-off': true },
        payloads: { 'v2-string': { layout: 'overridden' }, 'bool-off': { forced: true } },
        suppressWarning: true,
    })
    const overridden = { ...quietReads(client.posthog, keys), tracked: trackedReads(client.posthog, keys) }
    const storedWhileOverridden = client.stored()
    client.posthog.featureFlags?.overrideFeatureFlags(false)
    const result = results(client, {
        overridden,
        storedWhileOverridden,
        ...quietReads(client.posthog, keys),
        tracked: trackedReads(client.posthog, keys),
    })
    await client.close()
    return result
}

async function surveyOnlyResponses(shape: Shape): Promise<Record<string, unknown>> {
    const persistenceName = `released-flags-${uuidv7()}`
    const first = await startClient({}, persistenceName)
    await first.load(responseFor(shape, [HEALTHY_FLAG, spec('v2-split'), spec('bool-on')]))
    await first.close()

    // The next page asks only for survey flags, so each response is merged into the stored flags.
    const client = await startClient({ advanced_only_evaluate_survey_feature_flags: true }, persistenceName)
    const changed: FlagSpec = { ...HEALTHY_FLAG, variant: 'wide', value: 'wide', payload: null }
    await client.load(responseFor(shape, [SURVEY_FLAG, changed], {}, 1))
    const keys = ['healthy', 'v2-split', 'bool-on', 'survey-targeting']
    const result = results(client, { ...quietReads(client.posthog, keys), tracked: trackedReads(client.posthog, keys) })
    await client.close()
    return result
}

async function flagKeys(shape: Shape): Promise<Record<string, unknown>> {
    const persistenceName = `released-flags-${uuidv7()}`
    const first = await startClient({}, persistenceName)
    await first.load(responseFor(shape, [HEALTHY_FLAG, spec('v2-split'), spec('bool-on')]))
    await first.close()

    const client = await startClient({ flag_keys: ['v2-split', 'healthy'] }, persistenceName)
    await client.load(responseFor(shape, [spec('v2-split'), HEALTHY_FLAG], {}, 1))
    const keys = ['healthy', 'v2-split', 'bool-on']
    const result = results(client, {
        requestedFlagKeys: client.requests.map((request) => request.body.flag_keys),
        ...quietReads(client.posthog, keys),
        tracked: trackedReads(client.posthog, keys),
    })
    await client.close()
    return result
}

async function minimalEvents(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient()
    client.posthog.register({ plan: 'scale' })
    // `v1-variant` and `v2-split` are linked to an experiment, so they send the full event.
    const flags = [spec('bool-on'), spec('v1-variant'), spec('v2-split'), spec('v2-string'), spec('v2-number')]
    await client.load(responseFor(shape, flags, { minimalFlagCalledEvents: true }))
    const keys = flags.map((flag) => flag.key)
    const minimal = trackedReads(client.posthog, keys)
    // The gate turns off when a response leaves it out.
    client.posthog.featureFlags?.resetFlagCallReported()
    await client.load(responseFor(shape, flags, {}, 1))
    const result = results(client, { minimal, full: trackedReads(client.posthog, keys) })
    await client.close()
    return result
}

async function eventControls(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient()
    await client.load(responseFor(shape, PARITY_FLAGS))
    const { posthog } = client
    const outputs: Record<string, unknown> = {}

    outputs.silent = plain(posthog.getFeatureFlag('v2-split', { send_event: false }))
    outputs.eventsAfterSilentRead = client.events.length
    outputs.payloadRead = plain(posthog.getFeatureFlagPayload('v2-split'))
    outputs.eventsAfterPayloadRead = client.events.length
    outputs.tracked = plain(posthog.getFeatureFlag('v2-split'))
    outputs.eventsAfterTrackedRead = client.events.length

    // Reads while opted out are reported after the user opts in again.
    posthog.opt_out_capturing()
    outputs.optedOut = plain(posthog.getFeatureFlag('v2-string'))
    outputs.eventsWhileOptedOut = client.events.length
    posthog.opt_in_capturing({ captureEventName: false })
    posthog.capture('after-opt-in')
    outputs.eventsAfterOptIn = client.events.length

    const result = results(client, outputs)
    await client.close()
    return result
}

async function droppedByBeforeSend(shape: Shape): Promise<Record<string, unknown>> {
    const seen: string[] = []
    const client = await startClient({
        before_send: (event: CaptureResult | null) => {
            if (event) {
                seen.push(`${event.event}:${event.properties.$feature_flag ?? ''}`)
            }
            return event?.event === '$feature_flag_called' || event?.event === '$experiment_exposure' ? null : event
        },
    })
    await client.load(responseFor(shape, PARITY_FLAGS))
    const first = plain(client.posthog.getFeatureFlag('v2-split'))
    const second = plain(client.posthog.getFeatureFlag('v2-split'))
    const result = results(client, { first, second, seen })
    await client.close()
    return result
}

async function identity(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient()
    const flags = [spec('v2-split'), spec('bool-on')]
    await client.load(responseFor(shape, flags))
    const anonymous = trackedReads(client.posthog, ['v2-split', 'bool-on'])

    client.posthog.identify('released-flags-user')
    await vi.advanceTimersByTimeAsync(10)
    const identified = trackedReads(client.posthog, ['v2-split', 'bool-on'])
    const storedWhenIdentified = client.stored()

    client.posthog.group('company', 'released-flags-company')
    await vi.advanceTimersByTimeAsync(10)
    const grouped = trackedReads(client.posthog, ['v2-split', 'bool-on'])

    client.posthog.reset()
    await vi.advanceTimersByTimeAsync(10)
    const result = results(client, {
        anonymous,
        identified,
        storedWhenIdentified,
        grouped,
        afterReset: trackedReads(client.posthog, ['v2-split', 'bool-on']),
    })
    await client.close()
    return result
}

async function nextPageLoad(shape: Shape): Promise<Record<string, unknown>> {
    const persistenceName = `released-flags-${uuidv7()}`
    const first = await startClient({}, persistenceName)
    await first.load(responseFor(shape, PARITY_FLAGS))
    const firstPage = trackedReads(first.posthog, ['v2-split', 'bool-on', 'v2-number'])
    const firstPageEvents = [...first.events]
    await first.close()

    // The next page reads the stored flags before its own response arrives.
    const client = await startClient({}, persistenceName)
    const keys = ['v2-split', 'bool-on', 'v2-number', 'v2-object', 'bool-off']
    const beforeLoad = { ...quietReads(client.posthog, keys), tracked: trackedReads(client.posthog, keys) }
    const eventsBeforeLoad = [...client.events]
    await client.load(responseFor(shape, PARITY_FLAGS, {}, 1))
    const result = results(client, {
        firstPage,
        firstPageEvents,
        beforeLoad,
        eventsBeforeLoad,
        ...quietReads(client.posthog, keys),
        tracked: trackedReads(client.posthog, keys),
    })
    await client.close()
    return result
}

async function flagsDisabled(shape: Shape): Promise<Record<string, unknown>> {
    const client = await startClient({ advanced_disable_feature_flags: true })
    await client.load(responseFor(shape, PARITY_FLAGS))
    const keys = ['v2-split', 'bool-on']
    const result = results(client, {
        requestBodies: client.requests.map((request) => request.body.disable_flags),
        ...quietReads(client.posthog, keys),
        tracked: trackedReads(client.posthog, keys),
    })
    await client.close()
    return result
}

/** A response from a server that answers with the oldest shape, whatever version is requested. */
async function oldestResponseShape(): Promise<Record<string, unknown>> {
    const client = await startClient()
    await client.load({
        featureFlags: { 'bool-on': true, 'v1-variant': 'control', 'bool-off': false },
        featureFlagPayloads: { 'bool-on': '{"plan":"pro"}' },
        errorsWhileComputingFlags: false,
    })
    const keys = ['bool-on', 'v1-variant', 'bool-off', 'missing']
    const result = results(client, { ...quietReads(client.posthog, keys), tracked: trackedReads(client.posthog, keys) })
    await client.close()
    return result
}

/** Every scenario, from the given response shape. */
export async function runAll(shape: Shape): Promise<Record<string, Record<string, unknown>>> {
    return {
        getters: await getters(shape),
        'a failed record in a complete response': await failedRecordInACompleteResponse(shape),
        'errors while computing flags': await errorsWhileComputingFlags(shape),
        'quota limited': await quotaLimited(shape),
        'failed requests': await failedRequests(shape),
        bootstrap: await bootstrap(shape),
        overrides: await overrides(shape),
        'survey-only responses': await surveyOnlyResponses(shape),
        'flag keys': await flagKeys(shape),
        'minimal events': await minimalEvents(shape),
        'event controls': await eventControls(shape),
        'events dropped by before_send': await droppedByBeforeSend(shape),
        identity: await identity(shape),
        'the next page load': await nextPageLoad(shape),
        'flags disabled': await flagsDisabled(shape),
        'the oldest response shape': await oldestResponseShape(),
    }
}
