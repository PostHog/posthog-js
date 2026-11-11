import { loadRemoteConfig } from './remote-config'
import type {
    IPostHogInternal,
    BrowserExtension as Extension,
    BrowserProducts,
    ConsentChangeInfo,
    IdentifyInfo,
    GroupInfo,
} from './context/browser-client'
import {
    type ApiResponse,
    type CapturedEventInfo,
    type Client,
    type Disposable,
    type ExtensionToken,
    type RemoteConfig,
    type RemoteConfigResult,
    type SendRequestInit,
    type SessionContext,
} from '@posthog/browser-common'
import { Publisher } from '@posthog/browser-common/pubsub'

import {
    isAnalyticsExtension,
    type AnalyticsCaptureHost,
    type IAnalyticsExtension,
} from '../products/analytics/analytics-internal'
import { isLikelyBot } from './state/bot-filter'
import { ExtensionRegistry, type AutomaticExtension, type ExtensionLoader } from './extensions/registry'
import { deepFreeze } from '../primitives/immutable'
import { createLogger } from '../platform/logger'
import { sendRequest, type RequestRuntime } from '../platform/request'
import { BrowserState, getDefaultSessionStorage, getDefaultStorage } from './state/state'
import type { BrowserFetch, BrowserNavigator, CorePostHogOptions, NewSessionInfo, IPostHog, StorageLike } from './types'
import { version } from '../primitives/version'

const CONSENT_CHANGE_EVENT = '__posthog_browser_consent_change__'
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000

