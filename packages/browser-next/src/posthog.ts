import {
    type ApiResponse,
    type CaptureOptions,
    type CapturedEventInfo,
    type Client,
    type Disposable,
    type Extension,
    type RemoteConfig,
    type RemoteConfigResult,
    type SendRequestInit,
    type SessionContext,
} from '@posthog/browser-common'
import { Publisher } from '@posthog/browser-common/pubsub'

import { isLikelyBot } from './bot-filter'
import { ExtensionRegistry } from './extensions/registry'
import { createId } from './id'
import { createLogger } from './logger'
import { createFailedResponse, sendRequest, type RequestRuntime } from './request'
import { BrowserState, getDefaultStorage } from './state'
import type { BrowserFetch, BrowserNavigator, NewSessionInfo, PostHog, PostHogOptions, StorageLike } from './types'
import { version } from './version'

const DEFAULT_API_HOST = 'https://us.i.posthog.com'
const DEFAULT_REMOTE_CONFIG_TIMEOUT_MS = 10_000

interface CaptureEnvelope {
    uuid: string
    event: string
    properties: Record<string, unknown>
    timestamp: string
}

const getDefaultFetch = (): BrowserFetch | undefined => {
    try {
        return globalThis.fetch?.bind(globalThis)
    } catch {
        return undefined
    }
}

const getDefaultNavigator = (): BrowserNavigator | undefined => {
    try {
        return globalThis.navigator
    } catch {
        return undefined
    }
}

const eventTimestamp = (timestamp: Date | undefined): string => {
    try {
        return (timestamp ?? new Date()).toISOString()
    } catch {
        return new Date().toISOString()
    }
}

class PostHogBrowserClient implements PostHog {
    readonly logger: Client['logger']
    readonly kv: Client['kv']
    readonly onRemoteConfig: Client['onRemoteConfig']
    readonly onEvent: Client['onEvent']
    readonly onNewSession: PostHog['onNewSession']
    readonly projectToken: string

    private readonly _remoteConfigPublisher: Publisher<RemoteConfigResult>
    private readonly _eventPublisher: Publisher<CapturedEventInfo>
    private readonly _newSessionPublisher: Publisher<NewSessionInfo>
    private readonly _registry: ExtensionRegistry
    private readonly _dynamicEventProperties: Array<() => Record<string, unknown>> = []
    private readonly _pendingDeliveries = new Set<Promise<ApiResponse>>()
    private readonly _requestRuntime: RequestRuntime
    private readonly _state: BrowserState
    private readonly _blocked: boolean
    private readonly _remoteConfigLoader: (() => Promise<RemoteConfig | undefined>) | undefined
    private readonly _remoteConfigTimeoutMs: number
    private _remoteConfig: RemoteConfig | undefined
    private _latestRemoteConfigResult: RemoteConfigResult | undefined
    private _remoteConfigPromise: Promise<RemoteConfig | undefined> | undefined
    private _disposed = false

    constructor(projectToken: string, options: PostHogOptions) {
        this.projectToken = projectToken
        this.logger = createLogger('[PostHog]', options.debug ?? false)
        this._remoteConfigPublisher = new Publisher((error) =>
            this.logger.error('A remote configuration listener failed', error)
        )
        this._eventPublisher = new Publisher((error) => this.logger.error('An event listener failed', error))
        this._newSessionPublisher = new Publisher((error) => this.logger.error('A session listener failed', error))

        const browserNavigator: BrowserNavigator | undefined =
            options.navigator === false ? undefined : (options.navigator ?? getDefaultNavigator())
        const browserFetch: BrowserFetch | undefined =
            options.fetch === false ? undefined : (options.fetch ?? getDefaultFetch())
        this._blocked =
            !(options.disableBotDetection ?? false) && isLikelyBot(browserNavigator, options.blockedUserAgents ?? [])

        const requestedStorage: StorageLike | undefined =
            options.storage === false ? undefined : (options.storage ?? getDefaultStorage())
        const storage = this._blocked ? undefined : requestedStorage
        this._state = new BrowserState(projectToken, storage, options.persistenceKey, options.optOutByDefault ?? false)
        const apiHost = (options.apiHost ?? DEFAULT_API_HOST).replace(/\/+$/, '')
        this._requestRuntime = {
            hosts: {
                api: apiHost,
                flags: (options.flagsHost ?? apiHost).replace(/\/+$/, ''),
                assets: (options.assetsHost ?? apiHost).replace(/\/+$/, ''),
            },
            projectToken,
            fetch: browserFetch,
            navigator: browserNavigator,
        }
        this._remoteConfig = options.remoteConfig
        this._remoteConfigLoader = options.remoteConfigLoader
        this._remoteConfigTimeoutMs =
            options.remoteConfigTimeoutMs === undefined || !Number.isFinite(options.remoteConfigTimeoutMs)
                ? DEFAULT_REMOTE_CONFIG_TIMEOUT_MS
                : Math.max(0, options.remoteConfigTimeoutMs)

        this.kv = this._state.keyValueStore('core')
        this._latestRemoteConfigResult = this._remoteConfig ? { ok: true, config: this._remoteConfig } : undefined
        this.onRemoteConfig = (handler) => {
            if (this._disposed) {
                return { dispose() {} }
            }

            const subscription = this._remoteConfigPublisher.listener(handler)
            if (this._latestRemoteConfigResult) {
                try {
                    handler(this._latestRemoteConfigResult)
                } catch (error) {
                    this.logger.error('A remote configuration listener failed', error)
                }
            } else {
                void this.getRemoteConfig()
            }
            return subscription
        }
        this.onEvent = this._eventPublisher.listener
        this.onNewSession = this._newSessionPublisher.listener
        this._registry = new ExtensionRegistry(
            (extensionName) => this._createExtensionClient(extensionName),
            this.logger
        )
    }

