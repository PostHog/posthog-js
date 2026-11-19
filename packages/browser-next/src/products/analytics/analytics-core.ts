import type { CaptureOptions, CapturedEventInfo, Disposable, SessionContext } from '@posthog/browser-common'
import { Publisher } from '@posthog/browser-common/pubsub'
import {
    MAX_ANALYTICS_BATCH_EVENTS,
    MAX_ANALYTICS_BYTES,
    type AnalyticsCore,
    type AnalyticsDeliveryFactory,
    type AnalyticsDriver,
    type AnalyticsMessage,
    type AnalyticsTeardownSubscription,
    type CaptureHost,
} from './analytics-internal'
import type { ChangePropertiesInfo, GroupInfo, IdentifyInfo } from '../../core/context/browser-client'
import type { BootstrapOptions, NewSessionInfo, CaptureSummary, ResetOptions } from '../../core/types'
import { readBootstrapSession } from '../../core/state/state'
import type { AnalyticsOptions, PersonProfileMode } from './analytics-options'
import { EventBuffer } from './admission/event-buffer'
import { captureFailure, EMPTY_CAPTURE_SUMMARY } from './admission/capture-summary'
import { createId } from '../../primitives/id'
import { deepFreeze } from '../../primitives/immutable'
import { ClientRateLimiter } from './admission/rate-limiter'
import {
    applySessionProperties,
    snapshotCaptureProperties,
    unavoidableProperties,
    type CaptureProperties,
} from './admission/capture-properties'
import { SessionRegisteredProperties } from './properties/analytics-session-properties'
import { RegisteredProperties, snapshotRegisteredProperties } from './properties/analytics-properties'
import {
    shouldProcessPerson,
    snapshotPersonProfileMode,
    snapshotPersonProperties,
    type PersonProperties,
} from './properties/person-processing'
import { version } from '../../primitives/version'
import { utf8Bytes } from '../../primitives/utf8'

const numberOption = (read: () => number | undefined, fallback: number, minimum: number, maximum: number): number => {
    try {
        const value = read()
        return Math.max(
            minimum,
            // oxlint-disable-next-line posthog-js/no-direct-number-check
            Math.min(maximum, Math.floor(typeof value === 'number' && Number.isFinite(value) ? value : fallback))
        )
    } catch {
        return fallback
    }
}

const CLIENT_RATE_LIMIT_WARNING = '$$client_ingestion_warning'
export const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0
export const isValidDistinctId = (value: unknown): value is string =>
    isNonEmptyString(value) &&
    !['$posthog_cookieless', 'distinct_id', 'distinctid', 'undefined', 'null'].includes(value.toLowerCase())

const eventTimestamp = (timestamp: Date | undefined): string => {
    try {
        return (timestamp ?? new Date()).toISOString()
    } catch {
        return new Date().toISOString()
    }
}

/** Snapshots JSON options so later caller mutations and hostile getters cannot affect identity operations. */
export const snapshotOptions = <T extends object>(options: T | undefined): Partial<T> => {
    try {
        const snapshot: unknown = JSON.parse(JSON.stringify(options ?? {}))
        return typeof snapshot === 'object' && snapshot !== null ? (snapshot as Partial<T>) : {}
    } catch {
        return {}
    }
}

interface PersonPropertiesAdmission {
    readonly signature: string | undefined
}

interface PreparedCapture {
    readonly message: AnalyticsMessage
    readonly bytes: number
    readonly preparedSession: ReturnType<AnalyticsCore['_state']['prepareSessionForEvent']>
    readonly observedProperties: Record<string, unknown>
}

/**
 * The client's capture pipeline: admission, identity operations, buffering and delivery.
 * Members prefixed with `_` are package-internal and used by the optional groups and person modules.
 */
export class Analytics {
    readonly _eventPublisher: Publisher<CapturedEventInfo>
    readonly _newSessionPublisher: Publisher<NewSessionInfo>
    readonly _sessionIdPublisher: Publisher<SessionContext>
    readonly _identifyPublisher: Publisher<IdentifyInfo>
    readonly _changePropertiesPublisher: Publisher<ChangePropertiesInfo>
    readonly _groupPublisher: Publisher<GroupInfo>
    readonly _groupsResetPublisher: Publisher<void>
    readonly _resetPublisher: Publisher<void>
    _personProfiles: PersonProfileMode
    _disposed = false
    _lastPersonProperties: string | undefined
    /** The last admitted `$pageview` UUID and the session it belongs to. */
    _pageview: [id: string, sessionId: string] | undefined

