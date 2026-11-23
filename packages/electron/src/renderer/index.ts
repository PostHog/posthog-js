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
    isFlagContextCommand,
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
    private _pendingOptOuts = 0
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
                    getState: () => {
                        const state = this._state
                        if (!state) throw new Error('PostHog renderer is not ready')
                        return {
                            generation: state.generation,
                            distinctId: state.distinctId,
                            optedOut: state.optedOut,
                            autocapture: state.autocapture,
                        }
                    },
                    capture: (event, properties) => this.capture(event, properties),
                    loadConfig: () => this._send({ type: 'loadAutocaptureConfig' }),
                    onError: (error) => this._report(error),
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
        // Reject non-cloneable input as before, but snapshot with JSON semantics so caller toJSON redaction applies.
        structuredClone(command)
        const snapshot: Command = JSON.parse(JSON.stringify(command))
        const dispatched = this._tail.then(() => {
            if (this._disposed) throw new Error('PostHog renderer has been disposed')
            if (command.type === 'exception' && !this._canCaptureException()) return { response: undefined }
            const sequence = (bridgeSequences.get(this._bridge) ?? 0) + 1
            bridgeSequences.set(this._bridge, sequence)
            return {
                response: this._bridge.request({
                    version: PROTOCOL_VERSION,
                    sequence,
                    generation,
                    command: snapshot,
                }),
            }
        })
        const operation = dispatched.then(async ({ response: pending }) => {
            if (!pending) return
            const response = await pending
            if (!response.ok) throw new Error(response.error)
            this._update(response.state)
        })
        // Network-bound commands keep their place in main's ordered queue but must not hold later
        // renderer commands (especially consent) behind a slow response.
        const networkBound =
            command.type === 'flush' ||
            command.type === 'reloadFeatureFlags' ||
            command.type === 'loadAutocaptureConfig' ||
            (isFlagContextCommand(command) && command.reloadFeatureFlags)
        this._tail = (networkBound ? dispatched : operation).catch(() => {})
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
                () => this._canCaptureException(),
                (error, properties, hint) => this._captureException(error, properties, hint)
            )
        }
    }

    // A capture whose failure would feed back into onError doesn't report that failure, so an onError that
    // captures can't loop while main keeps refusing requests. That covers any capture made while onError runs
    // synchronously, and captureException(error) for an error already reported, including after an await.
    // A different capture made after an await in onError is not covered; the README warns against it.
    private _inOnError = false
    private _reportedFailures = new WeakSet<object>()
    private _report(error: unknown): void {
        const inOnError = this._inOnError
        this._inOnError = true
        try {
            const result: unknown = this._options.onError?.(error)
            if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
                void Promise.resolve(result).catch(() => {})
            }
        } catch {
        } finally {
            this._inOnError = inOnError
        }
    }
    private _reportFailure(promise: Promise<void>, quiet = this._inOnError): void {
        void promise.catch((error: unknown) => {
            if (quiet) return
            if (typeof error === 'object' && error !== null) this._reportedFailures.add(error)
            this._report(error)
        })
    }
    /** Fire-and-forget: never throws or rejects. Failed requests are reported through `onError`. */
    capture(event: string, properties?: Properties): void {
        if (typeof event !== 'string' || this.hasOptedOutCapturing()) return
        this._reportFailure(this._send({ type: 'capture', event, ...(properties ? { properties } : {}) }))
    }
    /**
     * Link the current distinct ID to an alias without switching identity or reloading flags.
     * Ignored when opted out or personProfiles is 'never'. Resolves after local persistence, not delivery.
     */
    alias(alias: string): Promise<void> {
        if (!alias?.trim()) return Promise.resolve()
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        return this._send({ type: 'alias', alias })
    }
    /**
     * Capture an event-only $screen; name wins over properties.$screen_name without setting persistent screen context.
     * Fire-and-forget: never throws or rejects; ignored when opted out.
     */
    screen(name: string, properties?: Properties): void {
        if (typeof name !== 'string' || !name.trim()) return
        if (this.hasOptedOutCapturing()) return
        this._reportFailure(this._send({ type: 'screen', name, ...(properties ? { properties } : {}) }))
    }
    /**
     * Update the current person's $set/$set_once properties without changing identity; empty updates do nothing.
     * Also updates flag context. Resolves after local persistence, not delivery or the background flag refresh.
     * Ignored when opted out or personProfiles is 'never'.
     */
    setPersonProperties(properties?: Properties, propertiesOnce?: Properties): Promise<void> {
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        return this._send({
            type: 'setPersonProperties',
            ...(properties ? { properties } : {}),
            ...(propertiesOnce ? { propertiesOnce } : {}),
        })
    }
    /**
     * Merge a call-time copy of local person overrides for flag evaluation, without updating the person profile.
     * Accepts nested $set/$set_once; empty input does nothing. Otherwise awaits persistence and, by default, a refresh attempt.
     * With false, only saves context; cached flag values stay unchanged until a reload.
     */
    setPersonPropertiesForFlags(properties: Properties, reloadFeatureFlags = true): Promise<void> {
        return this._send({ type: 'setPersonPropertiesForFlags', properties, reloadFeatureFlags })
    }
    /**
     * Merge a call-time copy of local overrides by group type, without changing profiles or group membership.
     * Empty input does nothing. Otherwise awaits persistence and, by default, a flag refresh attempt.
     * With false, only saves context; cached flag values stay unchanged until a reload.
     */
    setGroupPropertiesForFlags(properties: Record<string, Properties>, reloadFeatureFlags = true): Promise<void> {
        return this._send({ type: 'setGroupPropertiesForFlags', properties, reloadFeatureFlags })
    }
    /**
     * Clear all local person flag overrides, not profile data or identity. Resolves after persistence.
     * Cached flag values stay unchanged unless true is passed to also await a refresh attempt.
     */
    resetPersonPropertiesForFlags(reloadFeatureFlags = false): Promise<void> {
        return this._send({ type: 'resetPersonPropertiesForFlags', reloadFeatureFlags })
    }
    /**
     * Clear local flag overrides for every group type, not profiles or membership. Resolves after persistence.
     * Cached flag values stay unchanged unless true is passed to also await a refresh attempt.
     */
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
        this._pendingOptOuts++
        return this._pauseAutocapture({ type: 'optOut' }).finally(() => {
            this._pendingOptOuts--
        })
    }
    /**
     * Refresh flags using the shared identity/context after earlier mutations, then persist and synchronize the cache.
     * A failed fetch normally retains cached flags and resolves; completion does not guarantee fresh values.
     */
    reloadFeatureFlags(): Promise<void> {
        return this._send({ type: 'reloadFeatureFlags' })
    }
    /** Compatibility alias for reloadFeatureFlags(), with the same completion and failure semantics. */
    reloadFeatureFlagsAsync(): Promise<void> {
        return this.reloadFeatureFlags()
    }
    flush(): Promise<void> {
        return this._send({ type: 'flush' })
    }

    /** Fire-and-forget: never throws or rejects. Failed requests are reported through `onError`. */
    captureException(error: unknown, properties?: Properties): void {
        const reported = typeof error === 'object' && error !== null && this._reportedFailures.has(error)
        this._reportFailure(this._captureException(error, properties), this._inOnError || reported)
    }
    private _canCaptureException(): boolean {
        return !this._disposed && !this._pendingOptOuts && !this._state?.disabled && !this.hasOptedOutCapturing()
    }
    protected _captureException(error: unknown, properties?: Properties, hint?: EventHint): Promise<void> {
        if (!this._canCaptureException()) return Promise.resolve()
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
    /** Return the shared anonymous ID, stable across identify and rotated by reset; '' before synchronization. */
    getAnonymousId(): string {
        return this._state?.anonymousId ?? ''
    }
    /** Cached consent state; conservatively true until the first synchronized snapshot. */
    get optedOut(): boolean {
        return this.hasOptedOutCapturing()
    }
    getSessionId(): string {
        return this._state?.sessionId ?? ''
    }
    hasOptedOutCapturing(): boolean {
        return this._state?.optedOut ?? true
    }

    /**
     * Read the cached value without fetching. A missing key is false with a nonempty cache, otherwise undefined.
     * Reports a deduplicated exposure for the observed snapshot by default; sendFeatureFlagEvent: false suppresses it.
     */
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
    /**
     * Read cached enabled state without fetching; empty variants are disabled. defaultValue applies only to
     * unknown/unavailable flags. Without it, missing-key behavior matches getFeatureFlag().
     * Reports exposure by default; sendFeatureFlagEvent: false suppresses it.
     */
    isFeatureEnabled(key: string, options: IsFeatureEnabledOptions & { defaultValue: boolean }): boolean
    /**
     * Read cached enabled state without fetching; empty variants are disabled. Missing keys follow getFeatureFlag()
     * unless defaultValue is supplied. Reports exposure by default; sendFeatureFlagEvent: false suppresses it.
     */
    isFeatureEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined
    isFeatureEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined {
        if (options?.defaultValue !== undefined) {
            const result = this.getFeatureFlagResult(key, options)
            return result === undefined ? options.defaultValue : Boolean(result.variant ?? result.enabled)
        }
        const value = this.getFeatureFlag(key, options)
        return value === undefined ? undefined : Boolean(value)
    }
    /**
     * Return a copied cached result, or undefined for unknown/unavailable flags; never fetches.
     * Empty variants are disabled. Reports exposure by default; sendFeatureFlagEvent: false suppresses it.
     */
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
    /** Return copied cached results (empty when unavailable), without fetching or reporting exposures. */
    getAllFeatureFlags(): FeatureFlagResult[] {
        return Object.keys(this._state?.featureFlags ?? {}).map((key) =>
            this.getFeatureFlagResult(key, { sendFeatureFlagEvent: false })!
        )
    }
    /**
     * Read a copied, decoded cached payload without fetching or reporting exposure.
     * Missing payloads are null once flags are loaded, otherwise undefined; strings are not decoded again.
     */
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