    get distinctId(): string {
        return this._state.distinctId
    }

    get anonymousId(): string {
        return this._state.anonymousId
    }

    get groups(): Record<string, string> {
        return this._state.groups
    }

    get session(): SessionContext {
        return this._state.session
    }

    async capture(
        event: string,
        properties: Record<string, unknown> | null = null,
        options: CaptureOptions = {}
    ): Promise<void> {
        if (this._disposed || this._blocked || this.hasOptedOut() || !event) {
            return
        }

        const dynamicProperties: Record<string, unknown> = {}
        this._dynamicEventProperties.slice().forEach((producer) => {
            try {
                Object.assign(dynamicProperties, producer())
            } catch (error) {
                this.logger.error('An event property producer failed', error)
            }
        })

        const sessionUpdate = this._state.sessionForEvent()
        if (sessionUpdate.reason) {
            this._publishNewSession({ ...sessionUpdate.session, reason: sessionUpdate.reason })
        }
        const session = sessionUpdate.session
        const finalProperties: Record<string, unknown> = {
            ...dynamicProperties,
            ...(properties ?? {}),
            token: this.projectToken,
            distinct_id: this.distinctId,
            $groups: this.groups,
            $session_id: session.sessionId,
            $window_id: session.windowId,
            $lib: 'web',
            $lib_version: version,
        }
        if (options.set) {
            finalProperties['$set'] = options.set
        }
        if (options.setOnce) {
            finalProperties['$set_once'] = options.setOnce
        }

        const envelope: CaptureEnvelope = {
            uuid: options.uuid ?? createId(),
            event,
            properties: finalProperties,
            timestamp: eventTimestamp(options.timestamp),
        }

        const delivery = this.sendRequest('/e/', { method: 'POST', body: envelope })
        this._pendingDeliveries.add(delivery)
        void delivery.then(
            () => this._pendingDeliveries.delete(delivery),
            () => this._pendingDeliveries.delete(delivery)
        )
        try {
            const observedProperties = JSON.parse(JSON.stringify(finalProperties)) as Record<string, unknown>
            this._eventPublisher.publish({ event, properties: observedProperties })
        } catch (error) {
            this.logger.error('Event properties are not JSON-serializable', error)
        }

        const response = await delivery
        if (response.error || response.statusCode >= 400) {
            this.logger.error('Event delivery failed', response.error ?? response.statusCode)
        }
    }

    async identify(
        distinctId: string,
        set?: Record<string, unknown>,
        setOnce?: Record<string, unknown>
    ): Promise<void> {
        if (!distinctId || this._disposed || this.hasOptedOut()) {
            return
        }

        const previousDistinctId = this.distinctId
        const wasIdentified = this._state.isIdentified
        const captureOptions: CaptureOptions = {}
        if (set !== undefined) {
            captureOptions.set = set
        }
        if (setOnce !== undefined) {
            captureOptions.setOnce = setOnce
        }

        if (distinctId === previousDistinctId) {
            if (set !== undefined || setOnce !== undefined) {
                await this.capture('$set', null, captureOptions)
            }
            return
        }

        this._state.identify(distinctId)
        if (!wasIdentified) {
            await this.capture('$identify', { $anon_distinct_id: previousDistinctId }, captureOptions)
        } else if (set !== undefined || setOnce !== undefined) {
            await this.capture('$set', null, captureOptions)
        }
    }

    async group(type: string, key: string, properties?: Record<string, unknown>): Promise<void> {
        if (!type || !key || this._disposed || this.hasOptedOut()) {
            return
        }

        this._state.group(type, key)
        await this.capture('$groupidentify', {
            $group_type: type,
            $group_key: key,
            $group_set: properties ?? {},
        })
    }

    reset(): void {
        if (this._disposed) {
            return
        }

        const session = this._state.reset()
        this._publishNewSession({ ...session, reason: 'reset' })
    }