    private _driver: AnalyticsDriver | undefined
    private _isTearingDown = false
    private readonly _registeredProperties: RegisteredProperties
    private readonly _sessionProperties: SessionRegisteredProperties
    private readonly _rateLimiter: ClientRateLimiter
    private readonly _dynamicEventProperties: Array<() => Record<string, unknown>> = []
    private readonly _teardownCallbacks = new Set<() => void>()
    private readonly _buffer: EventBuffer<AnalyticsMessage>
    private readonly _deliveryHost: CaptureHost

    constructor(
        readonly _core: AnalyticsCore,
        options: AnalyticsOptions,
        createDelivery: AnalyticsDeliveryFactory
    ) {
        const report = (label: string) => (error: unknown) => _core.logger.error(`${label} listener failed`, error)
        this._eventPublisher = new Publisher(report('An event'))
        this._newSessionPublisher = new Publisher(report('A session'))
        this._sessionIdPublisher = new Publisher(report('A session ID'))
        this._identifyPublisher = new Publisher(report('An identify'))
        this._changePropertiesPublisher = new Publisher(report('A person-property'))
        this._groupPublisher = new Publisher(report('A group'))
        this._groupsResetPublisher = new Publisher(report('A group reset'))
        this._resetPublisher = new Publisher(report('A reset'))
        this._personProfiles = snapshotPersonProfileMode(() => options.personProfiles)
        this._rateLimiter = new ClientRateLimiter()
        this._registeredProperties = new RegisteredProperties(_core.kv)
        this._sessionProperties = new SessionRegisteredProperties(_core._sessionKv)
        this._deliveryHost = {
            runtime: _core._requestRuntime,
            canRetry: () => _core._canDeliver(),
            reportFailure: (error) => _core.logger.error('Event delivery failed', error),
            reportWarning: (message) => _core.logger.warn(message),
            onAvailable: () => _core._startInitialPageview(),
        }
        this._buffer = new EventBuffer<AnalyticsMessage>(
            1_000,
            (total, count = 1, reason = 'overflow') =>
                this._deliveryHost.reportWarning(
                    `Analytics queue dropped ${count} ${reason} event${count === 1 ? '' : 's'} (${total} total)`
                ),
            MAX_ANALYTICS_BYTES,
            60 * 60 * 1000
        )
        try {
            this._driver = createDelivery(
                this._buffer,
                _core,
                this._deliveryHost,
                {
                    flushAt: numberOption(() => options.flushAt, 20, 1, MAX_ANALYTICS_BATCH_EVENTS),
                    flushInterval: numberOption(() => options.flushInterval, 3_000, 0, Number.MAX_SAFE_INTEGER),
                },
                this._beforeTeardown
            )
        } catch (error) {
            _core.logger.error('Event delivery is unavailable', error)
        }
    }

    get isRateLimited(): boolean {
        return this._rateLimiter.wouldLimit
    }

    onBeforeTeardown(callback: () => void): AnalyticsTeardownSubscription {
        if (!this._disposed) this._teardownCallbacks.add(callback)
        const instance = this
        return {
            get deliveryAvailable() {
                return !instance._disposed && !!instance._driver
            },
            dispose: () => {
                this._teardownCallbacks.delete(callback)
            },
        }
    }

    async flush(): Promise<void> {
        if (!this._disposed) await this._driver?.flush()
    }

    purge(): void {
        this._buffer.purge()
    }

    dispose(): Promise<void> | undefined {
        this._disposed = true
        this._dynamicEventProperties.splice(0)
        this._teardownCallbacks.clear()
        for (const publisher of [
            this._eventPublisher,
            this._newSessionPublisher,
            this._sessionIdPublisher,
            this._identifyPublisher,
            this._changePropertiesPublisher,
            this._groupPublisher,
            this._groupsResetPublisher,
            this._resetPublisher,
        ] as Array<Publisher<unknown>>) {
            publisher.dispose()
        }
        if (this._driver) return this._driver.dispose()
        this._buffer.dispose()
        return undefined
    }

