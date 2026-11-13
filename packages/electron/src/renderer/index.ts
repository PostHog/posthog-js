import {
    ErrorPropertiesBuilder,
    ErrorCoercer,
    ErrorEventCoercer,
    PromiseRejectionEventCoercer,
    type EventHint,
    ObjectCoercer,
    StringCoercer,
    PrimitiveCoercer,
    createDefaultStackParser,
} from '@posthog/core/error-tracking'
import { startRendererExceptionAutocapture } from './exception-autocapture'
import {
    BRIDGE_KEY,
    PROTOCOL_VERSION,
    type FeatureFlagReadOptions,
    type IsFeatureEnabledOptions,
    type FeatureFlagResult,
    type Bridge,
    type Command,
    type FeatureFlagValue,
    type JsonType,
    type Properties,
    type State,
} from '../shared/protocol'

import { RendererAutocapture, type AutocaptureConfig } from './autocapture'

export type {
    State,
    Properties,
    FeatureFlagValue,
    FeatureFlagResult,
    FeatureFlagReadOptions,
    IsFeatureEnabledOptions,
    JsonType,
    AutocaptureConfig,
}

export interface RendererOptions {
    autocapture?: boolean | AutocaptureConfig
    onError?: (error: unknown) => void
    enableExceptionAutocapture?: boolean
}

// Keep the main frame's high-water mark across dispose/init on the same preload bridge.
const bridgeSequences = new WeakMap<Bridge, number>()

export class PostHog {
    private _autocapture?: RendererAutocapture
    private _autocapturePauses = 0
    private _state?: State
    private _ready?: Promise<void>
    private _reportedFlags = new Set<string>()
    private _tail: Promise<unknown> = Promise.resolve()
    private _listeners = new Set<(state: State) => void>()
    private _unsubscribe: () => void
    private _disposed = false
    private _stopExceptionAutocapture?: () => void
    private _builder = new ErrorPropertiesBuilder(
        [
            new ErrorEventCoercer(),
            new PromiseRejectionEventCoercer(),
            new ErrorCoercer(),
            new ObjectCoercer(),
            new StringCoercer(),
            new PrimitiveCoercer(),
        ],
        createDefaultStackParser()
    )

    constructor(
        private _bridge: Bridge,
        private _options: RendererOptions = {}
    ) {
        if (_options.autocapture) {
            this._autocapture = new RendererAutocapture(
                {
                    getState: () => this.getState(),
                    capture: (event, properties) => this.capture(event, properties),
                    loadConfig: () => this._send({ type: 'loadAutocaptureConfig' }),
                    onError: (error) => {
                        try {
                            this._options.onError?.(error)
                        } catch {}
                    },
                },
                typeof _options.autocapture === 'object' ? _options.autocapture : {}
            )
        }
        this._unsubscribe = this._bridge.subscribe((state) => this._update(state))
    }

    private _update(state: State): void {
        if (this._disposed || (this._state && state.revision <= this._state.revision)) return
        if (
            this._state?.generation !== state.generation ||
            this._state?.flagRevision !== state.flagRevision ||
            this._state?.sessionId !== state.sessionId ||
            this._state?.optedOut !== state.optedOut
        ) {
            this._reportedFlags = new Set()
        }
        this._state = structuredClone(state)
        this._autocapture?.update(this._autocapturePauses > 0)
        for (const listener of this._listeners) {
            try {
                listener(this.getState())
            } catch {}
        }
    }

    private async _send(command: Command): Promise<void> {
        const generation = this._state?.generation ?? 0
        const snapshot: Command = JSON.parse(JSON.stringify(structuredClone(command)))
        const operation = this._tail.then(async () => {
            if (this._disposed) throw new Error('PostHog renderer has been disposed')
            if (command.type === 'exception' && this.hasOptedOutCapturing()) return
            const sequence = (bridgeSequences.get(this._bridge) ?? 0) + 1
            bridgeSequences.set(this._bridge, sequence)
            const response = await this._bridge.request({
                version: PROTOCOL_VERSION,
                sequence,
                generation,
                command: snapshot,
            })
            if (!response.ok) throw new Error(response.error)
            this._update(response.state)
        })
        this._tail = operation.catch(() => {})
        return operation
    }

