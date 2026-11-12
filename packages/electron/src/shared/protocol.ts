import type { FeatureFlagValue, JsonType, PostHogEventProperties } from '@posthog/core'

export const COMMAND_CHANNEL = 'posthog:command:v1'
export const STATE_CHANNEL = 'posthog:state:v1'
export const BRIDGE_KEY = '__POSTHOG_ELECTRON__'
export const PROTOCOL_VERSION = 1
export const MAX_MESSAGE_BYTES = 256 * 1024

export type Properties = PostHogEventProperties
export type { FeatureFlagValue, JsonType }

export interface State {
    revision: number
    generation: number
    distinctId: string
    anonymousId: string
    sessionId: string
    optedOut: boolean
    featureFlags: Record<string, FeatureFlagValue>
    flagsLoaded?: boolean
    flagRevision: number
    featureFlagPayloads: Record<string, JsonType>
}

export type Command =
    | { type: 'hello' }
    | { type: 'capture'; event: string; properties?: Properties }
    | { type: 'identify'; distinctId: string; properties?: Properties }
    | { type: 'reset' }
    | { type: 'group'; groupType: string; groupKey: string | number; properties?: Properties }
    | { type: 'register'; properties: Properties }
    | { type: 'unregister'; key: string }
    | { type: 'optIn' }
    | { type: 'optOut' }
    | { type: 'flag'; key: string; flagRevision: number; value: FeatureFlagValue | null }
    | { type: 'reloadFeatureFlags' }
    | { type: 'flush' }
    | { type: 'exception'; properties: Properties }

export interface Request {
    version: number
    sequence: number
    generation: number
    command: Command
}

export type Response = { ok: true; state: State } | { ok: false; error: string }

export interface Bridge {
    request(request: Request): Promise<Response>
    subscribe(callback: (state: State) => void): () => void
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function assertJson(value: unknown, depth = 0): void {
    if (depth > 20) throw new Error('PostHog payload is too deeply nested')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number' && Number.isFinite(value)) return
    if (Array.isArray(value)) {
        for (const item of value) assertJson(item, depth + 1)
        return
    }
    if (
        isRecord(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ) {
        for (const [key, item] of Object.entries(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe PostHog property key')
            assertJson(item, depth + 1)
        }
        return
    }
    throw new Error('PostHog properties must be JSON serializable')
}

export function validateRequest(value: unknown): asserts value is Request {
    assertJson(value)
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_MESSAGE_BYTES) {
        throw new Error('PostHog message exceeds 256 KiB')
    }
    if (
        !isRecord(value) ||
        value.version !== PROTOCOL_VERSION ||
        !Number.isSafeInteger(value.sequence) ||
        (value.sequence as number) < 1 ||
        !Number.isSafeInteger(value.generation) ||
        !isRecord(value.command)
    ) {
        throw new Error('Invalid PostHog request')
    }
    const command = value.command
    const string = (key: string): boolean =>
        typeof command[key] === 'string' && (command[key] as string).trim().length > 0
    const properties = (): boolean => command.properties === undefined || isRecord(command.properties)
    switch (command.type) {
        case 'hello':
        case 'reset':
        case 'optIn':
        case 'optOut':
        case 'reloadFeatureFlags':
        case 'flush':
            return
        case 'capture':
            if (string('event') && !['$snapshot', '$exception'].includes(command.event as string) && properties())
                return
            break
        case 'identify':
            if (string('distinctId') && properties()) return
            break
        case 'group':
            if (string('groupType') && (string('groupKey') || typeof command.groupKey === 'number') && properties())
                return
            break
        case 'register':
            if (isRecord(command.properties)) return
            break
        case 'exception':
            if (
                isRecord(command.properties) &&
                Array.isArray(command.properties.$exception_list) &&
                command.properties.$exception_list.length > 0 &&
                command.properties.$exception_list.every(
                    (exception) =>
                        isRecord(exception) && typeof exception.type === 'string' && typeof exception.value === 'string'
                )
            )
                return
            break
        case 'unregister':
            if (string('key')) return
            break
        case 'flag':
            if (
                string('key') &&
                Number.isSafeInteger(command.flagRevision) &&
                (command.value === null || typeof command.value === 'boolean' || typeof command.value === 'string')
            )
                return
            break
    }
    throw new Error('Invalid PostHog command')
}

export function trustedUrl(url: string, allowedUrls: readonly string[]): boolean {
    try {
        const target = new URL(url)
        target.hash = ''
        return allowedUrls.some((allowed) => {
            const candidate = new URL(allowed)
            candidate.hash = ''
            return candidate.href === target.href
        })
    } catch {
        return false
    }
}