    private readonly _beforeTeardown = (): void => {
        this._isTearingDown = true
        try {
            for (const callback of this._teardownCallbacks) {
                try {
                    callback()
                } catch (error) {
                    try {
                        this._deliveryHost.reportFailure(error)
                    } catch {
                        /* A product must not block the handoff. */
                    }
                }
            }
        } finally {
            this._isTearingDown = false
        }
    }

    captureInitialPageview(): boolean {
        return this._capture('$pageview')
    }

    capture(event: string, properties: Record<string, unknown> | null = null, options: CaptureOptions = {}): boolean {
        let delivery: CaptureOptions['delivery']
        try {
            delivery = options.delivery
            if (delivery === 'unload' && !this._isTearingDown) {
                const authority = this._core._immediateAuthority
                const message = this._admitCapture(event, properties, options, false, true)
                if (message && !this._disposed && this._core._immediateAuthority === authority) {
                    this._driver?.deliverUnload([message])
                }
                return !!message || !this._rateLimiter.limited
            }
        } catch (error) {
            this._core.logger.error('Unload capture failed', error)
            return true
        }
        if (!this._capture(event, properties, options)) return !this._rateLimiter.limited
        // Immediate events stay buffered, keeping retries and the teardown handoff, but start delivery now.
        // During teardown, the handoff that is already running delivers them.
        if (delivery === 'immediate' && !this._isTearingDown) {
            this._driver?.flush(true).catch(this._deliveryHost.reportFailure)
        }
        return true
    }

    async captureImmediate(
        event: string,
        properties: Record<string, unknown> | null = null,
        options: CaptureOptions = {}
    ): Promise<CaptureSummary> {
        try {
            const deliver = this._driver?.deliverImmediate
            if (!deliver || this._disposed) {
                return captureFailure(new Error('Immediate analytics delivery is unavailable'))
            }
            const authority = this._core._immediateAuthority
            const message = this._admitCapture(event, properties, options, false, true)
            if (!message) return EMPTY_CAPTURE_SUMMARY
            // Caller serialization during admission can start shutdown, which stops new delivery.
            if (this._disposed || !this._core._canMutate()) {
                return captureFailure(new Error('Immediate analytics delivery is unavailable'))
            }
            return await deliver.call(this._driver, [message], () => this._core._immediateAuthority === authority)
        } catch (error) {
            return captureFailure(error)
        }
    }

    _capture(
        event: string,
        properties: Record<string, unknown> | null = null,
        options: CaptureOptions = {},
        skipRateLimit = false,
        personProperties?: PersonPropertiesAdmission
    ): boolean {
        return this._admitCapture(event, properties, options, skipRateLimit, false, personProperties) !== undefined
    }

    private _admitCapture(
        event: string,
        properties: Record<string, unknown> | null,
        options: CaptureOptions,
        skipRateLimit: boolean,
        immediate: boolean,
        personProperties?: PersonPropertiesAdmission
    ): AnalyticsMessage | undefined {
        if (!isNonEmptyString(event) || this._disposed || !this._core.canCapture) return undefined
        if (!this._acceptRateLimit(skipRateLimit)) return undefined
        // An identity another subdomain stored replaces this context's registered properties before they are read.
        this._adoptStoredIdentity()
        const snapshot = this._snapshotProperties(properties, options)
        if (!snapshot) return undefined
        const candidate = this._prepareCapture(event, snapshot)
        return candidate ? this._commitCapture(candidate, immediate, personProperties) : undefined
    }

    private _acceptRateLimit(skipRateLimit: boolean): boolean {
        if (skipRateLimit) return true
        const rateLimit = this._rateLimiter.consume()
        if (rateLimit.allowed) return true
        if (rateLimit.reportDropped !== undefined) this._reportRateLimit(rateLimit.reportDropped)
        return false
    }

