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

import { createAnalyticsDelivery, isAnalyticsExtension, type AnalyticsMessage } from './analytics-internal'
import { isLikelyBot } from './bot-filter'
import { ExtensionRegistry } from './extensions/registry'
import { createId } from './id'
import { Lane } from './lane'
import { createLogger } from './logger'
import { ClientRateLimiter } from './rate-limiter'
import { sendRequest, type RequestRuntime } from './request'
import { BrowserState, getDefaultSessionStorage, getDefaultStorage } from './state'
import type {
    AnalyticsOptions,
    BrowserFetch,
    LoadStrategy,
    BrowserNavigator,
    CorePostHogOptions,
    NewSessionInfo,
    PostHog,
    StorageLike,
} from './types'
import { version } from './version'

const CONSENT_CHANGE_EVENT = '__posthog_browser_consent_change__'
const MAX_ANALYTICS_BYTES = 8 * 1024 * 1024
const MAX_ANALYTICS_AGE_MS = 60 * 60 * 1000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000
const CLIENT_RATE_LIMIT_WARNING = '$$client_ingestion_warning'

type AutomaticAnalyticsReason = 'capture' | 'flush' | 'shutdown' | 'eager'

export interface AutomaticAnalyticsSetup {
    strategy: LoadStrategy
    options: AnalyticsOptions
    load(options: AnalyticsOptions): Promise<Extension>
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
const normalizeHost = (host: string): string => host.replace(/\/+$/, '')
const isValidDistinctId = (value: unknown): value is string =>
    isNonEmptyString(value) &&
    !['$posthog_cookieless', 'distinct_id', 'distinctid', 'undefined', 'null'].includes(value.toLowerCase())

const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(deepFreeze)
        Object.freeze(value)
    }
    return value
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

const utf8Bytes = (value: string): number => {
    let bytes = 0
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index)
        if (code < 0x80) {
            bytes++
        } else if (code < 0x800) {
            bytes += 2
        } else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00) {
            bytes += 4
            index++
        } else {
            bytes += 3
        }
    }
    return bytes
}

class PostHogBrowserClient implements PostHog {
    readonly logger: Client['logger']
    readonly kv: Client['kv']
    readonly library = Object.freeze({ name: 'web', version })
    readonly initialPersonProperties: Readonly<Record<string, unknown>>
    readonly onRemoteConfig: Client['onRemoteConfig']
    readonly onEvent: Client['onEvent']
    readonly onNewSession: PostHog['onNewSession']
    readonly projectToken: string

    private readonly _remoteConfigPublisher: Publisher<RemoteConfigResult>
    private readonly _eventPublisher: Publisher<CapturedEventInfo>
    private readonly _newSessionPublisher: Publisher<NewSessionInfo>
    private readonly _registry: ExtensionRegistry
    private readonly _dynamicEventProperties: Array<() => Record<string, unknown>> = []
    private readonly _analyticsLane: Lane<AnalyticsMessage>
    private readonly _requestRuntime: RequestRuntime
    private readonly _rateLimiter = new ClientRateLimiter()
    private readonly _state: BrowserState
    private readonly _consentObservation: Disposable
    private readonly _blocked: boolean
    private readonly _capturePageview: boolean
    private readonly _automaticAnalytics: AutomaticAnalyticsSetup | undefined
    private readonly _remoteConfigLoader: (() => Promise<RemoteConfig | undefined>) | undefined
    private readonly _remoteConfigTimeoutMs: number
    private _remoteConfig: RemoteConfig | undefined
    private _latestRemoteConfigResult: RemoteConfigResult | undefined
    private _remoteConfigPromise: Promise<RemoteConfig | undefined> | undefined
    private _cancelRemoteConfigWait: (() => void) | undefined
    private _automaticAnalyticsLoad: Promise<void> | undefined
    private _automaticAnalyticsFailed = false
    private _automaticAnalyticsFailures = 0
    private _closing = false
    private _disposed = false
    private _shutdownPromise: Promise<void> | undefined
    private _initialPageviewPending = true
    private _pageviewListener: [Document, EventListener] | undefined

