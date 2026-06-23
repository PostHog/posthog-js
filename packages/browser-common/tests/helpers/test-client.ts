import { isNull, isUndefined, type Logger } from '@posthog/core'

import type {
    ApiRequestInit,
    ApiResponse,
    CaptureOptions,
    CapturedEventInfo,
    Client,
    NewSessionInfo,
    RemoteConfig,
    SessionContext,
} from '../../src/client'
import type { Disposable } from '../../src/disposable'
import type { KeyValueStore } from '../../src/persistence'
import { Publisher } from '../../src/pubsub'
import type { ExtensionToken } from '../../src/token'

export interface TestCapturedEvent {
    event: string
    properties: Record<string, unknown>
    options: CaptureOptions | undefined
}

export interface TestApiRequest {
    path: string
    init: ApiRequestInit | undefined
}

export interface TestClientOptions {
    distinctId?: string
    anonymousId?: string
    groups?: Record<string, string>
    session?: SessionContext
    remoteConfig?: RemoteConfig
    logger?: Logger
    apiResponse?: ApiResponse
}

export class InMemoryKeyValueStore implements KeyValueStore {
    private _values = new Map<string, unknown>()

    async get<T = unknown>(key: string): Promise<T | undefined> {
        return this._values.get(key) as T | undefined
    }

    async set(key: string, value: unknown): Promise<void> {
        if (isNull(value) || isUndefined(value)) {
            this._values.delete(key)
            return
        }

        this._values.set(key, value)
    }

    async remove(key: string): Promise<void> {
        this._values.delete(key)
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
    return {
        ok: true,
        status: 200,
        async json() {
            return undefined
        },
        async text() {
            return ''
        },
    }
}

export class TestClient implements Client {
    readonly capturedEvents: TestCapturedEvent[] = []
    readonly apiRequests: TestApiRequest[] = []
    readonly kv: KeyValueStore = new InMemoryKeyValueStore()
    readonly logger: Logger

    distinctId: string
    anonymousId: string
    groups: Record<string, string>
    session: SessionContext

    private _remoteConfig: RemoteConfig | undefined
    private _apiResponse: ApiResponse
    private _dynamicEventPropertyProducers: Array<() => Record<string, unknown>> = []
    private _extensions = new Map<ExtensionToken<unknown>, unknown>()
    private _remoteConfigPublisher = new Publisher<RemoteConfig>()
    private _eventPublisher = new Publisher<CapturedEventInfo>()
    private _newSessionPublisher = new Publisher<NewSessionInfo>()

    readonly onRemoteConfig = this._remoteConfigPublisher.listener
    readonly onEvent = this._eventPublisher.listener
    readonly onNewSession = this._newSessionPublisher.listener

    constructor(options: TestClientOptions = {}) {
        this.distinctId = options.distinctId ?? 'test-distinct-id'
        this.anonymousId = options.anonymousId ?? 'test-anonymous-id'
        this.groups = options.groups ?? {}
        this.session = options.session ?? {
            sessionId: 'test-session-id',
            windowId: 'test-window-id',
            sessionStartTimestamp: 0,
        }
        this._remoteConfig = options.remoteConfig
        this.logger = options.logger ?? noopLogger
        this._apiResponse = options.apiResponse ?? createDefaultApiResponse()
    }

    async capture(event: string, properties?: Record<string, unknown> | null, options?: CaptureOptions): Promise<void> {
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

        let isActive = true
        return {
            dispose: () => {
                if (!isActive) {
                    return
                }
                isActive = false

                const index = this._dynamicEventPropertyProducers.indexOf(producer)
                if (index !== -1) {
                    this._dynamicEventPropertyProducers.splice(index, 1)
                }
            },
        }
    }

    async apiRequest(path: string, init?: ApiRequestInit): Promise<ApiResponse> {
        this.apiRequests.push({ path, init })
        return this._apiResponse
    }

    async getRemoteConfig(): Promise<RemoteConfig | undefined> {
        return this._remoteConfig
    }

    getExtension<T>(token: ExtensionToken<T>): T | undefined {
        return this._extensions.get(token as ExtensionToken<unknown>) as T | undefined
    }

    registerExtension<T>(token: ExtensionToken<T>, extension: T): Disposable {
        this._extensions.set(token as ExtensionToken<unknown>, extension)

        let isActive = true
        return {
            dispose: () => {
                if (!isActive) {
                    return
                }
                isActive = false
                this._extensions.delete(token as ExtensionToken<unknown>)
            },
        }
    }

    setRemoteConfig(remoteConfig: RemoteConfig): void {
        this._remoteConfig = remoteConfig
        this._remoteConfigPublisher.publish(remoteConfig)
    }

    publishEvent(event: string, properties: Record<string, unknown> = {}): void {
        this._eventPublisher.publish({ event, properties })
    }

    startNewSession(session: NewSessionInfo): void {
        this.session = {
            sessionId: session.sessionId,
            windowId: session.windowId,
            sessionStartTimestamp: session.sessionStartTimestamp,
        }
        this._newSessionPublisher.publish(session)
    }

    dispose(): void {
        this._remoteConfigPublisher.dispose()
        this._eventPublisher.dispose()
        this._newSessionPublisher.dispose()
        this._extensions.clear()
        this._dynamicEventPropertyProducers = []
    }
}

export function createTestClient(options: TestClientOptions = {}): TestClient {
    return new TestClient(options)
}