    private _pauseAutocapture(command: Command): Promise<void> {
        this._autocapturePauses++
        if (this._state) this._autocapture?.update(true)
        return this._send(command).finally(() => {
            this._autocapturePauses--
            if (this._state) this._autocapture?.update(this._autocapturePauses > 0)
        })
    }

    async ready(): Promise<void> {
        if (this._disposed) throw new Error('PostHog renderer has been disposed')
        await (this._ready ??= this._send({ type: 'hello' }).catch((error: unknown) => {
            this._ready = undefined
            throw error
        }))
        if (
            !this._disposed &&
            !this._stopExceptionAutocapture &&
            this._options.enableExceptionAutocapture === true &&
            typeof window !== 'undefined'
        ) {
            this._stopExceptionAutocapture = startRendererExceptionAutocapture(
                () => !this._disposed && !this.hasOptedOutCapturing(),
                (error, properties, hint) => this._captureException(error, properties, hint)
            )
        }
    }

    capture(event: string, properties?: Properties): Promise<void> {
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        return this._send({ type: 'capture', event, ...(properties ? { properties } : {}) })
    }
    alias(alias: string): Promise<void> {
        if (!alias?.trim()) return Promise.resolve()
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        return this._send({ type: 'alias', alias })
    }
    screen(name: string, properties?: Properties): Promise<void> {
        if (!name?.trim()) return Promise.resolve()
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        return this._send({ type: 'screen', name, ...(properties ? { properties } : {}) })
    }
    setPersonProperties(properties?: Properties, propertiesOnce?: Properties): Promise<void> {
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        return this._send({
            type: 'setPersonProperties',
            ...(properties ? { properties } : {}),
            ...(propertiesOnce ? { propertiesOnce } : {}),
        })
    }
    setPersonPropertiesForFlags(properties: Properties, reloadFeatureFlags = true): Promise<void> {
        return this._send({ type: 'setPersonPropertiesForFlags', properties, reloadFeatureFlags })
    }
    setGroupPropertiesForFlags(properties: Record<string, Properties>, reloadFeatureFlags = true): Promise<void> {
        return this._send({ type: 'setGroupPropertiesForFlags', properties, reloadFeatureFlags })
    }
    resetPersonPropertiesForFlags(reloadFeatureFlags = false): Promise<void> {
        return this._send({ type: 'resetPersonPropertiesForFlags', reloadFeatureFlags })
    }
    resetGroupPropertiesForFlags(reloadFeatureFlags = false): Promise<void> {
        return this._send({ type: 'resetGroupPropertiesForFlags', reloadFeatureFlags })
    }
    identify(distinctId: string, properties?: Properties): Promise<void> {
        return this._pauseAutocapture({ type: 'identify', distinctId, ...(properties ? { properties } : {}) })
    }
    reset(): Promise<void> {
        return this._pauseAutocapture({ type: 'reset' })
    }
    group(groupType: string, groupKey: string | number, properties?: Properties): Promise<void> {
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        return this._send({ type: 'group', groupType, groupKey, ...(properties ? { properties } : {}) })
    }
    register(properties: Properties): Promise<void> {
        return this._send({ type: 'register', properties })
    }
    unregister(key: string): Promise<void> {
        return this._send({ type: 'unregister', key })
    }
    optIn(): Promise<void> {
        return this._send({ type: 'optIn' })
    }
    optOut(): Promise<void> {
        return this._pauseAutocapture({ type: 'optOut' })
    }
    reloadFeatureFlags(): Promise<void> {
        return this._send({ type: 'reloadFeatureFlags' })
    }
    reloadFeatureFlagsAsync(): Promise<void> {
        return this.reloadFeatureFlags()
    }
    flush(): Promise<void> {
        return this._send({ type: 'flush' })
    }

    captureException(error: unknown, properties?: Properties): Promise<void> {
        return this._captureException(error, properties)
    }
    protected _captureException(error: unknown, properties?: Properties, hint?: EventHint): Promise<void> {
        if (this._disposed || this.hasOptedOutCapturing()) return Promise.resolve()
        try {
            const exception = this._builder.buildFromUnknown(error, hint)
            return this._send({
                type: 'exception',
                properties: { ...properties, ...exception } as unknown as Properties,
            })
        } catch {
            return Promise.resolve()
        }
    }