const normalizeHost = (host: string): string => {
    let end = host.length
    while (end > 0 && host.charCodeAt(end - 1) === 47) {
        end--
    }
    return end === host.length ? host : host.slice(0, end)
}
const getAssetsHost = (apiHost: string): string => {
    try {
        const url = new URL(apiHost)
        if (url.protocol === 'https:') {
            const region = /^(app|us|us-assets|eu|eu-assets)(\.i)?\.posthog\.com$/.exec(url.hostname)?.[1]
            if (region) {
                return `https://${region.startsWith('eu') ? 'eu' : 'us'}-assets.i.posthog.com`
            }
        }
    } catch {
        // Invalid hosts are reported by the request sender.
    }
    return apiHost
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

/** Module-private client; the top-level factory owns its initialization. */
class PostHog implements IPostHog {
    declare readonly analytics?: BrowserProducts['analytics']
    declare readonly featureFlags?: BrowserProducts['featureFlags']
    declare readonly logs?: BrowserProducts['logs']
    declare readonly surveys?: BrowserProducts['surveys']
    declare readonly autocapture?: BrowserProducts['autocapture']
    readonly logger: Client['logger']
    readonly kv: Client['kv']
    readonly library = Object.freeze({ name: 'web', version })
    readonly initialPersonProperties: Readonly<Record<string, unknown>>
    readonly onRemoteConfig: Client['onRemoteConfig']
    readonly onNewSession: IPostHog['onNewSession']
    readonly onIdentify: IPostHogInternal['onIdentify']
    readonly onGroup: IPostHogInternal['onGroup']
    readonly onGroupsReset: IPostHogInternal['onGroupsReset']
    readonly onReset: IPostHogInternal['onReset']
    readonly onConsentChange: IPostHogInternal['onConsentChange']
    readonly onSession: Client['onSession']
    readonly projectToken: string

    private readonly _remoteConfigPublisher: Publisher<RemoteConfigResult>
    private readonly _eventPublisher: Publisher<CapturedEventInfo>
    private readonly _newSessionPublisher: Publisher<NewSessionInfo>
    private readonly _identifyPublisher: Publisher<IdentifyInfo>
    private readonly _groupPublisher: Publisher<GroupInfo>
    private readonly _groupsResetPublisher: Publisher<void>
    private readonly _resetPublisher: Publisher<void>
    readonly _registry: ExtensionRegistry<IPostHogInternal>
    readonly _requestRuntime: RequestRuntime
    private _analytics: IAnalyticsExtension | undefined
    private readonly _state: BrowserState
    private readonly _consentObservation: Disposable
    private readonly _blocked: boolean
    private readonly _capturePageview: boolean
    private readonly _remoteConfigTimeoutMs: number
    private _remoteConfig: RemoteConfig | undefined
    private _latestRemoteConfigResult: RemoteConfigResult | undefined
    private _remoteConfigPromise: Promise<RemoteConfig | undefined> | undefined
    private _cancelRemoteConfigWait: (() => void) | undefined
    private _immediateAuthority = {}
    private readonly _consentChangePublisher: Publisher<ConsentChangeInfo>
    private _closing = false
    private _disposed = false
    private _shutdownPromise: Promise<void> | undefined
    private _initialPageviewPending = true
    private _ready = false
    private _pageviewLoading: Promise<void> | undefined
    private _pageviewListener: [Document, EventListener] | undefined

    static create(
        options: CorePostHogOptions,
        loaders: Readonly<Record<string, ExtensionLoader<IPostHogInternal>>>
    ): PostHog {
        return new PostHog(options, loaders)
    }

    private constructor(
        options: CorePostHogOptions,
        loaders: Readonly<Record<string, ExtensionLoader<IPostHogInternal>>>
    ) {
        let projectToken = ''
        try {
            projectToken = options.projectToken ?? ''
        } catch {
            // An unavailable token disables capture and requests.
        }
        this.projectToken = projectToken
        this._capturePageview = options.capturePageview ?? true
        this.logger = createLogger('[PostHog]', options.debug ?? false)
        if (!projectToken) {
            this.logger.error('A PostHog project token is required')
        }
        const initialPersonProperties = options.initialPersonProperties
        try {
            this.initialPersonProperties = initialPersonProperties
                ? deepFreeze(JSON.parse(JSON.stringify(initialPersonProperties)) as Record<string, unknown>)
                : Object.freeze({})
        } catch {
            this.initialPersonProperties = Object.freeze({})
        }
        this._remoteConfigPublisher = new Publisher((error) =>
            this.logger.error('A remote configuration listener failed', error)
        )
        this._eventPublisher = new Publisher((error) => this.logger.error('An event listener failed', error))
        this._identifyPublisher = new Publisher((error) => this.logger.error('An identify listener failed', error))
        this._groupPublisher = new Publisher((error) => this.logger.error('A group listener failed', error))
        this._groupsResetPublisher = new Publisher((error) => this.logger.error('A group reset listener failed', error))
        this._resetPublisher = new Publisher((error) => this.logger.error('A reset listener failed', error))
        this._newSessionPublisher = new Publisher((error) => this.logger.error('A session listener failed', error))
        this._consentChangePublisher = new Publisher((error) =>
            this.logger.error('A consent change listener failed', error)
        )

        const browserNavigator: BrowserNavigator | undefined =
            options.navigator === false ? undefined : (options.navigator ?? getDefaultNavigator())
        const browserFetch: BrowserFetch | undefined =
            options.fetch === false ? undefined : (options.fetch ?? getDefaultFetch())
        this._blocked =
            !projectToken ||
            (!(options.disableBotDetection ?? false) && isLikelyBot(browserNavigator, options.blockedUserAgents ?? []))

        const requestedStorage: StorageLike | undefined =
            options.storage === false ? undefined : (options.storage ?? getDefaultStorage())
        const storage = this._blocked ? undefined : requestedStorage
        this._state = new BrowserState(
            projectToken,
            storage,
            options.persistenceKey,
            options.consentPersistenceName,
            options.optOutByDefault ?? false,
            !this._blocked && options.storage === undefined && requestedStorage !== undefined
                ? getDefaultSessionStorage
                : undefined,
            (consent, previous) => {
                if (consent === 'denied') {
                    this._immediateAuthority = {}
                    this._analytics?.purge()
                }
                this._consentChangePublisher.publish({ current: consent, previous })
            }
        )
        this._consentObservation = this._observeConsent(
            storage,
            !this._blocked && options.storage === undefined && requestedStorage !== undefined
        )
        const apiHost = normalizeHost(options.apiHost ?? 'https://us.i.posthog.com')
        this._requestRuntime = [
            {
                api: apiHost,
                flags: normalizeHost(options.flagsHost ?? apiHost),
                assets: getAssetsHost(apiHost),
            },
            projectToken,
            browserFetch,
            browserNavigator,
        ]
        this._remoteConfig = options.remoteConfig
        this._remoteConfigTimeoutMs =
            options.remoteConfigTimeoutMs === undefined || !Number.isFinite(options.remoteConfigTimeoutMs)
                ? 10_000
                : Math.max(0, options.remoteConfigTimeoutMs)

        this.kv = this._state.keyValueStore('core', () => !this._closing && !this._disposed && this._state.prepare())
        this._latestRemoteConfigResult = this._remoteConfig ? { ok: true, config: this._remoteConfig } : undefined
        this.onRemoteConfig = (handler) => {
            if (this._closing || this._disposed) {
                return { dispose() {} }
            }
            const subscription = this._remoteConfigPublisher.listener(handler)
            if (this._latestRemoteConfigResult) {
                try {
                    handler(this._latestRemoteConfigResult)
                } catch (error) {
                    this.logger.error('A remote configuration listener failed', error)
                }
            } else if (!this._closing && !this._disposed) {
                void this.getRemoteConfig()
            }
            return subscription
        }
        this.onIdentify = this._identifyPublisher.listener
        this.onGroup = this._groupPublisher.listener
        this.onGroupsReset = this._groupsResetPublisher.listener
        this.onReset = this._resetPublisher.listener
        this.onConsentChange = this._consentChangePublisher.listener
        this.onNewSession = this._newSessionPublisher.listener
        this.onSession = (listener) => this.onNewSession((session) => listener(session.sessionId))
        this._registry = new ExtensionRegistry(
            (extensionName, resolve) => this._createExtensionClient(extensionName, resolve),
            this.logger,
            loaders,
            (extension, host) => this._setupExtension(extension, host),
            () => !this._closing && !this._disposed
        )
        this._registry.expose(this)
    }

    get distinctId(): string {
        this._state.prepare()
        return this._state.distinctId
    }

    get anonymousId(): string {
        this._state.prepare()
        return this._state.anonymousId
    }

    get deviceId(): string | undefined {
        this._state.prepare()
        return this._state.deviceId
    }

    get groups(): Record<string, string> {
        this._state.prepare()
        return this._state.groups
    }

    get session(): SessionContext | undefined {
        this._state.prepare()
        return this._state.session
    }

    get isOptedOut(): boolean {
        return this.hasOptedOut()
    }

    get canCapture(): boolean {
        return !this._closing && !this._disposed && !this._blocked && !this.hasOptedOut() && this._state.prepare()
    }

    async flush(): Promise<void> {
        await this._registry.flush()
    }

    optIn(): void {
        if (this._disposed) {
            return
        }
        if (this._state.optIn()) {
            this._dispatchConsentChange()
        }
        this._startInitialPageview()
    }

    optOut(): void {
        if (!this._disposed && this._state.optOut()) {
            this._dispatchConsentChange()
        }
    }

    hasOptedOut(): boolean {
        return this._state.consent === 'denied'
    }

    sendRequest(path: string, init?: SendRequestInit): Promise<ApiResponse> {
        return sendRequest(this._requestRuntime, path, init, () => !this._blocked && !this.hasOptedOut())
    }

    async getRemoteConfig(): Promise<RemoteConfig | undefined> {
        if (this._closing || this._disposed) {
            return undefined
        }
        if (this._remoteConfig !== undefined) {
            return this._remoteConfig
        }

        if (!this._remoteConfigPromise) {
            let timeout: ReturnType<typeof setTimeout> | undefined
            let invalidated = false
            let controller: AbortController | undefined
            let cancelWait: (() => void) | undefined
            const timeoutResult = new Promise<undefined>((resolve) => {
                cancelWait = () => {
                    if (timeout !== undefined) {
                        try {
                            globalThis.clearTimeout(timeout)
                        } catch {
                            // Resolving the wait remains authoritative.
                        }
                        timeout = undefined
                    }
                    resolve(undefined)
                }
                this._cancelRemoteConfigWait = cancelWait
                try {
                    timeout = globalThis.setTimeout(cancelWait, this._remoteConfigTimeoutMs)
                } catch {
                    cancelWait()
                }
            })
            this._remoteConfigPromise = Promise.race([
                Promise.resolve().then(() => {
                    if (this._closing || this._disposed) {
                        invalidated = true
                        return undefined
                    }
                    controller =
                        typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : undefined
                    return loadRemoteConfig(
                        this._requestRuntime,
                        controller?.signal,
                        () => !this._closing && !this._disposed && !this._blocked
                    )
                }),
                timeoutResult,
            ])
                .then((remoteConfig) => {
                    if (this._closing || this._disposed) {
                        invalidated = true
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
                    if (this._closing || this._disposed) {
                        invalidated = true
                        return undefined
                    }
                    this.logger.error('Remote configuration failed', error)
                    this._latestRemoteConfigResult = { ok: false }
                    this._remoteConfigPublisher.publish(this._latestRemoteConfigResult)
                    return undefined
                })
                .finally(() => {
                    try {
                        controller?.abort()
                    } catch {
                        // Settlement remains authoritative when cancellation is unavailable.
                    }
                    if (timeout !== undefined) {
                        try {
                            globalThis.clearTimeout(timeout)
                        } catch {
                            // Promise settlement remains authoritative.
                        }
                    }
                    if (this._cancelRemoteConfigWait === cancelWait) {
                        this._cancelRemoteConfigWait = undefined
                    }
                    if (invalidated) {
                        this._remoteConfigPromise = undefined
                    }
                })
        }

        return this._remoteConfigPromise
    }

    resolveExtension<T extends Extension>(token: ExtensionToken<T>): Promise<T | undefined>
    resolveExtension<Name extends keyof BrowserProducts>(name: Name): Promise<BrowserProducts[Name] | undefined>
    resolveExtension<T extends Extension = Extension>(name: string): Promise<T | undefined>
    resolveExtension(name: string): Promise<Extension | undefined> {
        return this._closing || this._disposed ? Promise.resolve(undefined) : this._registry.resolve(name)
    }

    shutdown(shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
        if (!this._shutdownPromise) {
            this._closing = true
            const extensionFlush = this._registry.flush('shutdown')
            this._removePageviewListener()
            try {
                this._consentObservation.dispose()
            } catch {
                // Fresh consent reads remain authoritative while delivery finishes.
            }
            try {
                this._cancelRemoteConfigWait?.()
            } catch {
                // Shutdown remains bounded when timer cleanup is hostile.
            }
            this._shutdownPromise = this._shutdown(shutdownTimeoutMs, extensionFlush)
        }
        return this._shutdownPromise
    }

    dispose(): Promise<void> {
        return this.shutdown()
    }

    private async _shutdown(shutdownTimeoutMs: number, extensionFlush: Promise<void>): Promise<void> {
        const timeoutMs = Math.max(
            0,
            Math.floor(Number.isFinite(shutdownTimeoutMs) ? shutdownTimeoutMs : DEFAULT_SHUTDOWN_TIMEOUT_MS)
        )
        let timer: ReturnType<typeof globalThis.setTimeout> | undefined
        let timedOut = false
        const timeout = new Promise<void>((resolve) => {
            try {
                timer = globalThis.setTimeout(() => {
                    timedOut = true
                    resolve()
                }, timeoutMs)
            } catch {
                timedOut = true
                resolve()
            }
        })

        try {
            await Promise.race([extensionFlush, timeout])

            this._disposed = true
            try {
                this._state.dispose()
            } catch (error) {
                this.logger.error('Failed to dispose browser state', error)
            }

            this._analytics = undefined
            const cleanup = this._registry
                .dispose()
                .catch((error) => this.logger.error('Failed to dispose extensions', error))
            this._remoteConfigPublisher.dispose()
            this._eventPublisher.dispose()
            this._identifyPublisher.dispose()
            this._groupPublisher.dispose()
            this._groupsResetPublisher.dispose()
            this._resetPublisher.dispose()
            this._consentChangePublisher.dispose()
            this._newSessionPublisher.dispose()
            await Promise.race([cleanup, timeout])
            if (timedOut) {
                this.logger.warn(`PostHog shutdown stopped waiting for cleanup after ${timeoutMs}ms`)
            }
        } catch (error) {
            this.logger.error('PostHog shutdown failed', error)
        } finally {
            if (timer !== undefined) {
                try {
                    globalThis.clearTimeout(timer)
                } catch {
                    // Detached cleanup remains inert after disposal.
                }
            }
        }
    }

    async _completeInitialization(): Promise<void> {
        await this._analytics?.start()
        this._ready = true
        this._startInitialPageview()
        await this._pageviewLoading
    }

    _startInitialPageview(): void {
        if (
            !this._ready ||
            !this._capturePageview ||
            !this._initialPageviewPending ||
            this._closing ||
            this._disposed ||
            !this._pageviewIsVisible()
        ) {
            return
        }
        this._removePageviewListener()
        if (!this._analytics) {
            this._loadInitialPageviewAnalytics()
            return
        }
        this._initialPageviewPending = false
        if (!this._analytics.captureInitialPageview()) {
            this._initialPageviewPending = !this._disposed && !this._blocked
        }
    }

    private _pageviewIsVisible(): boolean {
        let document: Document | undefined
        let visibility: DocumentVisibilityState | undefined
        try {
            document = globalThis.document
            visibility = document?.visibilityState
        } catch {
            this._cancelInitialPageview()
            return false
        }
        if (!document || visibility === undefined) {
            this._cancelInitialPageview()
            return false
        }
        if (visibility !== 'visible') {
            this._watchPageviewVisibility(document)
            return false
        }
        return true
    }

    private _watchPageviewVisibility(document: Document): void {
        if (this._pageviewListener?.[0] !== document) this._removePageviewListener()
        if (this._pageviewListener) return
        const listener = (): void => this._startInitialPageview()
        this._pageviewListener = [document, listener]
        try {
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            document.addEventListener('visibilitychange', listener)
        } catch {
            this._cancelInitialPageview()
        }
    }

    private _cancelInitialPageview(): void {
        this._removePageviewListener()
        this._initialPageviewPending = false
    }

    private _loadInitialPageviewAnalytics(): void {
        if (this._pageviewLoading || this._blocked || this.hasOptedOut()) return
        this._pageviewLoading = this.resolveExtension('analytics').then(() => {
            this._pageviewLoading = undefined
            if (this._analytics) this._startInitialPageview()
        })
    }

    private _removePageviewListener(): void {
        const listener = this._pageviewListener
        this._pageviewListener = undefined
        if (listener) {
            try {
                listener[0].removeEventListener('visibilitychange', listener[1])
            } catch {
                // Listener cleanup is best effort.
            }
        }
    }

    private _observeConsent(storage: StorageLike | undefined, observeNativeStorage: boolean): Disposable {
        if (!storage) {
            return { dispose() {} }
        }
        const refresh = (): void => {
            if (!this._disposed) {
                this._state.refreshConsent()
            }
        }
        const storageListener = (event: Event): void => {
            try {
                const storageEvent = event as StorageEvent
                if (
                    storageEvent.storageArea === storage &&
                    (storageEvent.key === null || storageEvent.key === this._state.consentKey)
                ) {
                    if (!this._disposed) {
                        this._state.observeConsent(storageEvent.newValue)
                    }
                }
            } catch {
                // Malformed browser events do not change consent.
            }
        }
        const localListener = (event: Event): void => {
            try {
                if ((event as CustomEvent<unknown>).detail === this._state.consentKey) {
                    refresh()
                }
            } catch {
                // Malformed SDK events do not change consent.
            }
        }
        let adapter: Disposable | undefined
        let storageListening = false
        let localListening = false
        if (observeNativeStorage) {
            try {
                // oxlint-disable-next-line posthog-js/no-add-event-listener
                globalThis.addEventListener('storage', storageListener)
                storageListening = true
            } catch {
                // Fresh reads remain authoritative when event observation is unavailable.
            }
        }
        try {
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            globalThis.addEventListener(CONSENT_CHANGE_EVENT, localListener)
            localListening = true
        } catch {
            // Fresh reads remain authoritative when event observation is unavailable.
        }
        try {
            adapter = storage?.subscribe?.(this._state.consentKey, refresh)
        } catch {
            // Plain and failing adapters fall back to fresh reads.
        }
        return {
            dispose: () => {
                if (storageListening) {
                    try {
                        globalThis.removeEventListener('storage', storageListener)
                    } catch {
                        // Listener cleanup is best effort.
                    }
                    storageListening = false
                }
                if (localListening) {
                    try {
                        globalThis.removeEventListener(CONSENT_CHANGE_EVENT, localListener)
                    } catch {
                        // Listener cleanup is best effort.
                    }
                    localListening = false
                }
                try {
                    adapter?.dispose()
                } catch {
                    // Adapter cleanup is best effort.
                }
            },
        }
    }

    private _dispatchConsentChange(): void {
        try {
            globalThis.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: this._state.consentKey }))
        } catch {
            // Fresh reads remain authoritative when same-document notification is unavailable.
        }
    }

    private _createSharedExtensionClient(extensionName: string): Client {
        const host = this
        const logger = this.logger.createLogger(extensionName)
        const kv = this._state.keyValueStore(
            extensionName,
            () => !this._closing && !this._disposed && this._state.prepare()
        )

        return {
            get distinctId() {
                return host.distinctId
            },
            get anonymousId() {
                return host.anonymousId
            },
            get deviceId() {
                return host.deviceId
            },
            get library() {
                return host.library
            },
            get initialPersonProperties() {
                return host.initialPersonProperties
            },
            get groups() {
                return host.groups
            },
            get session() {
                return host.session
            },
            get isOptedOut() {
                return host.isOptedOut
            },
            get canCapture() {
                return host.canCapture
            },
            get isRateLimited() {
                return host._analytics?.isRateLimited ?? false
            },
            capture: (event, properties, options) => host._analytics?.capture(event, properties, options) ?? true,
            registerDynamicEventProperties: (producer) =>
                host._analytics?.registerDynamicEventProperties(producer) ?? { dispose() {} },
            getExtension: (name) => host._registry.getShared(name),
            get projectToken() {
                return host.projectToken
            },
            sendRequest: (path, init) => host.sendRequest(path, init),
            onRemoteConfig: host.onRemoteConfig,
            onEvent: host._eventPublisher.listener,
            onSession: host.onSession,
            kv,
            logger,
        }
    }

    private _createExtensionClient(
        extensionName: string,
        resolve: (name: string) => Promise<Extension | undefined>
    ): IPostHogInternal {
        const host = this
        const sharedClient = this._createSharedExtensionClient(extensionName)
        const {
            getExtension: _lookup,
            capture: _capture,
            registerDynamicEventProperties: _registration,
            isRateLimited: _rateLimit,
            ...capabilities
        } = Object.getOwnPropertyDescriptors(sharedClient)
        const browserClient = Object.defineProperties(
            {
                sharedClient,
                resolveExtension: (name: string) =>
                    !this._closing && !this._disposed ? resolve(name) : Promise.resolve(undefined),
                onConsentChange: host.onConsentChange,
                onIdentify: host.onIdentify,
                onGroup: host.onGroup,
                onGroupsReset: host.onGroupsReset,
                onReset: host.onReset,
            },
            capabilities
        ) as IPostHogInternal
        this._registry.expose(browserClient)
        return browserClient
    }

    private async _setupExtension(extension: Extension, host: IPostHogInternal): Promise<void> {
        if (this._closing || this._disposed) throw new Error('The browser client is closing')
        if (!isAnalyticsExtension(extension)) {
            await extension.setup(host)
            if (this._closing || this._disposed) throw new Error('The browser client is closing')
            return
        }
        this._analytics = extension
        try {
            extension.bindCaptureHost(this._analyticsCaptureHost(extension))
            await extension.setup(host)
            if (this._closing || this._disposed) throw new Error('The browser client is closing')
            extension.initialize({
                runtime: this._requestRuntime,
                canRetry: () => this._canDeliver(),
                reportFailure: (error) => this.logger.error('Event delivery failed', error),
                reportWarning: (message) => this.logger.warn(message),
                onAvailable: () => this._startInitialPageview(),
            })
        } catch (error) {
            if (this._analytics === extension) this._analytics = undefined
            throw error
        }
    }

    private _canUseAnalytics(owner: IAnalyticsExtension): boolean {
        return this._analytics === owner && !this._closing && !this._disposed
    }

    _analyticsCaptureHost(owner: IAnalyticsExtension): AnalyticsCaptureHost {
        const canMutate = () => this._canUseAnalytics(owner)
        return {
            projectToken: this.projectToken,
            logger: this.logger,
            sessionKv: this._state.tabKeyValueStore('analytics', () => canMutate() && this._state.prepare()),
            state: this._state,
            canCapture: () => canMutate() && !this._blocked && !this.hasOptedOut(),
            canMutate,
            isDisposed: () => this._disposed,
            authority: () => this._immediateAuthority,
            onEvent: this._eventPublisher.listener,
            publishEvent: (event) => this._eventPublisher.publish(event),
            publishNewSession: (session) => this._newSessionPublisher.publish(session),
            publishIdentify: (info) => this._identifyPublisher.publish(info),
            publishGroup: (info) => this._groupPublisher.publish(info),
            publishGroupsReset: () => this._groupsResetPublisher.publish(undefined),
            publishReset: () => this._resetPublisher.publish(undefined),
        }
    }

    _canDeliver(): boolean {
        return !this._disposed && !this._blocked && !this.hasOptedOut()
    }
}

const selectConfiguredExtensions = (configured: readonly Extension[]): Map<string, Extension> => {
    const selected = new Map<string, Extension>()
    for (const extension of configured) if (!selected.has(extension.name)) selected.set(extension.name, extension)
    return selected
}

export const createPostHogCore = async (
    options: CorePostHogOptions,
    configured: readonly Extension[] = options?.extensions ?? [],
    automaticLoaders: Readonly<Record<string, ExtensionLoader<IPostHogInternal>>> = {},
    automatic: readonly AutomaticExtension<IPostHogInternal>[] = []
): Promise<IPostHog> => {
    const selected = selectConfiguredExtensions(configured)
    const loaders = Object.fromEntries([
        ...Object.entries(automaticLoaders),
        ...Array.from(selected, ([name, extension]) => [name, () => extension] as const),
    ])
    const client = PostHog.create(options ?? { projectToken: '' }, loaders)
    void client.getRemoteConfig()
    if (selected.has('analytics')) await client.resolveExtension('analytics')
    for (const name of selected.keys()) if (name !== 'analytics') await client.resolveExtension(name)
    for (const extension of automatic) await client._registry.activate(extension)
    await client._completeInitialization()
    return client
}
