import { loadRemoteConfig } from './remote-config'
import type { BrowserExtension as Extension, BrowserProducts, ConsentChangeInfo } from './context/browser-client'
import type {
    ApiResponse,
    CaptureOptions,
    Client,
    Disposable,
    ExtensionToken,
    KeyValueStore,
    RemoteConfig,
    RemoteConfigResult,
    SendRequestInit,
    SessionContext,
} from '@posthog/browser-common'
import { Publisher } from '@posthog/browser-common/pubsub'

import { Analytics } from '../products/analytics/analytics-core'
import * as groups from '../products/analytics/groups'
import * as person from '../products/analytics/person'
import type { AnalyticsDeliveryFactory } from '../products/analytics/analytics-internal'
import type { AnalyticsOptions } from '../products/analytics/analytics-options'
import { isLikelyBot } from './state/bot-filter'
import { ExtensionRegistry, type AutomaticExtension, type ExtensionLoader } from './extensions/registry'
import { deepFreeze } from '../primitives/immutable'
import { createLogger, type LogState } from '../platform/logger'
import { snapshotPersonProfileMode } from '../products/analytics/properties/person-processing'
import { sendRequest, type RequestRuntime } from '../platform/request'
import { BrowserState, CLIENT_KV_NAMESPACE, getDefaultSessionStorage, getDefaultStorage } from './state/state'
import type {
    BrowserFetch,
    BrowserNavigator,
    CaptureSummary,
    CorePostHogOptions,
    ExplicitConsentStatus,
    IPostHog,
    ResetOptions,
    RuntimeOptions,
    StorageLike,
} from './types'
import { version } from '../primitives/version'
import type { FlagsExtension } from '../products/flags/flags-internal'

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

/** The one browser client. Extensions receive this instance; the top-level factory owns its initialization. */
class PostHog implements IPostHog {
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
    readonly onSessionId: IPostHog['onSessionId']
    readonly onEvent: IPostHog['onEvent']
    readonly onIdentify: IPostHog['onIdentify']
    readonly onChangeProperties: IPostHog['onChangeProperties']
    readonly onGroup: IPostHog['onGroup']
    readonly onGroupsReset: IPostHog['onGroupsReset']
    readonly onReset: IPostHog['onReset']
    readonly onConsentChange: IPostHog['onConsentChange']
    readonly onSession: Client['onSession']
    readonly projectToken: string

    private readonly _logState: LogState
    private readonly _remoteConfigPublisher: Publisher<RemoteConfigResult>
    readonly _registry: ExtensionRegistry<IPostHog>
    readonly _requestRuntime: RequestRuntime
    readonly _analytics: Analytics
    readonly _state: BrowserState
    readonly _sessionKv: KeyValueStore
    private readonly _consentObservation: Disposable
    private readonly _blocked: boolean
    private readonly _capturePageview: boolean
    private readonly _remoteConfigTimeoutMs: number
    private _remoteConfig: RemoteConfig | undefined
    private _latestRemoteConfigResult: RemoteConfigResult | undefined
    private _remoteConfigPromise: Promise<RemoteConfig | undefined> | undefined
    private _cancelRemoteConfigWait: (() => void) | undefined
    _immediateAuthority = {}
    /** Whether work admitted before a cleared consent choice may still deliver while consent rests at its default denial. */
    private _clearedChoiceRetainsWork = false
    private readonly _consentChangePublisher: Publisher<ConsentChangeInfo>
    private _closing = false
    _disposed = false
    private _shutdownPromise: Promise<void> | undefined
    private _initialPageviewPending = true
    private _ready = false
    private _pageviewListener: [Document, EventListener] | undefined

    static create(
        options: CorePostHogOptions,
        createDelivery: AnalyticsDeliveryFactory,
        loaders: Readonly<Record<string, ExtensionLoader<IPostHog>>>
    ): PostHog {
        return new PostHog(options, createDelivery, loaders)
    }