    getDistinctId(): string {
        return this._state?.distinctId ?? ''
    }
    getAnonymousId(): string {
        return this._state?.anonymousId ?? ''
    }
    get optedOut(): boolean {
        return this.hasOptedOutCapturing()
    }
    getSessionId(): string {
        return this._state?.sessionId ?? ''
    }
    hasOptedOutCapturing(): boolean {
        return this._state?.optedOut ?? true
    }

    getFeatureFlag(key: string, options?: FeatureFlagReadOptions): FeatureFlagValue | undefined {
        const flags = this._state?.featureFlags
        const value =
            flags && Object.prototype.hasOwnProperty.call(flags, key)
                ? flags[key]
                : flags && Object.keys(flags).length > 0
                  ? false
                  : undefined
        if ((options?.sendFeatureFlagEvent ?? options?.sendEvent) !== false && this._state) {
            const reportedFlags = this._reportedFlags
            const reportKey = JSON.stringify([key, value ?? null])
            if (!reportedFlags.has(reportKey)) {
                reportedFlags.add(reportKey)
                void this._send({
                    type: 'flag',
                    key,
                    flagRevision: this._state.flagRevision,
                    value: value ?? null,
                }).catch(() => reportedFlags.delete(reportKey))
            }
        }
        return value
    }
    isFeatureEnabled(key: string, options: IsFeatureEnabledOptions & { defaultValue: boolean }): boolean
    isFeatureEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined
    isFeatureEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined {
        if (options?.defaultValue !== undefined) {
            const result = this.getFeatureFlagResult(key, options)
            return result === undefined ? options.defaultValue : Boolean(result.variant ?? result.enabled)
        }
        const value = this.getFeatureFlag(key, options)
        return value === undefined ? undefined : Boolean(value)
    }
    getFeatureFlagResult(key: string, options?: FeatureFlagReadOptions): FeatureFlagResult | undefined {
        // Exposure commands retain the observed snapshot revision, including missing-key reads.
        this.getFeatureFlag(key, options)
        if (!this._state || !Object.prototype.hasOwnProperty.call(this._state.featureFlags, key)) return undefined
        const value = this._state.featureFlags[key]
        return {
            key,
            enabled: Boolean(value),
            ...(typeof value === 'string' ? { variant: value } : {}),
            payload: this.getFeatureFlagPayload(key) ?? null,
        }
    }
    getAllFeatureFlags(): FeatureFlagResult[] {
        return Object.keys(this._state?.featureFlags ?? {}).map((key) =>
            this.getFeatureFlagResult(key, { sendFeatureFlagEvent: false })!
        )
    }
    getFeatureFlagPayload(key: string): JsonType | undefined {
        const payloads = this._state?.featureFlagPayloads
        const value = payloads && Object.prototype.hasOwnProperty.call(payloads, key) ? payloads[key] : undefined
        return value === undefined ? (this._state?.flagsLoaded ? null : undefined) : structuredClone(value)
    }
    getState(): State {
        if (!this._state) throw new Error('PostHog renderer is not ready')
        return structuredClone(this._state)
    }
    onStateChange(callback: (state: State) => void): () => void {
        this._listeners.add(callback)
        if (this._state) callback(this.getState())
        return () => this._listeners.delete(callback)
    }
    dispose(): void {
        if (this._disposed) return
        this._disposed = true
        this._stopExceptionAutocapture?.()
        this._stopExceptionAutocapture = undefined
        this._autocapture?.dispose()
        this._unsubscribe()
        this._listeners.clear()
        this._reportedFlags.clear()
        if (singleton === this) singleton = undefined
    }
}

let singleton: PostHog | undefined
let initializing: Promise<PostHog> | undefined

export function init(options: RendererOptions = {}): Promise<PostHog> {
    if (initializing) return initializing
    if (singleton) return Promise.resolve(singleton)
    const bridge = (globalThis as typeof globalThis & { [BRIDGE_KEY]?: Bridge })[BRIDGE_KEY]
    if (!bridge) return Promise.reject(new Error('PostHog preload bridge is missing; configure your Electron preload'))
    const client = new PostHog(bridge, options)
    initializing = client
        .ready()
        .then(() => {
            singleton = client
            return client
        })
        .catch((error: unknown) => {
            client.dispose()
            throw error
        })
        .finally(() => {
            initializing = undefined
        })
    return initializing
}