    private _reportRateLimit(dropped: number): void {
        const warning = `${dropped} event(s) dropped since the last warning. Client limit is 10 events per second with a burst of 100.`
        this._core.logger.warn(`PostHog client rate limited: ${warning}`)
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

    private _snapshotProperties(
        properties: Record<string, unknown> | null,
        options: CaptureOptions
    ): CaptureProperties | undefined {
        const dynamic: Record<string, unknown> = {}
        for (const producer of this._dynamicEventProperties.slice()) {
            try {
                Object.assign(dynamic, producer())
            } catch (error) {
                this._core.logger.error('An event property producer failed', error)
            }
        }
        try {
            return snapshotCaptureProperties(this._registeredProperties.values(), dynamic, properties, options)
        } catch (error) {
            this._core.logger.error('Event properties are not JSON-serializable', error)
            return undefined
        }
    }

    private _prepareCapture(event: string, snapshot: CaptureProperties): PreparedCapture | undefined {
        const state = this._core._state
        const processPersonProfile = this._hasPersonProcessing()
        if (processPersonProfile) this._requirePersonProcessing()
        const preparedSession = state.prepareSessionForEvent()
        const session = preparedSession.context
        const distinctId = state.distinctId
        const groups = state.groups
        const uuid = snapshot.uuid ?? createId()
        const activePageviewId = this._pageviewIdFor(session.sessionId)
        const isPageview = event === '$pageview'
        const pageviewId = isPageview ? uuid : activePageviewId
        // Registered and caller values replace these for the event only; the tracked pageview stays the SDK's.
        // A caller key set to null or undefined is still set: the event omits it rather than taking the default.
        const defaults: Record<string, string> = {}
        if (pageviewId && !snapshot.overrides.has('$pageview_id')) defaults.$pageview_id = pageviewId
        if (activePageviewId && (isPageview || event === '$pageleave') && !snapshot.overrides.has('$prev_pageview_id'))
            defaults.$prev_pageview_id = activePageviewId
        const metadata = {
            token: this._core.projectToken,
            distinct_id: distinctId,
            $device_id: state.deviceId,
            $groups: groups,
            $session_id: session.sessionId,
            $window_id: session.windowId,
            $lib: 'web',
            $lib_version: version,
            $process_person_profile: processPersonProfile,
        }
        const message: AnalyticsMessage = {
            uuid,
            event,
            distinct_id: distinctId,
            properties: { ...defaults, ...snapshot.message, ...metadata },
            timestamp: eventTimestamp(snapshot.timestamp),
        }
        try {
            let bytes = utf8Bytes(JSON.stringify(message))
            if (bytes > MAX_ANALYTICS_BYTES) {
                const minimum = utf8Bytes(
                    JSON.stringify({
                        ...message,
                        properties: { ...defaults, ...unavoidableProperties(snapshot, metadata) },
                    })
                )
                if (minimum > MAX_ANALYTICS_BYTES) {
                    this._warnOversized(event, bytes)
                    return undefined
                }
            }
            const changed = applySessionProperties(snapshot, this._sessionProperties.values(session.sessionId))
            message.properties = { ...defaults, ...snapshot.message, ...metadata }
            if (changed) bytes = utf8Bytes(JSON.stringify(message))
            return {
                message,
                bytes,
                preparedSession,
                observedProperties: { ...defaults, ...snapshot.observed, ...metadata, $groups: { ...groups } },
            }
        } catch (error) {
            this._core.logger.error('The finalized event could not be measured', error)
            return undefined
        }
    }

    private _warnOversized(event: string, bytes: number): void {
        this._core.logger.warn(`Event "${event}" (${bytes} bytes) exceeds the local analytics limit and was dropped`)
    }

    private _commitCapture(
        candidate: PreparedCapture,
        immediate: boolean,
        personProperties?: PersonPropertiesAdmission
    ): AnalyticsMessage | undefined {
        const { message, bytes, preparedSession, observedProperties } = candidate
        if (immediate ? bytes > MAX_ANALYTICS_BYTES : !this._buffer.enqueue(message, bytes)) {
            if (bytes > MAX_ANALYTICS_BYTES) this._warnOversized(message.event, bytes)
            return undefined
        }
        const previous = this._core._state.session
        if (!this._core._state.sessionAdmitted(preparedSession)) {
            if (!immediate) this._buffer.discardQueued(message)
            return undefined
        }
        // Commit in admission order before session/event observers can admit another person operation.
        if (personProperties) this._lastPersonProperties = personProperties.signature
        else if (
            Object.hasOwn(message.properties, '$set') ||
            Object.hasOwn(message.properties, '$set_once') ||
            Object.hasOwn(message.properties, '$unset')
        )
            this._lastPersonProperties = undefined
        const session = preparedSession.context
        if (message.event === '$pageview') this._pageview = [message.uuid, session.sessionId]
        else if (this._pageview?.[1] !== session.sessionId) this._pageview = undefined
        this._sessionProperties.admitted(session.sessionId)
        if (previous?.sessionId !== session.sessionId || previous.windowId !== session.windowId)
            this._sessionIdPublisher.publish({ ...session })
        if (preparedSession.reason) this._newSessionPublisher.publish({ ...session, reason: preparedSession.reason })
        this._eventPublisher.publish(deepFreeze({ event: message.event, properties: observedProperties }))
        return message
    }

    /** A pageview belongs to its session, so an expired or rotated session has none. */
    _pageviewIdFor(sessionId: string | undefined): string | undefined {
        const pageview = this._pageview
        return pageview && pageview[1] === sessionId ? pageview[0] : undefined
    }

    _hasPersonProcessing(): boolean {
        const state = this._core._state
        return shouldProcessPerson(
            this._personProfiles,
            state.isIdentified,
            Object.keys(state.groups).length > 0,
            this._core.kv.get<boolean>('personProcessingEnabled') === true
        )
    }

    _requirePersonProcessing(): boolean {
        if (this._personProfiles === 'never') {
            this._core.logger.warn('Person processing is disabled by analytics configuration')
            return false
        }
        if (this._core.kv.get<boolean>('personProcessingEnabled') !== true)
            this._core.kv.set('personProcessingEnabled', true)
        return true
    }

    /** Whether a local identity operation may run now. Prepares state without requiring it. */
    _canMutate(): boolean {
        if (this._disposed || !this._core._canMutate()) return false
        this._core._state.prepare()
        this._adoptStoredIdentity()
        return true
    }

    /** Applies an identity another subdomain stored as this context applies its own reset or identify. */
    private _adoptStoredIdentity(): void {
        const state = this._core._state
        const previousDistinctId = state.distinctId
        const wasIdentified = state.isIdentified
        if (!state.adoptStoredIdentity()) return
        if (!state.isIdentified) return this._resetIdentityState()
        this._lastPersonProperties = undefined
        const distinctId = state.distinctId
        this._identifyPublisher.publish({
            distinctId,
            previousDistinctId,
            wasIdentified,
            set: undefined,
            setOnce: undefined,
        })
    }

    /** Clears state that belonged to the previous identity and notifies reset listeners. */
    private _resetIdentityState(): void {
        this._lastPersonProperties = undefined
        this._pageview = undefined
        this._sessionProperties.clear()
        this._resetPublisher.publish(undefined)
    }

    /** Whether registered properties are available now. */
    private _canUseProperties(): boolean {
        return !this._disposed && this._core._canMutate() && this._core._state.prepare()
    }

    _setPersonProperties(
        properties: PersonProperties,
        options: CaptureOptions = { set: properties.set, setOnce: properties.setOnce },
        identification?: IdentifyInfo
    ): void {
        if (!this._requirePersonProcessing() || this._lastPersonProperties === properties.signature) return
        // A different local update invalidates the old signature even if its event is rejected.
        this._lastPersonProperties = undefined
        this._changePropertiesPublisher.publish({ set: options.set, setOnce: options.setOnce })
        if (identification) this._identifyPublisher.publish(identification)
        this._capture('$set', null, options, false, { signature: properties.signature })
    }

    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void {
        if (!isValidDistinctId(distinctId) || !this._canMutate() || !this._requirePersonProcessing()) return
        const state = this._core._state
        const previousDistinctId = state.distinctId
        const wasIdentified = state.isIdentified
        const hasProperties = !!set || !!setOnce
        // Identity is local state, independent of whether the property payload can be admitted.
        if (distinctId !== previousDistinctId || !wasIdentified) state.identify(distinctId)
        const properties = snapshotPersonProperties(distinctId, set, setOnce)
        if (!properties) {
            this._core.logger.warn('Person properties must be JSON-serializable objects')
            if (distinctId !== previousDistinctId || !wasIdentified || hasProperties) {
                this._identifyPublisher.publish({ distinctId, previousDistinctId, wasIdentified, set, setOnce })
            }
            return
        }
        const options: CaptureOptions = {}
        if (set) options.set = properties.set
        if (setOnce) options.setOnce = properties.setOnce
        const info = { distinctId, previousDistinctId, wasIdentified, set: options.set, setOnce: options.setOnce }
        const signature = { signature: properties.signature }
        if (distinctId === previousDistinctId && wasIdentified) {
            if (hasProperties) this._setPersonProperties(properties, options, info)
            return
        }
        this._lastPersonProperties = undefined
        if (hasProperties) this._changePropertiesPublisher.publish({ set: options.set, setOnce: options.setOnce })
        this._identifyPublisher.publish(info)
        if (!wasIdentified && distinctId !== previousDistinctId) {
            this._capture('$identify', { $anon_distinct_id: previousDistinctId }, options, false, signature)
        } else if (distinctId === previousDistinctId) {
            this._capture('$set', null, { set: properties.set, setOnce: properties.setOnce }, false, signature)
        } else if (hasProperties) {
            this._capture('$set', null, options, false, signature)
        }
    }

    reset(options?: boolean | ResetOptions): void {
        // A reset replaces any identity another subdomain stored, so it does not adopt that identity first.
        if (this._disposed || !this._core._canMutate()) return
        this._core._state.prepare()
        const { resetDeviceId, bootstrap } =
            options === true || options === false ? { resetDeviceId: options } : snapshotOptions<ResetOptions>(options)
        const { distinctId, isIdentifiedId } = bootstrap ?? {}
        this._core._state.reset(
            resetDeviceId === true,
            isValidDistinctId(distinctId) ? [distinctId, isIdentifiedId === true] : undefined,
            this._bootstrapSession(bootstrap)
        )
        this._resetIdentityState()
    }

    /** Applies setup bootstrap without replacing a persisted identity, as in posthog-js. */
    bootstrap(options: BootstrapOptions | undefined): void {
        const bootstrap = snapshotOptions(options)
        const { distinctId, isIdentifiedId } = bootstrap
        const session = this._bootstrapSession(bootstrap)
        if (session) this._core._state.bootstrapSession(session)
        if (!isValidDistinctId(distinctId) || !this._canMutate()) return
        const state = this._core._state
        if (state.generated) return state.bootstrapIdentity(distinctId, isIdentifiedId === true)
        // An anonymous ID never replaces a stored identity.
        if (isIdentifiedId !== true) return
        // A matching ID only marks the user identified, without an event.
        if (distinctId === state.distinctId) state.identify(distinctId)
        else if (!state.isIdentified) this.identify(distinctId)
        else this._core.logger.warn('Ignored the bootstrap distinct ID of a different identified user')
    }

    private _bootstrapSession(bootstrap: BootstrapOptions | undefined): ReturnType<typeof readBootstrapSession> {
        const sessionId = bootstrap?.sessionId
        if (sessionId === undefined) return undefined
        const session = readBootstrapSession(sessionId)
        if (!session) this._core.logger.error('Ignored the bootstrap session ID: not a past UUIDv7')
        return session
    }

    private _registration(properties: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!this._canUseProperties()) return
        const snapshot = snapshotRegisteredProperties(properties)
        // Serialization runs caller code, which can dispose the client.
        if (!this._canUseProperties()) return
        if (!snapshot) this._core.logger.warn('Super properties must serialize to an object')
        return snapshot
    }

