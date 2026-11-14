import {
    ErrorPropertiesBuilder,
    ErrorCoercer,
    ObjectCoercer,
    StringCoercer,
    PrimitiveCoercer,
    createDefaultStackParser,
} from '@posthog/core/error-tracking'
import {
    BRIDGE_KEY,
    PROTOCOL_VERSION,
    type Bridge,
    type Command,
    type FeatureFlagValue,
    type JsonType,
    type Properties,
    type State,
} from '../shared/protocol'

export type { State, Properties, FeatureFlagValue, JsonType }

const bridgeSequences = new WeakMap<Bridge, number>()

export class PostHog {
    private _state?: State
    private _reportedFlags = new Set<string>()
    private _ready?: Promise<void>
    private _tail: Promise<unknown> = Promise.resolve()
    private _listeners = new Set<(state: State) => void>()
    private _unsubscribe: () => void
    private _disposed = false
    private _builder = new ErrorPropertiesBuilder(
        [new ErrorCoercer(), new ObjectCoercer(), new StringCoercer(), new PrimitiveCoercer()],
        createDefaultStackParser()
    )

    constructor(private _bridge: Bridge) {
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
        for (const listener of this._listeners) {
            try {
                listener(this.getState())
            } catch {}
        }
    }

    private async _send(command: Command): Promise<void> {
        const generation = this._state?.generation ?? 0
        const snapshot: Command = JSON.parse(JSON.stringify(command))
        const dispatched = this._tail.then(() => {
            if (this._disposed) throw new Error('PostHog renderer has been disposed')
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
            const response = await pending
            if (!response.ok) throw new Error(response.error)
            this._update(response.state)
        })
        this._tail = (command.type === 'flush' || command.type === 'reloadFeatureFlags' ? dispatched : operation).catch(
            () => {}
        )
        return operation
    }

    async ready(): Promise<void> {
        if (this._disposed) throw new Error('PostHog renderer has been disposed')
        await (this._ready ??= this._send({ type: 'hello' }).catch((error: unknown) => {
            this._ready = undefined
            throw error
        }))
    }

    capture(event: string, properties?: Properties): Promise<void> {
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        return this._send({ type: 'capture', event, ...(properties ? { properties } : {}) })
    }
    identify(distinctId: string, properties?: Properties): Promise<void> {
        return this._send({ type: 'identify', distinctId, ...(properties ? { properties } : {}) })
    }
    reset(): Promise<void> {
        return this._send({ type: 'reset' })
    }
    group(groupType: string, groupKey: string | number, properties?: Properties): Promise<void> {
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
        return this._send({ type: 'optOut' })
    }
    reloadFeatureFlags(): Promise<void> {
        return this._send({ type: 'reloadFeatureFlags' })
    }
    flush(): Promise<void> {
        return this._send({ type: 'flush' })
    }

    captureException(error: unknown, properties?: Properties): Promise<void> {
        if (this.hasOptedOutCapturing()) return Promise.resolve()
        const exception = this._builder.buildFromUnknown(error)
        return this._send({ type: 'exception', properties: { ...properties, ...exception } as unknown as Properties })
    }

    getDistinctId(): string {
        return this._state?.distinctId ?? ''
    }
    getSessionId(): string {
        return this._state?.sessionId ?? ''
    }
    hasOptedOutCapturing(): boolean {
        return this._state?.optedOut ?? true
    }

    getFeatureFlag(key: string, options?: { sendEvent?: boolean }): FeatureFlagValue | undefined {
        const flags = this._state?.featureFlags
        const value =
            flags && Object.prototype.hasOwnProperty.call(flags, key)
                ? flags[key]
                : flags && Object.keys(flags).length > 0
                  ? false
                  : undefined
        if (options?.sendEvent !== false && this._state) {
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
    isFeatureEnabled(key: string, options?: { sendEvent?: boolean }): boolean | undefined {
        const value = this.getFeatureFlag(key, options)
        return value === undefined ? undefined : Boolean(value)
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
        this._unsubscribe()
        this._listeners.clear()
        this._reportedFlags.clear()
        if (singleton === this) singleton = undefined
    }
}

let singleton: PostHog | undefined
let initializing: Promise<PostHog> | undefined

export function init(): Promise<PostHog> {
    if (initializing) return initializing
    if (singleton) return Promise.resolve(singleton)
    const bridge = (globalThis as typeof globalThis & { [BRIDGE_KEY]?: Bridge })[BRIDGE_KEY]
    if (!bridge) return Promise.reject(new Error('PostHog preload bridge is missing; configure your Electron preload'))
    const client = new PostHog(bridge)
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