    private constructor(
        options: CorePostHogOptions,
        createDelivery: AnalyticsDeliveryFactory,
        loaders: Readonly<Record<string, ExtensionLoader<IPostHog>>>
    ) {
        let projectToken = ''
        try {
            projectToken = options.projectToken ?? ''
        } catch {
            // An unavailable token disables capture and requests.
        }
        this.projectToken = projectToken
        this._capturePageview = options.capturePageview ?? true
        this._logState = { enabled: options.debug ?? false }
        this.logger = createLogger('[PostHog]', this._logState)
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
            (consent, previous, explicit) => {
                // Only an explicit opt-out purges. A cleared choice (`reset()` or `clearOptInOut()`, here or in another
                // context) affects future events only, so its return to a default denial keeps admitted work.
                if (consent !== 'denied') {
                    // A grant ends any pause on kept work, so redrive it instead of waiting for the next capture.
                    if (this._clearedChoiceRetainsWork) void this._analytics?.flush()
                    this._clearedChoiceRetainsWork = false
                } else if (!explicit) this._clearedChoiceRetainsWork = true
                else this._revokeAdmittedWork()
                this._consentChangePublisher.publish({ current: consent, previous })
            },
            options.cookie
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

        this.kv = this._state.keyValueStore(CLIENT_KV_NAMESPACE, () => this._canMutate() && this._state.prepare())
        this._sessionKv = this._state.tabKeyValueStore('analytics', () => this._canMutate() && this._state.prepare())
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
        let analyticsOptions: AnalyticsOptions = {}
        try {
            analyticsOptions = options.analytics ?? {}
            if ((analyticsOptions as unknown) === false) {
                this.logger.warn(
                    'The `analytics: false` option was removed in this version, so events are captured. Set `capturePageview: false` to skip the initial $pageview and, on the root entrypoint, `autocapture: false` to turn off autocapture.'
                )
            }
        } catch {
            // Unreadable analytics options retain the defaults.
        }
        this._analytics = new Analytics(this, analyticsOptions, createDelivery)
        this.onEvent = this._analytics._eventPublisher.listener
        this.onIdentify = this._analytics._identifyPublisher.listener
        this.onChangeProperties = this._analytics._changePropertiesPublisher.listener
        this.onGroup = this._analytics._groupPublisher.listener
        this.onGroupsReset = this._analytics._groupsResetPublisher.listener
        this.onReset = this._analytics._resetPublisher.listener
        this.onNewSession = this._analytics._newSessionPublisher.listener
        this.onConsentChange = this._consentChangePublisher.listener
        this.onSession = (listener) => this.onNewSession((session) => listener(session.sessionId))
        this.onSessionId = (handler) => {
            const subscription = this._analytics._sessionIdPublisher.listener(handler)
            const session = this._canMutate() ? this.session : undefined
            if (session) {
                try {
                    handler(session)
                } catch (error) {
                    this.logger.error('A session ID listener failed', error)
                }
            }
            return subscription
        }
        this._registry = new ExtensionRegistry<IPostHog>(this, this.logger, loaders, () => this._canMutate())
        if (options.bootstrap) this._analytics.bootstrap(options.bootstrap)
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

    get isRateLimited(): boolean {
        return this._analytics.isRateLimited
    }

    capture(event: string, properties?: Record<string, unknown> | null, options?: CaptureOptions): boolean {
        return this._analytics.capture(event, properties, options)
    }

    captureImmediate(
        event: string,
        properties?: Record<string, unknown> | null,
        options?: CaptureOptions
    ): Promise<CaptureSummary> {
        return this._analytics.captureImmediate(event, properties, options)
    }

    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void {
        this._analytics.identify(distinctId, set, setOnce)
    }

    reset(options?: boolean | ResetOptions): void {
        // Nothing resets during shutdown, so the stored choice stays with the identity it belongs to.
        if (!this._canMutate()) return
        // Consent is user state, so reset forgets the stored choice, as in posthog-js, iOS and Android. It is
        // forgotten before the identity reset, so a choice an `onReset` listener makes for the new identity stands.
        this.clearOptInOut()
        const bootstrap = this._analytics.reset(options)
        if (bootstrap) (this.featureFlags as FlagsExtension | undefined)?.bootstrap?.(bootstrap)
    }

    register(properties: Record<string, unknown>): void {
        this._analytics.register(properties)
    }

    registerOnce(properties: Record<string, unknown>, defaultValue?: unknown): void {
        this._analytics.registerOnce(properties, defaultValue)
    }

    unregister(property: string): void {
        this._analytics.unregister(property)
    }

    getProperty(property: string): unknown {
        return this._analytics.getProperty(property)
    }

    registerForSession(properties: Record<string, unknown>): void {
        this._analytics.registerForSession(properties)
    }

    unregisterForSession(property: string): void {
        this._analytics.unregisterForSession(property)
    }

    alias(aliasId: string): void {
        person.alias(this, aliasId)
    }

    group(type: string, key: string, properties?: Record<string, unknown>): void {
        groups.group(this, type, key, properties)
    }

    groupIdentify(
        type: string,
        key: string | number,
        properties?: Record<string, unknown>,
        options?: CaptureOptions
    ): void {
        groups.groupIdentify(this, type, key, properties, options)
    }

    resetGroups(): void {
        groups.resetGroups(this)
    }

    createPersonProfile(): void {
        person.createPersonProfile(this)
    }

    setPersonProperties(set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void {
        person.setPersonProperties(this, set, setOnce)
    }

    unsetPersonProperties(names: string | readonly string[]): void {
        person.unsetPersonProperties(this, names)
    }

    setInternalOrTestUser(): void {
        person.setInternalOrTestUser(this)
    }

    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable {
        return this._analytics.registerDynamicEventProperties(producer)
    }

    getPageViewId(): string | undefined {
        return this._analytics._pageviewIdFor(this._state.activeSessionId)
    }

    getExtension<T extends Extension>(token: ExtensionToken<T>): T | undefined
    getExtension<T extends Extension = Extension>(name: string): T | undefined
    getExtension(name: string): Extension | undefined {
        return this._registry.get(name)
    }

    async flush(): Promise<void> {
        await Promise.all([this._registry.flush(), this._analytics.flush()])
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
        if (this._disposed) {
            return
        }
        // Consent is already denied after a cleared choice, so an explicit denial purges the work it kept.
        if (this._clearedChoiceRetainsWork) this._revokeAdmittedWork()
        if (this._state.optOut()) {
            this._dispatchConsentChange()
        }
    }

    hasOptedOut(): boolean {
        return this._state.consent === 'denied'
    }

    getExplicitConsentStatus(): ExplicitConsentStatus {
        return this._state.consentChoice ?? 'pending'
    }

    clearOptInOut(): void {
        if (this._disposed) {
            return
        }
        if (this._state.clearConsent()) {
            this._dispatchConsentChange()
        }
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

    setConfig(options: RuntimeOptions): void {
        try {
            const debug = options.debug
            // oxlint-disable-next-line posthog-js/no-direct-boolean-check
            if (typeof debug === 'boolean') this._logState.enabled = debug
            const personProfiles = options.analytics?.personProfiles
            if (personProfiles !== undefined) {
                this._analytics._personProfiles = snapshotPersonProfileMode(() => personProfiles)
            }
        } catch (error) {
            this.logger.error('Configuration update failed', error)
        }
    }

    debug(enabled = true): void {
        this.setConfig({ debug: enabled })
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
            const extensionFlush = Promise.all([this._registry.flush('shutdown'), this._analytics.flush()]).then(
                () => undefined
            )
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

            const cleanup = Promise.all([this._registry.dispose(), this._analytics.dispose()]).catch((error) =>
                this.logger.error('Failed to dispose extensions', error)
            )
            this._remoteConfigPublisher.dispose()
            this._consentChangePublisher.dispose()
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

    _completeInitialization(): void {
        this._ready = true
        this._startInitialPageview()
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

    _canMutate(): boolean {
        return !this._closing && !this._disposed
    }

    _canDeliver(): boolean {
        return (
            !this._disposed &&
            !this._blocked &&
            (!this.hasOptedOut() || (this._clearedChoiceRetainsWork && this._state.consentChoice === undefined))
        )
    }

    private _revokeAdmittedWork(): void {
        this._clearedChoiceRetainsWork = false
        this._immediateAuthority = {}
        this._analytics?.purge()
    }
}

const selectConfiguredExtensions = (configured: readonly Extension[]): Map<string, Extension> => {
    const selected = new Map<string, Extension>()
    for (const extension of configured) if (!selected.has(extension.name)) selected.set(extension.name, extension)
    return selected
}

export const createPostHogCore = async (
    options: CorePostHogOptions,
    createDelivery: AnalyticsDeliveryFactory,
    configured: readonly Extension[] = options?.extensions ?? [],
    automaticLoaders: Readonly<Record<string, ExtensionLoader<IPostHog>>> = {},
    automatic: readonly AutomaticExtension<IPostHog>[] = []
): Promise<IPostHog> => {
    const selected = selectConfiguredExtensions(configured)
    const loaders = Object.fromEntries([
        ...Object.entries(automaticLoaders),
        ...Array.from(selected, ([name, extension]) => [name, () => extension] as const),
    ])
    const client = PostHog.create(options ?? { projectToken: '' }, createDelivery, loaders)
    void client.getRemoteConfig()
    for (const name of selected.keys()) await client.resolveExtension(name)
    for (const extension of automatic) await client._registry.activate(extension)
    client._completeInitialization()
    return client
}