    register(properties: Record<string, unknown>): void {
        const snapshot = this._registration(properties)
        if (snapshot) this._registeredProperties.register(snapshot)
    }

    registerOnce(properties: Record<string, unknown>, defaultValue: unknown = 'None'): void {
        const snapshot = this._registration(properties)
        if (snapshot) this._registeredProperties.registerOnce(snapshot, defaultValue)
    }

    registerForSession(properties: Record<string, unknown>): void {
        const snapshot = this._registration(properties)
        if (snapshot) this._sessionProperties.register(snapshot, this._core._state.activeSessionId)
    }

    unregisterForSession(property: string): void {
        if (this._canUseProperties()) this._sessionProperties.unregister(property, this._core._state.activeSessionId)
    }

    unregister(property: string): void {
        if (this._canUseProperties()) this._registeredProperties.unregister(property)
    }

    getProperty(property: string): unknown {
        return this._canUseProperties() ? this._registeredProperties.get(property) : undefined
    }

    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable {
        if (this._disposed || this._core._disposed) return { dispose() {} }
        this._dynamicEventProperties.push(producer)
        let active = true
        return {
            dispose: () => {
                if (!active) return
                active = false
                const index = this._dynamicEventProperties.indexOf(producer)
                if (index !== -1) this._dynamicEventProperties.splice(index, 1)
            },
        }
    }
}

/** The client's capture pipeline, for optional modules that extend it with less common operations. */
export const analyticsOf = (posthog: object): Analytics | undefined =>
    (posthog as { _analytics?: Analytics })._analytics
