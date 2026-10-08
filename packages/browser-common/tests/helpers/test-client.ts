import { isUndefined, type Logger } from '@posthog/core'
import type { Properties } from '@posthog/types'

import type {
    ApiResponse,
    CaptureOptions,
    CapturedEventInfo,
    Client,
    SendRequestInit,
    SessionContext,
} from '../../src/client'
import { createDisposable, type Disposable } from '../../src/disposable'
import type { KeyValueStore } from '../../src/persistence'
import { Publisher } from '../../src/pubsub'
import type { RemoteConfig, RemoteConfigResult } from '../../src/types/remote-config'

export interface TestCapturedEvent {
    event: string
    properties: Record<string, unknown>
    options: CaptureOptions | undefined
}

export interface TestSentRequest {
    path: string
    init: SendRequestInit | undefined
}

export interface TestClientOptions {
    projectToken?: string
    distinctId?: string
    anonymousId?: string
    groups?: Record<string, string>
    session?: SessionContext
    canCapture?: boolean
    remoteConfig?: RemoteConfig
    logger?: Logger
    requestResponse?: ApiResponse
    getExtension?: Client['getExtension']
}

export class InMemoryKeyValueStore implements KeyValueStore {
    private _values = new Map<string, unknown>()

    initialize(): void {}

    get<T = unknown>(key: string): T | undefined
    get<T extends object>(keys: readonly (keyof T & string)[]): Partial<T>
    get(keyOrKeys: string | readonly string[]): unknown {
        if (typeof keyOrKeys === 'string') {
            return this._values.get(keyOrKeys)
        }
        const values: Record<string, unknown> = {}
        for (const key of keyOrKeys) {
            const value = this._values.get(key)
            if (!isUndefined(value)) {
                values[key] = value
            }
        }
        return values
    }

    set(key: string, value: unknown): void
    set(values: Record<string, unknown>): void
    set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
        if (typeof keyOrValues === 'string') {
            this._values.set(keyOrValues, value)
        } else {
            for (const [key, entry] of Object.entries(keyOrValues)) {
                this._values.set(key, entry)
            }
        }
    }

    remove(keyOrKeys: string | readonly string[]): void {
        if (typeof keyOrKeys === 'string') {
            this._values.delete(keyOrKeys)
        } else {
            for (const key of keyOrKeys) {
                this._values.delete(key)
            }
        }
    }
}

const noopLogger: Logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    critical() {},
    createLogger() {
        return noopLogger
    },
}

function createDefaultApiResponse(): ApiResponse {
    return { statusCode: 200 }
}

export class TestClient implements Client {
    readonly projectToken: string
    readonly capturedEvents: TestCapturedEvent[] = []
    readonly sentRequests: TestSentRequest[] = []
    readonly kv: KeyValueStore = new InMemoryKeyValueStore()
    readonly logger: Logger
    readonly getExtension: Client['getExtension']

    distinctId: string
    anonymousId: string
    deviceId: string | undefined
    library = { name: 'posthog-test', version: '0.0.0' }
    initialPersonProperties: Record<string, unknown> = {}
    groups: Record<string, string>
    session: SessionContext
    canCapture: boolean

    private _remoteConfigResult: RemoteConfigResult | undefined
    private _requestResponse: ApiResponse
    private _dynamicEventPropertyProducers: Array<() => Record<string, unknown>> = []
    private _eventPublisher = new Publisher<CapturedEventInfo>()
    private _remoteConfigPublisher = new Publisher<RemoteConfigResult>()

    readonly onEvent = this._eventPublisher.listener
    readonly onRemoteConfig: Client['onRemoteConfig'] = (handler) => {
        const subscription = this._remoteConfigPublisher.listener(handler)
        if (this._remoteConfigResult) {
            handler(this._remoteConfigResult)
        }
        return subscription
    }

    constructor(options: TestClientOptions = {}) {
        this.projectToken = options.projectToken ?? 'test-project-token'
        this.distinctId = options.distinctId ?? 'test-distinct-id'
        this.anonymousId = options.anonymousId ?? 'test-anonymous-id'
        this.deviceId = this.anonymousId
        this.groups = options.groups ?? {}
        this.session = options.session ?? {
            sessionId: 'test-session-id',
            windowId: 'test-window-id',
            sessionStartTimestamp: 0,
        }
        this.canCapture = options.canCapture ?? true
        this._remoteConfigResult = options.remoteConfig ? { ok: true, config: options.remoteConfig } : undefined
        this.logger = options.logger ?? noopLogger
        this._requestResponse = options.requestResponse ?? createDefaultApiResponse()
        this.getExtension = options.getExtension ?? (() => undefined)
    }

    capture(event: string, properties?: Properties | null, options?: CaptureOptions): void {
        const dynamicProperties = this._dynamicEventPropertyProducers.reduce(
            (acc, producer) => ({ ...acc, ...producer() }),
            {} as Record<string, unknown>
        )
        const finalProperties = { ...dynamicProperties, ...(properties ?? {}) }

        this.capturedEvents.push({ event, properties: finalProperties, options })
        this._eventPublisher.publish({ event, properties: finalProperties })
    }

    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable {
        this._dynamicEventPropertyProducers.push(producer)

        return createDisposable(() => {
            const index = this._dynamicEventPropertyProducers.indexOf(producer)
            if (index !== -1) {
                this._dynamicEventPropertyProducers.splice(index, 1)
            }
        })
    }

    async sendRequest(path: string, init?: SendRequestInit): Promise<ApiResponse> {
        this.sentRequests.push({ path, init })
        return this._requestResponse
    }

    setRemoteConfig(remoteConfig: RemoteConfig): void {
        this.setRemoteConfigResult({ ok: true, config: remoteConfig })
    }

    setRemoteConfigResult(result: RemoteConfigResult): void {
        this._remoteConfigResult = result
        this._remoteConfigPublisher.publish(result)
    }

    publishEvent(event: string, properties: Record<string, unknown> = {}): void {
        this._eventPublisher.publish({ event, properties })
    }

    dispose(): void {
        this._eventPublisher.dispose()
        this._remoteConfigPublisher.dispose()
        this._dynamicEventPropertyProducers = []
    }
}

export function createTestClient(options: TestClientOptions = {}): TestClient {
    return new TestClient(options)
}