    async flush(): Promise<void> {
        await Promise.all([...this._pendingDeliveries])
    }

    optIn(): void {
        if (!this._disposed) {
            this._state.optIn()
        }
    }

    optOut(): void {
        if (!this._disposed) {
            this._state.optOut()
        }
    }

    hasOptedOut(): boolean {
        return this._state.consent === 'denied'
    }

    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable {
        if (this._disposed) {
            return { dispose() {} }
        }

        this._dynamicEventProperties.push(producer)
        let active = true

        return {
            dispose: () => {
                if (!active) {
                    return
                }
                active = false
                const index = this._dynamicEventProperties.indexOf(producer)
                if (index !== -1) {
                    this._dynamicEventProperties.splice(index, 1)
                }
            },
        }
    }

    sendRequest(path: string, init?: SendRequestInit): Promise<ApiResponse> {
        return this._disposed
            ? Promise.resolve(createFailedResponse(new Error('The PostHog client is disposed')))
            : sendRequest(this._requestRuntime, path, init)
    }

    async getRemoteConfig(): Promise<RemoteConfig | undefined> {
        if (this._disposed) {
            return undefined
        }
        if (this._remoteConfig !== undefined || !this._remoteConfigLoader) {
            return this._remoteConfig
        }

        if (!this._remoteConfigPromise) {
            let timeout: ReturnType<typeof setTimeout> | undefined
            const timeoutResult = new Promise<undefined>((resolve) => {
                timeout = globalThis.setTimeout(() => resolve(undefined), this._remoteConfigTimeoutMs)
            })
            this._remoteConfigPromise = Promise.race([
                Promise.resolve().then(() => this._remoteConfigLoader?.()),
                timeoutResult,
            ])
                .then((remoteConfig) => {
                    if (this._disposed) {
                        return undefined
                    }

                    this._latestRemoteConfigResult = remoteConfig ? { ok: true, config: remoteConfig } : { ok: false }
                    if (remoteConfig) {
                        this._remoteConfig = remoteConfig
                    }
                    this._remoteConfigPublisher.publish(this._latestRemoteConfigResult)
                    return remoteConfig
                })
                .catch((error: unknown) => {
                    this.logger.error('Remote configuration failed', error)
                    if (!this._disposed) {
                        this._latestRemoteConfigResult = { ok: false }
                        this._remoteConfigPublisher.publish(this._latestRemoteConfigResult)
                    }
                    return undefined
                })
                .finally(() => {
                    if (timeout !== undefined) {
                        globalThis.clearTimeout(timeout)
                    }
                })
        }

        return this._remoteConfigPromise
    }

    getExtension<T extends Extension = Extension>(name: string): T | undefined {
        return this._registry.get<T>(name)
    }

    installExtension(extension: Extension): Promise<Disposable> {
        if (this._disposed) {
            return Promise.reject(new Error('The PostHog client is disposed'))
        }
        return this._registry.install(extension)
    }

    loadExtension(loader: () => Promise<Extension>): Promise<Disposable> {
        if (this._disposed) {
            return Promise.reject(new Error('The PostHog client is disposed'))
        }
        return this._registry.load(loader)
    }

    async dispose(): Promise<void> {
        if (this._disposed) {
            return
        }
        this._disposed = true

        await this._registry.dispose()
        await this.flush()
        this._remoteConfigPublisher.dispose()
        this._eventPublisher.dispose()
        this._newSessionPublisher.dispose()
        this._dynamicEventProperties.splice(0)
    }

    private _createExtensionClient(extensionName: string): Client {
        const host = this
        const logger = this.logger.createLogger(extensionName)
        const kv = this._state.keyValueStore(extensionName)

        return {
            get distinctId() {
                return host.distinctId
            },
            get anonymousId() {
                return host.anonymousId
            },
            get groups() {
                return host.groups
            },
            get session() {
                return host.session
            },
            capture: (event, properties, options) => host.capture(event, properties, options),
            registerDynamicEventProperties: (producer) => host.registerDynamicEventProperties(producer),
            get projectToken() {
                return host.projectToken
            },
            sendRequest: (path, init) => host.sendRequest(path, init),
            onRemoteConfig: host.onRemoteConfig,
            onEvent: host.onEvent,
            kv,
            logger,
        }
    }

    private _publishNewSession(session: NewSessionInfo): void {
        this._newSessionPublisher.publish(session)
    }
}

export const createPostHog = async (projectToken: string, options: PostHogOptions = {}): Promise<PostHog> => {
    if (!projectToken) {
        throw new Error('A PostHog project token is required')
    }

    const client = new PostHogBrowserClient(projectToken, options)
    for (const extension of options.extensions ?? []) {
        try {
            await client.installExtension(extension)
        } catch (error) {
            client.logger.error(`Failed to install configured extension "${extension.name}"`, error)
        }
    }
    return client
}
