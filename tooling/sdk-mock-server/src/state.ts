import { randomUUID } from 'node:crypto'

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
export interface JsonObject {
    [key: string]: JsonValue
}
export type Endpoint = 'config' | 'flags' | 'batch' | 'snapshot' | 'logs' | 'captureV1' | 'surveys'

export interface MockState extends JsonObject {
    sessionReplayEnabled: boolean
    linkedFlag: JsonValue
    sampleRate: JsonValue
    eventTriggers: JsonValue
    minimumDurationMilliseconds: JsonValue
    flags: JsonObject
    delays: JsonObject
    force500: JsonObject
    flagsQuotaLimited: boolean
    hasFeatureFlags: boolean | null
    projectToken: string
    surveysEnabled: boolean
    surveys: JsonValue[]
    configOverrides: JsonObject
    flagsOverrides: JsonObject
}

export function defaultState(): MockState {
    return {
        sessionReplayEnabled: true,
        linkedFlag: null,
        sampleRate: null,
        eventTriggers: null,
        minimumDurationMilliseconds: null,
        flags: { 'bool-value': true, 'string-value': 'test', 'disabled-flag': false },
        delays: { config: 0, flags: 0, batch: 0, snapshot: 0, logs: 0, captureV1: 0, surveys: 0 },
        force500: {
            config: false,
            flags: false,
            batch: false,
            snapshot: false,
            logs: false,
            captureV1: false,
            surveys: false,
        },
        flagsQuotaLimited: false,
        hasFeatureFlags: true,
        projectToken: 'phc_MOCK',
        surveysEnabled: false,
        surveys: [],
        configOverrides: {},
        flagsOverrides: {},
    }
}

export function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Object members merge recursively; arrays, null and scalars replace. */
export function mergeState(destination: JsonObject, patch: JsonObject): void {
    for (const [key, value] of Object.entries(patch)) {
        // Define own keys rather than invoking Object.prototype setters on control input.
        const previous = Object.hasOwn(destination, key) ? destination[key] : undefined
        if (isObject(value) && isObject(previous)) {
            mergeState(previous, value)
        } else {
            Object.defineProperty(destination, key, {
                value: structuredClone(value),
                enumerable: true,
                configurable: true,
                writable: true,
            })
        }
    }
}

function recording(state: MockState): JsonValue {
    if (!state.sessionReplayEnabled) return false
    const value: JsonObject = { endpoint: '/s/' }
    if (state.linkedFlag) value.linkedFlag = state.linkedFlag
    if (state.sampleRate !== null) value.sampleRate = String(state.sampleRate)
    if (state.eventTriggers) value.eventTriggers = structuredClone(state.eventTriggers)
    if (state.minimumDurationMilliseconds !== null) {
        value.minimumDurationMilliseconds = Math.trunc(Number(state.minimumDurationMilliseconds))
    }
    return value
}

export function buildConfigResponse(state: MockState): JsonObject {
    const response: JsonObject = {
        token: state.projectToken,
        supportedCompression: ['gzip', 'gzip-js'],
        captureDeadClicks: true,
        capturePerformance: { network_timing: true, web_vitals: true, web_vitals_allowed_metrics: null },
        autocapture_opt_out: false,
        analytics: { endpoint: '/i/v0/e/' },
        elementsChainAsString: true,
        sessionRecording: recording(state),
        heatmaps: true,
        surveys: state.surveysEnabled ? structuredClone(state.surveys) : false,
        defaultIdentifiedOnly: true,
        siteApps: [],
        errorTracking: { autocaptureExceptions: true },
    }
    if (state.hasFeatureFlags !== null) response.hasFeatureFlags = Boolean(state.hasFeatureFlags)
    mergeState(response, state.configOverrides)
    return response
}

export function buildFlagsResponse(state: MockState): JsonObject {
    if (state.flagsQuotaLimited) return { quotaLimited: ['feature_flags'] }
    const response: JsonObject = {
        featureFlags: structuredClone(state.flags),
        featureFlagPayloads: Object.fromEntries(
            Object.entries(state.flags)
                .filter(([, value]) => typeof value !== 'boolean')
                .map(([key, value]) => [key, JSON.stringify(value)])
        ),
        errorsWhileComputingFlags: false,
        requestId: randomUUID(),
        evaluatedAt: Math.floor(Date.now() / 1000),
        sessionRecording: recording(state),
    }
    mergeState(response, state.flagsOverrides)
    return response
}
