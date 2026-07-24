import type { Logger } from '@posthog/core'
import type { Properties } from '@posthog/types'

import type { ApiResponse, Client, SendRequestInit } from '../../src/client'
import { CoreExtension as CoreExtensionToken } from '../../src/core-extension'
import type {
    CaptureOptions,
    CapturedEventInfo,
    CoreExtension,
    NewSessionInfo,
    SessionContext,
} from '../../src/core-extension'
import { createDisposable, type Disposable } from '../../src/disposable'
import type { KeyValueStore } from '../../src/persistence'
import { Publisher } from '../../src/pubsub'
import type { RemoteConfig } from '../../src/types/remote-config'
import type { ExtensionToken } from '../../src/token'

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
    remoteConfig?: RemoteConfig
    logger?: Logger
    requestResponse?: ApiResponse
}

export class InMemoryKeyValueStore implements KeyValueStore {
    private _values = new Map<string, unknown>()

    async get<T = unknown>(key: string): Promise<T | undefined> {
        return this._values.get(key) as T | undefined
    }

    async set(key: string, value: unknown): Promise<void> {
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
    return { statusCode: 200 }
}

export class TestCoreExtension implements CoreExtension {
    readonly name = 'core'
    readonly provides = [CoreExtensionToken]
    readonly capturedEvents: TestCapturedEvent[] = []

    distinctId: string
    anonymousId: string
    groups: Record<string, string>
    session: SessionContext

    private _remoteConfig: RemoteConfig | undefined
    private _dynamicEventPropertyProducers: Array<() => Record<string, unknown>> = []
    private _eventPublisher = new Publisher<CapturedEventInfo>()
    private _newSessionPublisher = new Publisher<NewSessionInfo>()
    private _remoteConfigPublisher = new Publisher<RemoteConfig>()

    readonly onEvent = this._eventPublisher.listener
    readonly onNewSession = this._newSessionPublisher.listener
    readonly onRemoteConfig = this._remoteConfigPublisher.listener

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
    }

    setup(): void {}

    async capture(event: string, properties?: Properties | null, options?: CaptureOptions): Promise<void> {
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

    async getRemoteConfig(): Promise<RemoteConfig | undefined> {
        return this._remoteConfig
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
        this._eventPublisher.dispose()
        this._newSessionPublisher.dispose()
        this._remoteConfigPublisher.dispose()
        this._dynamicEventPropertyProducers = []
    }
}

export class TestClient implements Client {
    readonly projectToken: string
    readonly sentRequests: TestSentRequest[] = []
    readonly core: TestCoreExtension
    readonly kv: KeyValueStore = new InMemoryKeyValueStore()
    readonly logger: Logger

    private _requestResponse: ApiResponse
    private _extensions = new Map<string, unknown>()

    constructor(options: TestClientOptions = {}) {
        this.projectToken = options.projectToken ?? 'test-project-token'
        this.core = new TestCoreExtension(options)
        this._extensions.set(CoreExtensionToken, this.core)
        this.logger = options.logger ?? noopLogger
        this._requestResponse = options.requestResponse ?? createDefaultApiResponse()
    }

    get capturedEvents(): TestCapturedEvent[] {
        return this.core.capturedEvents
    }

    async sendRequest(path: string, init?: SendRequestInit): Promise<ApiResponse> {
        this.sentRequests.push({ path, init })
        return this._requestResponse
    }

    getExtension<T>(token: ExtensionToken<T>): T | undefined {
        return this._extensions.get(token) as T | undefined
    }

    registerExtension<T>(token: ExtensionToken<T>, extension: T): Disposable {
        this._extensions.set(token, extension)

        return createDisposable(() => this._extensions.delete(token))
    }

    setRemoteConfig(remoteConfig: RemoteConfig): void {
        this.core.setRemoteConfig(remoteConfig)
    }

    publishEvent(event: string, properties: Record<string, unknown> = {}): void {
        this.core.publishEvent(event, properties)
    }

    startNewSession(session: NewSessionInfo): void {
        this.core.startNewSession(session)
    }

    dispose(): void {
        this.core.dispose()
        this._extensions.clear()
    }
}

export function createTestClient(options: TestClientOptions = {}): TestClient {
    return new TestClient(options)
}