    static async create(
        options: CorePostHogOptions,
        automaticAnalytics?: AutomaticAnalyticsSetup
    ): Promise<PostHogBrowserClient> {
        const client = new PostHogBrowserClient(options, automaticAnalytics)
        for (const extension of options.extensions ?? []) {
            try {
                await client._installExtension(extension, false)
            } catch (error) {
                client.logger.error(`Failed to install configured extension "${extension.name}"`, error)
            }
        }
        await client._initializeAutomaticAnalytics()
        client._startInitialPageview()
        return client
    }

    private constructor(options: CorePostHogOptions, automaticAnalytics?: AutomaticAnalyticsSetup) {
        const { projectToken } = options
        this.projectToken = projectToken
        this._capturePageview = options.capturePageview ?? true
        this._automaticAnalytics = automaticAnalytics
        this.logger = createLogger('[PostHog]', options.debug ?? false)
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
        this._analyticsLane = new Lane(
            1_000,
            (error) => this.logger.error('Event delivery failed', error),
            (total, count = 1, reason = 'overflow') =>
                this.logger.warn(
                    `Analytics queue dropped ${count} ${reason} event${count === 1 ? '' : 's'} (${total} total)`
                ),
            MAX_ANALYTICS_BYTES,
            MAX_ANALYTICS_AGE_MS,
            Date.now,
            () => this._startInitialPageview()
        )
        this._state = new BrowserState(
            projectToken,
            storage,
            options.persistenceKey,
            options.consentPersistenceName,
            options.optOutByDefault ?? false,
            !this._blocked && options.storage === undefined && requestedStorage !== undefined
                ? getDefaultSessionStorage
                : undefined,
            (consent) => {
                if (consent === 'denied') {
                    this._analyticsLane.purge()
                }
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
                assets: normalizeHost(options.assetsHost ?? apiHost),
            },
            projectToken,
            browserFetch,
            browserNavigator,
        ]
        this._remoteConfig = options.remoteConfig
        this._remoteConfigLoader = options.remoteConfigLoader
        this._remoteConfigTimeoutMs =
            options.remoteConfigTimeoutMs === undefined || !Number.isFinite(options.remoteConfigTimeoutMs)
                ? 10_000
                : Math.max(0, options.remoteConfigTimeoutMs)

        this.kv = this._state.keyValueStore('core', () => !this._closing && !this._disposed && this._state.prepare())
        this._latestRemoteConfigResult = this._remoteConfig ? { ok: true, config: this._remoteConfig } : undefined
        this.onRemoteConfig = (handler) => {
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
        this.onEvent = this._eventPublisher.listener
        this.onNewSession = this._newSessionPublisher.listener
        this._registry = new ExtensionRegistry(
            (extensionName) => this._createExtensionClient(extensionName),
            this.logger
        )
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

    get session(): SessionContext {
        this._state.prepare()
        return this._state.session
    }

    async capture(
        event: string,
        properties: Record<string, unknown> | null = null,
        options: CaptureOptions = {}
    ): Promise<void> {
        this._capture(event, properties, options)
    }

    private _capture(
        event: string,
        properties: Record<string, unknown> | null = null,
        options: CaptureOptions = {},
        skipRateLimit = false
    ): boolean {
        if (
            !isNonEmptyString(event) ||
            this._closing ||
            this._disposed ||
            this._blocked ||
            this.hasOptedOut() ||
            !this._state.prepare()
        ) {
            return false
        }
        if (!skipRateLimit) {
            const rateLimit = this._rateLimiter.consume()
            if (!rateLimit.allowed) {
                if (rateLimit.reportDropped !== undefined) {
                    const warning = `${rateLimit.reportDropped} event(s) dropped since the last warning. Client limit is 10 events per second with a burst of 100.`
                    this.logger.warn(`PostHog client rate limited: ${warning}`)
                    if (
                        this._capture(
                            CLIENT_RATE_LIMIT_WARNING,
                            { $$client_ingestion_warning_message: `posthog-js client rate limited: ${warning}` },
                            {},
                            true
                        )
                    ) {
                        this._rateLimiter.reported()
                    }
                }
                return false
            }
        }

        const dynamicProperties: Record<string, unknown> = {}
        for (const producer of this._dynamicEventProperties.slice()) {
            try {
                Object.assign(dynamicProperties, producer())
            } catch (error) {
                this.logger.error('An event property producer failed', error)
            }
        }

        let messageProperties: Record<string, unknown>
        let observedProperties: Record<string, unknown>
        let uuid: string | undefined
        let timestamp: Date | undefined
        try {
            const callerProperties: Record<string, unknown> = {
                ...dynamicProperties,
                ...(properties ?? {}),
            }
            const set = options.set
            const setOnce = options.setOnce
            uuid = options.uuid
            timestamp = options.timestamp
            if (set) {
                callerProperties['$set'] = set
            }
            if (setOnce) {
                callerProperties['$set_once'] = setOnce
            }
            const serializedProperties = JSON.stringify(callerProperties)
            const parsedMessageProperties: unknown = JSON.parse(serializedProperties)
            const parsedObservedProperties: unknown = JSON.parse(serializedProperties)
            if (!isRecord(parsedMessageProperties) || !isRecord(parsedObservedProperties)) {
                throw new Error('Event properties must serialize to an object')
            }
            messageProperties = parsedMessageProperties
            observedProperties = parsedObservedProperties
        } catch (error) {
            this.logger.error('Event properties are not JSON-serializable', error)
            return false
        }

        const preparedSession = this._state.prepareSessionForEvent()
        const session = preparedSession.context
        const distinctId = this._state.distinctId
        const deviceId = this._state.deviceId
        const groups = this._state.groups
        Object.assign(messageProperties, {
            token: this.projectToken,
            distinct_id: distinctId,
            $device_id: deviceId,
            $groups: groups,
            $session_id: session.sessionId,
            $window_id: session.windowId,
            $lib: 'web',
            $lib_version: version,
        })
        Object.assign(observedProperties, {
            token: this.projectToken,
            distinct_id: distinctId,
            $device_id: deviceId,
            $groups: { ...groups },
            $session_id: session.sessionId,
            $window_id: session.windowId,
            $lib: 'web',
            $lib_version: version,
        })

        const message: AnalyticsMessage = {
            uuid: uuid ?? createId(),
            event,
            distinct_id: distinctId,
            properties: messageProperties,
            timestamp: eventTimestamp(timestamp),
        }
        let bytes: number
        try {
            bytes = utf8Bytes(JSON.stringify(message))
        } catch (error) {
            this.logger.error('The finalized event could not be measured', error)
            return false
        }
        const admitted = this._analyticsLane.enqueue(message, bytes)
        if (!admitted) {
            if (bytes > MAX_ANALYTICS_BYTES) {
                this.logger.warn(`Event "${event}" (${bytes} bytes) exceeds the local analytics limit and was dropped`)
            }
            return false
        }
        if (!this._state.sessionAdmitted(preparedSession)) {
            this._analyticsLane.discardQueued(message)
            return false
        }
        if (preparedSession.reason) {
            this._newSessionPublisher.publish({ ...session, reason: preparedSession.reason })
        }
        this._eventPublisher.publish(deepFreeze({ event, properties: observedProperties }))
        void this._ensureAutomaticAnalytics('capture')
        return true
    }

    async identify(
        distinctId: string,
        set?: Record<string, unknown>,
        setOnce?: Record<string, unknown>
    ): Promise<void> {
        if (!isValidDistinctId(distinctId) || this._closing || this._disposed) {
            return
        }

        this._state.prepare()
        const previousDistinctId = this._state.distinctId
        const wasIdentified = this._state.isIdentified
        const captureOptions: CaptureOptions = {}
        if (set) {
            captureOptions.set = set
        }
        if (setOnce) {
            captureOptions.setOnce = setOnce
        }
        const hasPersonProperties = !!set || !!setOnce

        if (distinctId === previousDistinctId) {
            if (!wasIdentified) {
                this._state.identify(distinctId)
                await this.capture('$set', null, { set: set ?? {}, setOnce: setOnce ?? {} })
            } else if (hasPersonProperties) {
                await this.capture('$set', null, captureOptions)
            }
            return
        }

        this._state.identify(distinctId)
        if (!wasIdentified) {
            await this.capture('$identify', { $anon_distinct_id: previousDistinctId }, captureOptions)
        } else if (hasPersonProperties) {
            await this.capture('$set', null, captureOptions)
        }
    }

    async group(type: string, key: string, properties?: Record<string, unknown>): Promise<void> {
        if (!isNonEmptyString(type) || !isNonEmptyString(key) || this._closing || this._disposed) {
            return
        }

        this._state.prepare()
        const changed = this._state.group(type, key)
        if (!changed && !properties) {
            return
        }
        await this.capture('$groupidentify', {
            $group_type: type,
            $group_key: key,
            ...(properties ? { $group_set: properties } : {}),
        })
    }

    reset(): void {
        if (this._closing || this._disposed) {
            return
        }
        this._state.prepare()
        this._state.reset()
    }

    async flush(): Promise<void> {
        if (this._analyticsLane.hasPending()) {
            await this._ensureAutomaticAnalytics('flush')
        }
        await this._analyticsLane.flush()
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
        return sendRequest(
            this._requestRuntime,
            path,
            init,
            () => !this._closing && !this._disposed && !this._blocked && !this.hasOptedOut()
        )
    }

    async getRemoteConfig(): Promise<RemoteConfig | undefined> {
        if (this._closing || this._disposed) {
            return undefined
        }
        const loader = this._remoteConfigLoader
        if (this._remoteConfig !== undefined || !loader) {
            return this._remoteConfig
        }

        if (!this._remoteConfigPromise) {
            let timeout: ReturnType<typeof setTimeout> | undefined
            let invalidated = false
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
                    return loader()
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

    getExtension<T extends Extension = Extension>(name: string): T | undefined {
        return this._registry.get<T>(name)
    }

    private async _installExtension(extension: Extension, automatic: boolean): Promise<void> {
        const canInstall = (): boolean => !this._disposed && (automatic || !this._closing)
        if (!canInstall()) {
            throw new Error('PostHog extensions are disabled')
        }
        const installsAnalytics = isAnalyticsExtension(extension)
        await this._registry.install(extension)
        try {
            if (!canInstall()) {
                throw new Error('PostHog extensions are disabled')
            }
            if (installsAnalytics) {
                const delivery = extension[createAnalyticsDelivery]({
                    runtime: this._requestRuntime,
                    libraryVersion: version,
                    canRetry: () => this._canDeliver(),
                    retryNow: () => this._analyticsLane.retryNow(),
                    pause: () => this._analyticsLane.pause(),
                    teardown: (maxBytes) => this._analyticsLane.teardown(maxBytes),
                    reportFailure: (error) => this.logger.error('Event delivery failed', error),
                    reportWarning: (message) => this.logger.warn(message),
                })
                if (!canInstall()) {
                    throw new Error('PostHog extensions are disabled')
                }
                this._analyticsLane.attach(delivery)
            }
        } catch (error) {
            try {
                await this._registry.rollback(extension)
            } catch (cleanupError) {
                this.logger.error(`Failed to dispose disabled extension "${extension.name}"`, cleanupError)
            }
            throw error
        }
    }

    private async _initializeAutomaticAnalytics(): Promise<void> {
        if (this._automaticAnalytics?.strategy === 'eager') {
            await this._ensureAutomaticAnalytics('eager')
        }
    }

    private _ensureAutomaticAnalytics(reason: AutomaticAnalyticsReason, retryAfterPending = true): Promise<void> {
        const setup = this._automaticAnalytics
        if (!setup || this._disposed || this._analyticsLane.hasDelivery()) {
            return Promise.resolve()
        }
        if (this._automaticAnalyticsLoad) {
            const pending = this._automaticAnalyticsLoad
            const failures = this._automaticAnalyticsFailures
            if (reason === 'capture' || !retryAfterPending) {
                return pending
            }
            return pending.then(() =>
                this._automaticAnalyticsFailures > failures && this._analyticsLane.hasPending()
                    ? this._ensureAutomaticAnalytics(reason, false)
                    : undefined
            )
        }
        if (reason === 'capture' && this._automaticAnalyticsFailed) {
            return Promise.resolve()
        }
        this._automaticAnalyticsFailed = false
        const loading = Promise.resolve()
            .then(() => setup.load(setup.options))
            .then(async (extension) => {
                if (this._analyticsLane.hasDelivery() || this._disposed) {
                    try {
                        await extension.dispose?.()
                    } catch (error) {
                        this.logger.error('Failed to dispose unused automatic analytics', error)
                    }
                    return
                }
                if (!isAnalyticsExtension(extension)) {
                    throw new Error('The automatic analytics loader returned an incompatible extension')
                }
                await this._installExtension(extension, true)
            })
            .catch((error: unknown) => {
                if (!this._analyticsLane.hasDelivery()) {
                    this._automaticAnalyticsFailed = true
                    this._automaticAnalyticsFailures++
                    this.logger.error('Automatic analytics loading failed', error)
                }
            })
            .finally(() => {
                if (this._automaticAnalyticsLoad === loading) {
                    this._automaticAnalyticsLoad = undefined
                }
            })
        this._automaticAnalyticsLoad = loading
        return loading
    }

    shutdown(shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
        if (!this._shutdownPromise) {
            const analyticsLoad =
                this._automaticAnalyticsLoad ??
                (this._analyticsLane.hasPending() ? this._ensureAutomaticAnalytics('shutdown') : Promise.resolve())
            this._closing = true
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
            this._shutdownPromise = this._shutdown(shutdownTimeoutMs, analyticsLoad)
        }
        return this._shutdownPromise
    }

    dispose(): Promise<void> {
        return this.shutdown()
    }

    private async _shutdown(shutdownTimeoutMs: number, analyticsLoad: Promise<void>): Promise<void> {
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
            await Promise.race([analyticsLoad, timeout])
            await Promise.race([
                this._analyticsLane.flush().catch((error) => this.logger.error('Event flush failed', error)),
                timeout,
            ])

            this._disposed = true
            try {
                this._state.dispose()
            } catch (error) {
                this.logger.error('Failed to dispose browser state', error)
            }

            const cleanup = Promise.all([
                this._analyticsLane.dispose().catch((error) => this.logger.error('Failed to dispose analytics', error)),
                this._registry.dispose().catch((error) => this.logger.error('Failed to dispose extensions', error)),
            ]).then(() => undefined)
            this._remoteConfigPublisher.dispose()
            this._eventPublisher.dispose()
            this._newSessionPublisher.dispose()
            this._dynamicEventProperties.splice(0)
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

    private _startInitialPageview(): void {
        if (!this._capturePageview || !this._initialPageviewPending || this._closing || this._disposed) {
            return
        }

        let document: Document | undefined
        let visibility: DocumentVisibilityState | undefined
        try {
            document = globalThis.document
            visibility = document?.visibilityState
        } catch {
            this._removePageviewListener()
            this._initialPageviewPending = false
            return
        }
        if (!document || visibility === undefined) {
            this._removePageviewListener()
            this._initialPageviewPending = false
            return
        }
        if (visibility !== 'visible') {
            if (this._pageviewListener?.[0] !== document) {
                this._removePageviewListener()
            }
            if (!this._pageviewListener) {
                const listener = (): void => this._startInitialPageview()
                this._pageviewListener = [document, listener]
                try {
                    // eslint-disable-next-line posthog-js/no-add-event-listener
                    document.addEventListener('visibilitychange', listener)
                } catch {
                    this._removePageviewListener()
                    this._initialPageviewPending = false
                    return
                }
            }
            return
        }

        this._removePageviewListener()
        this._initialPageviewPending = false
        if (!this._capture('$pageview')) {
            this._initialPageviewPending = !this._disposed && !this._blocked
        }
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
                // eslint-disable-next-line posthog-js/no-add-event-listener
                globalThis.addEventListener('storage', storageListener)
                storageListening = true
            } catch {
                // Fresh reads remain authoritative when event observation is unavailable.
            }
        }
        try {
            // eslint-disable-next-line posthog-js/no-add-event-listener
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

    private _createExtensionClient(extensionName: string): Client {
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

    private _canDeliver(): boolean {
        return !this._disposed && !this._blocked && !this.hasOptedOut()
    }
}

export const createPostHogCore = async (
    options: CorePostHogOptions,
    automaticAnalytics?: AutomaticAnalyticsSetup
): Promise<PostHog> => {
    if (!options?.projectToken) {
        throw new Error('A PostHog project token is required')
    }

    return PostHogBrowserClient.create(options, automaticAnalytics)
}
