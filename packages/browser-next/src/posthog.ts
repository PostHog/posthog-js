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
import { createFailedResponse, sendRequest, type RequestRuntime } from './request'
import { BrowserState, getDefaultSessionStorage, getDefaultStorage } from './state'
import type { BrowserFetch, BrowserNavigator, NewSessionInfo, PostHog, PostHogOptions, StorageLike } from './types'
import { version } from './version'

const CONSENT_CHANGE_EVENT = '__posthog_browser_consent_change__'
const MAX_ANALYTICS_BYTES = 8 * 1024 * 1024
const MAX_ANALYTICS_AGE_MS = 60 * 60 * 1000
const EMPTY_SESSION: SessionContext = Object.freeze({ sessionId: '', windowId: '', sessionStartTimestamp: 0 })

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
    private readonly _state: BrowserState
    private readonly _consentObservation: Disposable
    private readonly _blocked: boolean
    private readonly _capturePageview: boolean
    private readonly _remoteConfigLoader: (() => Promise<RemoteConfig | undefined>) | undefined
    private readonly _remoteConfigTimeoutMs: number
    private _remoteConfig: RemoteConfig | undefined
    private _latestRemoteConfigResult: RemoteConfigResult | undefined
    private _remoteConfigPromise: Promise<RemoteConfig | undefined> | undefined
    private _consentGeneration = 0
    private _disposed = false
    private _initialPageviewPending = true
    private _pageviewListener: [Document, EventListener] | undefined

    constructor(options: PostHogOptions) {
        const { projectToken } = options
        this.projectToken = projectToken
        this._capturePageview = options.capturePageview ?? true
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
            () => this.startInitialPageview()
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
            () => {
                this._consentGeneration++
                this._analyticsLane.purge()
                this._removePageviewListener()
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

        this.kv = this._state.keyValueStore('core', () => this._canUseState())
        this._latestRemoteConfigResult = this._remoteConfig ? { ok: true, config: this._remoteConfig } : undefined
        this.onRemoteConfig = (handler) => {
            if (!this._canUseState()) {
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
        return this._canUseState() ? this._state.distinctId : ''
    }

    get anonymousId(): string {
        return this._canUseState() ? this._state.anonymousId : ''
    }

    get deviceId(): string | undefined {
        return this._canUseState() ? this._state.deviceId : undefined
    }

    get groups(): Record<string, string> {
        return this._canUseState() ? this._state.groups : {}
    }

    get session(): SessionContext {
        return this._canUseState() ? this._state.session : EMPTY_SESSION
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
        consentGeneration = this._consentGeneration
    ): boolean {
        if (!isNonEmptyString(event) || !this._canContinue(consentGeneration)) {
            return false
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

        if (!this._canContinue(consentGeneration)) {
            return false
        }
        const preparedSession = this._state.prepareSessionForEvent()
        const session = preparedSession.context
        if (!this._canContinue(consentGeneration)) {
            return false
        }
        const distinctId = this.distinctId
        const groups = this.groups
        Object.assign(messageProperties, {
            token: this.projectToken,
            distinct_id: distinctId,
            $device_id: this.deviceId,
            $groups: groups,
            $session_id: session.sessionId,
            $window_id: session.windowId,
            $lib: 'web',
            $lib_version: version,
        })
        Object.assign(observedProperties, {
            token: this.projectToken,
            distinct_id: distinctId,
            $device_id: this.deviceId,
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
        if (!this._canContinue(consentGeneration)) {
            return false
        }
        const admitted = this._analyticsLane.enqueue(message, bytes)
        if (!admitted) {
            if (bytes > MAX_ANALYTICS_BYTES) {
                this.logger.warn(`Event "${event}" (${bytes} bytes) exceeds the local analytics limit and was dropped`)
            }
            return false
        }
        if (!this._canContinue(consentGeneration)) {
            this._analyticsLane.purge()
            return false
        }
        if (!this._state.sessionAdmitted(preparedSession)) {
            this._analyticsLane.discardQueued(message)
            return false
        }
        if (!this._canContinue(consentGeneration)) {
            this._analyticsLane.purge()
            return false
        }
        if (preparedSession.reason) {
            this._newSessionPublisher.publish({ ...session, reason: preparedSession.reason }, () =>
                this._canContinue(consentGeneration)
            )
            if (!this._canContinue(consentGeneration)) {
                return false
            }
        }
        this._eventPublisher.publish(deepFreeze({ event, properties: observedProperties }), () =>
            this._canContinue(consentGeneration)
        )
        return this._canContinue(consentGeneration)
    }

    async identify(
        distinctId: string,
        set?: Record<string, unknown>,
        setOnce?: Record<string, unknown>
    ): Promise<void> {
        const consentGeneration = this._consentGeneration
        if (!isValidDistinctId(distinctId) || !this._canContinue(consentGeneration)) {
            return
        }

        const previousDistinctId = this.distinctId
        const wasIdentified = this._state.isIdentified
        if (!this._canContinue(consentGeneration)) {
            return
        }
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
                if (!this._canContinue(consentGeneration)) {
                    return
                }
                await this.capture('$set', null, { set: set ?? {}, setOnce: setOnce ?? {} })
            } else if (hasPersonProperties) {
                await this.capture('$set', null, captureOptions)
            }
            return
        }

        this._state.identify(distinctId)
        if (!this._canContinue(consentGeneration)) {
            return
        }
        if (!wasIdentified) {
            await this.capture('$identify', { $anon_distinct_id: previousDistinctId }, captureOptions)
        } else if (hasPersonProperties) {
            await this.capture('$set', null, captureOptions)
        }
    }

    async group(type: string, key: string, properties?: Record<string, unknown>): Promise<void> {
        const consentGeneration = this._consentGeneration
        if (!isNonEmptyString(type) || !isNonEmptyString(key) || !this._canContinue(consentGeneration)) {
            return
        }

        const changed = this._state.group(type, key)
        if (!this._canContinue(consentGeneration)) {
            return
        }
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
        const consentGeneration = this._consentGeneration
        if (!this._canContinue(consentGeneration)) {
            return
        }
        this._state.reset()
    }

    async flush(): Promise<void> {
        await this._analyticsLane.flush()
    }

    optIn(): void {
        if (this._disposed) {
            return
        }
        if (this._state.optIn()) {
            this._dispatchConsentChange()
        }
        this.startInitialPageview()
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
        const consentGeneration = this._consentGeneration
        if (!this._canContinue(consentGeneration)) {
            return Promise.resolve(createFailedResponse(new Error('PostHog requests are disabled')))
        }
        return sendRequest(this._requestRuntime, path, init, () => this._canContinue(consentGeneration))
    }

    async getRemoteConfig(): Promise<RemoteConfig | undefined> {
        const consentGeneration = this._consentGeneration
        if (!this._canContinue(consentGeneration)) {
            return undefined
        }
        const loader = this._remoteConfigLoader
        if (this._remoteConfig !== undefined || !loader) {
            return this._remoteConfig
        }

        if (!this._remoteConfigPromise) {
            let timeout: ReturnType<typeof setTimeout> | undefined
            let invalidated = false
            const timeoutResult = new Promise<undefined>((resolve) => {
                timeout = globalThis.setTimeout(() => resolve(undefined), this._remoteConfigTimeoutMs)
            })
            this._remoteConfigPromise = Promise.race([
                Promise.resolve().then(() => {
                    if (!this._canContinue(consentGeneration)) {
                        invalidated = true
                        return undefined
                    }
                    return loader()
                }),
                timeoutResult,
            ])
                .then((remoteConfig) => {
                    if (!this._canContinue(consentGeneration)) {
                        invalidated = true
                        return undefined
                    }

                    this._latestRemoteConfigResult = remoteConfig ? { ok: true, config: remoteConfig } : { ok: false }
                    if (remoteConfig) {
                        this._remoteConfig = remoteConfig
                    }
                    this._remoteConfigPublisher.publish(this._latestRemoteConfigResult, () =>
                        this._canContinue(consentGeneration)
                    )
                    return remoteConfig
                })
                .catch((error: unknown) => {
                    if (!this._canContinue(consentGeneration)) {
                        invalidated = true
                        return undefined
                    }
                    this.logger.error('Remote configuration failed', error)
                    this._latestRemoteConfigResult = { ok: false }
                    this._remoteConfigPublisher.publish(this._latestRemoteConfigResult, () =>
                        this._canContinue(consentGeneration)
                    )
                    return undefined
                })
                .finally(() => {
                    if (timeout !== undefined) {
                        globalThis.clearTimeout(timeout)
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

    async installExtension(extension: Extension): Promise<Disposable> {
        const consentGeneration = this._consentGeneration
        if (!this._canContinue(consentGeneration)) {
            throw new Error('PostHog extensions are disabled')
        }
        const registered = await this._registry.install(extension)
        let delivery: Disposable | undefined
        try {
            if (!this._canContinue(consentGeneration)) {
                throw new Error('PostHog extensions are disabled')
            }
            if (isAnalyticsExtension(extension)) {
                delivery = this._analyticsLane.install(
                    extension[createAnalyticsDelivery]({
                        runtime: this._requestRuntime,
                        libraryVersion: version,
                        canRetry: () => this._canUseState(),
                        reportFailure: (error) => this.logger.error('Event delivery failed', error),
                    })
                )
            }
            if (!this._canContinue(consentGeneration)) {
                throw new Error('PostHog extensions are disabled')
            }
        } catch (error) {
            delivery?.dispose()
            try {
                await registered.dispose()
            } catch (cleanupError) {
                this.logger.error(`Failed to dispose disabled extension "${extension.name}"`, cleanupError)
            }
            throw error
        }

        let active = true
        return {
            dispose: async () => {
                if (active) {
                    active = false
                    delivery?.dispose()
                    await registered.dispose()
                }
            },
        }
    }

    async loadExtension(loader: () => Promise<Extension>): Promise<Disposable> {
        const consentGeneration = this._consentGeneration
        if (!this._canContinue(consentGeneration)) {
            throw new Error('PostHog extensions are disabled')
        }
        const extension = await loader()
        if (!this._canContinue(consentGeneration)) {
            try {
                await extension.dispose?.()
            } catch (error) {
                this.logger.error(`Failed to dispose disabled extension "${extension.name}"`, error)
            }
            throw new Error('PostHog extensions are disabled')
        }
        return this.installExtension(extension)
    }

    async dispose(): Promise<void> {
        if (this._disposed) {
            return
        }
        this._disposed = true
        this._removePageviewListener()
        try {
            this._consentObservation.dispose()
        } catch {
            // Listener cleanup is best effort.
        }
        this._state.dispose()

        const laneDisposal = this._analyticsLane.dispose()
        const registryDisposal = this._registry.dispose()
        await Promise.all([laneDisposal, registryDisposal])
        this._remoteConfigPublisher.dispose()
        this._eventPublisher.dispose()
        this._newSessionPublisher.dispose()
        this._dynamicEventProperties.splice(0)
    }

    startInitialPageview(): void {
        const consentGeneration = this._consentGeneration
        if (
            !this._capturePageview ||
            !this._initialPageviewPending ||
            this._disposed ||
            this._blocked ||
            !this._canContinue(consentGeneration)
        ) {
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
        if (!this._canContinue(consentGeneration)) {
            this._removePageviewListener()
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
                const listener = (): void => this.startInitialPageview()
                this._pageviewListener = [document, listener]
                try {
                    // eslint-disable-next-line posthog-js/no-add-event-listener
                    document.addEventListener('visibilitychange', listener)
                } catch {
                    this._removePageviewListener()
                    this._initialPageviewPending = false
                    return
                }
                if (!this._canContinue(consentGeneration)) {
                    this._removePageviewListener()
                }
            }
            return
        }

        this._removePageviewListener()
        if (!this._canContinue(consentGeneration)) {
            return
        }
        this._initialPageviewPending = false
        if (!this._capture('$pageview', {}, {}, consentGeneration)) {
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
        const kv = this._state.keyValueStore(extensionName, () => this._canUseState())

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

    private _canContinue(consentGeneration: number): boolean {
        return this._canUseState() && consentGeneration === this._consentGeneration
    }

    private _canUseState(): boolean {
        if (this._disposed || this._blocked || this.hasOptedOut()) {
            return false
        }
        return this._state.prepare() && !this.hasOptedOut()
    }
}

export const createPostHog = async (options: PostHogOptions): Promise<PostHog> => {
    if (!options?.projectToken) {
        throw new Error('A PostHog project token is required')
    }

    const client = new PostHogBrowserClient(options)
    for (const extension of options.extensions ?? []) {
        try {
            await client.installExtension(extension)
        } catch (error) {
            client.logger.error(`Failed to install configured extension "${extension.name}"`, error)
        }
    }
    client.startInitialPageview()
    return client
}
