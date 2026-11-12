import {
    assertJson,
    isRecord,
    MAX_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    type Response,
    type State,
} from '../shared/protocol'

export const UTILITY_CHANNEL = 'posthog:utility:v1'
export const UTILITY_TIMEOUT_MS = 10_000

export function envelope(message: Record<string, unknown>): Record<string, unknown> {
    return { channel: UTILITY_CHANNEL, version: PROTOCOL_VERSION, ...message }
}

// Application messages may share parentPort, but never enter the SDK command path.
export function readEnvelope(value: unknown): Record<string, unknown> | undefined {
    if (!isRecord(value) || value.channel !== UTILITY_CHANNEL) return
    assertJson(value)
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_MESSAGE_BYTES) {
        throw new Error('PostHog utility message exceeds 256 KiB')
    }
    if (value.version !== PROTOCOL_VERSION) throw new Error('Unsupported PostHog utility protocol')
    return value
}

export function isState(value: unknown): value is State {
    return (
        isRecord(value) &&
        ['revision', 'generation', 'flagRevision'].every(
            (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0
        ) &&
        ['distinctId', 'anonymousId', 'sessionId'].every((key) => typeof value[key] === 'string') &&
        typeof value.optedOut === 'boolean' &&
        (value.flagsLoaded === undefined || typeof value.flagsLoaded === 'boolean') &&
        isRecord(value.featureFlags) &&
        Object.values(value.featureFlags).every((flag) => typeof flag === 'boolean' || typeof flag === 'string') &&
        isRecord(value.featureFlagPayloads)
    )
}

export function isResponse(value: unknown): value is Response {
    return (
        isRecord(value) &&
        ((value.ok === true && isState(value.state)) || (value.ok === false && typeof value.error === 'string'))
    )
}
