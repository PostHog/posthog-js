import type { Client, CaptureOptions, CapturedEventInfo, Disposable, Listener } from '@posthog/browser-common'
import {
    Analytics as AnalyticsToken,
    MAX_ANALYTICS_BATCH_EVENTS,
    MAX_ANALYTICS_BYTES,
    type AnalyticsCaptureHost,
    type AnalyticsDeliveryFactory,
    type AnalyticsDriver,
    type IAnalyticsExtension,
    type AnalyticsMessage,
    type CaptureHost,
} from './analytics-internal'
import type { IPostHogInternal } from './browser-client'
import type { AnalyticsOptions, AutomaticAnalyticsOptions } from './analytics-options'
import { EventBuffer } from './event-buffer'
import { captureFailure, EMPTY_CAPTURE_SUMMARY } from './capture-summary'
import { createId } from './id'
import { deepFreeze } from './immutable'
import { ClientRateLimiter } from './rate-limiter'
import { snapshotCaptureProperties, type CaptureProperties } from './capture-properties'
import type { CaptureSummary } from './types'
import { version } from './version'
import { utf8Bytes } from './utf8'

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

type LoadReason = 'capture' | 'immediate' | 'flush' | 'shutdown' | 'eager'

const CLIENT_RATE_LIMIT_WARNING = '$$client_ingestion_warning'
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isValidDistinctId = (value: unknown): value is string =>
    isNonEmptyString(value) &&
    !['$posthog_cookieless', 'distinct_id', 'distinctid', 'undefined', 'null'].includes(value.toLowerCase())

const eventTimestamp = (timestamp: Date | undefined): string => {
    try {
        return (timestamp ?? new Date()).toISOString()
    } catch {
        return new Date().toISOString()
    }
}

interface PreparedCapture {
    readonly message: AnalyticsMessage
    readonly bytes: number
    readonly preparedSession: ReturnType<AnalyticsCaptureHost['state']['prepareSessionForEvent']>
    readonly observedProperties: Record<string, unknown>
}

/** One product instance owns analytics operations, admission, buffering and delivery coordination. */
export class Analytics implements IAnalyticsExtension {
    readonly name = AnalyticsToken
    declare readonly isRateLimited: boolean

    private _host: AnalyticsCaptureHost | undefined
    private _client!: Client
    private _deliveryHost!: CaptureHost
    private _driver: AnalyticsDriver | undefined
    private _loading: Promise<void> | undefined
    private _disposed = false
    private _isTearingDown = false
    private _failures = 0
    private readonly _rateLimiter: ClientRateLimiter
    private readonly _dynamicEventProperties: Array<() => Record<string, unknown>> = []
    private readonly _disposalWaiters = new Set<() => void>()
    private readonly _teardownCallbacks = new Set<() => void>()
    private readonly _buffer: EventBuffer<AnalyticsMessage>
    private readonly _scheduling: Readonly<Required<Pick<AnalyticsOptions, 'flushAt' | 'flushInterval'>>>
    private readonly _eager: boolean
    private readonly _load: (() => Promise<AnalyticsDeliveryFactory>) | undefined
    private readonly _deliveryFactory: AnalyticsDeliveryFactory | undefined

    constructor(
        options: AutomaticAnalyticsOptions = {},
        load?: () => Promise<AnalyticsDeliveryFactory>,
        deliveryFactory?: AnalyticsDeliveryFactory
    ) {
        this._load = load
        this._deliveryFactory = deliveryFactory
        let eager = false
        if (load) {
            try {
                eager = options.load === 'eager'
            } catch {
                // Unavailable configuration uses lazy loading.
            }
        }
        this._eager = eager
        this._scheduling = {
            flushAt: numberOption(() => options.flushAt, 20, 1, MAX_ANALYTICS_BATCH_EVENTS),
            flushInterval: numberOption(() => options.flushInterval, 3_000, 0, Number.MAX_SAFE_INTEGER),
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
        this._rateLimiter = new ClientRateLimiter()
        Object.defineProperty(this, 'isRateLimited', {
            configurable: true,
            enumerable: true,
            get: () => this._rateLimiter.wouldLimit,
        })
    }

    readonly bindCaptureHost = (host: AnalyticsCaptureHost): void => {
        this._host = host
    }

    readonly setup = (value: IPostHogInternal): void => {
        this._client = value.sharedClient
    }

    readonly initialize = (host: CaptureHost): void => {
        this._deliveryHost = host
        if (this._deliveryFactory) {
            this._driver = this._deliveryFactory(
                this._buffer,
                this._client,
                host,
                this._scheduling,
                this._beforeTeardown
            )
        }
    }

    readonly start = (): Promise<void> => (this._eager ? this._ensureDelivery('eager') : Promise.resolve())

    readonly onBeforeTeardown: NonNullable<IAnalyticsExtension['onBeforeTeardown']> = (callback) => {
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

    readonly flush: IAnalyticsExtension['flush'] = async (reason = 'flush') => {
        if (this._disposed) return
        if (reason === 'shutdown' && this._loading) {
            await this._loading
        } else if (this._buffer.hasPending()) {
            await this._ensureDelivery(reason)
        }
        await this._driver?.flush()
    }

    readonly purge = (): void => this._buffer.purge()

    readonly dispose = (): Promise<void> | undefined => {
        this._disposed = true
        this._dynamicEventProperties.splice(0)
        for (const release of this._disposalWaiters) release()
        this._disposalWaiters.clear()
        this._teardownCallbacks.clear()
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

    private async _ensureDelivery(reason: LoadReason, retryAfterPending = true): Promise<void> {
        const load = this._load
        if (!load || this._disposed || this._driver) return
        if (this._loading) {
            if (reason === 'capture' || !retryAfterPending) return this._loading
            const previousFailures = this._failures
            await this._loading
            if (this._failures > previousFailures && this._buffer.hasPending()) {
                await this._ensureDelivery(reason, false)
            }
            return
        }
        if (reason === 'capture' && this._failures > 0) return
        const loadDelivery = async () => {
            // Publish the shared promise before invoking a loader that can throw or reenter.
            await Promise.resolve()
            try {
                const createDelivery = await load()
                if (this._disposed) return
                this._driver = createDelivery(
                    this._buffer,
                    this._client,
                    this._deliveryHost,
                    this._scheduling,
                    this._beforeTeardown
                )
            } catch (error: unknown) {
                if (!this._driver) {
                    this._failures++
                    this._client.logger.error('Automatic analytics loading failed', error)
                }
            } finally {
                if (this._loading === pending) this._loading = undefined
            }
        }
        const pending = loadDelivery()
        this._loading = pending
        return pending
    }

    private async _deliverImmediate(message: AnalyticsMessage, canContinue: () => boolean): Promise<CaptureSummary> {
        // A pending loader must not hold an immediate capture open after disposal.
        let release!: () => void
        const disposal = new Promise<void>((resolve) => {
            release = resolve
            this._disposalWaiters.add(resolve)
        })
        try {
            await Promise.race([this._ensureDelivery('immediate'), disposal])
        } finally {
            this._disposalWaiters.delete(release)
        }
        let deliverImmediate: AnalyticsDriver['deliverImmediate'] | undefined
        try {
            deliverImmediate = this._driver?.deliverImmediate
        } catch {
            deliverImmediate = undefined
        }
        if (!canContinue()) {
            return captureFailure(new Error('Immediate analytics delivery was cancelled'))
        }
        if (!this._driver || typeof deliverImmediate !== 'function' || this._disposed) {
            return captureFailure(new Error('Immediate analytics delivery is unavailable'))
        }
        return deliverImmediate.call(this._driver, [message], canContinue)
    }

    private _deliverUnload(message: AnalyticsMessage, canContinue: () => boolean): void {
        const send = () => {
            if (this._disposed || !canContinue()) return
            try {
                this._driver?.deliverUnload([message])
            } catch (error) {
                this._deliveryHost.reportFailure(error)
            }
        }
        if (this._driver) {
            send()
        } else {
            void this._ensureDelivery('immediate').then(send, (error) => this._deliveryHost.reportFailure(error))
        }
    }

    readonly onEvent: Listener<CapturedEventInfo> = (listener) =>
        (!this._disposed && this._host?.onEvent(listener)) || { dispose() {} }
    readonly captureInitialPageview = (): boolean => {
        return this._capture('$pageview')
    }

    readonly capture = (
        event: string,
        properties: Record<string, unknown> | null = null,
        options: CaptureOptions = {}
    ): boolean => {
        try {
            if (options.delivery === 'unload' && !this._isTearingDown) {
                return this._captureUnload(event, properties, options)
            }
        } catch (error) {
            this._host?.logger.error('Unload capture failed', error)
            return true
        }
        return this._capture(event, properties, options) || !this._rateLimiter.limited
    }

    private _captureUnload(
        event: string,
        properties: Record<string, unknown> | null,
        options: CaptureOptions
    ): boolean {
        const authority = this._host?.authority()
        const message = this._admitCapture(event, properties, options, false, true)
        if (message) this._deliverUnload(message, () => this._host?.authority() === authority)
        return !!message || !this._rateLimiter.limited
    }

    readonly captureImmediate = async (
        event: string,
        properties: Record<string, unknown> | null = null,
        options: CaptureOptions = {}
    ): Promise<CaptureSummary> => {
        try {
            const authority = this._host?.authority()
            const message = this._admitCapture(event, properties, options, false, true)
            if (!message) {
                return EMPTY_CAPTURE_SUMMARY
            }

            return await this._deliverImmediate(message, () => this._host?.authority() === authority)
        } catch (error) {
            return captureFailure(error)
        }
    }

    private _capture(
        event: string,
        properties: Record<string, unknown> | null = null,
        options: CaptureOptions = {},
        skipRateLimit = false
    ): boolean {
        return this._admitCapture(event, properties, options, skipRateLimit, false) !== undefined
    }

    private _admitCapture(
        event: string,
        properties: Record<string, unknown> | null,
        options: CaptureOptions,
        skipRateLimit: boolean,
        immediate: boolean
    ): AnalyticsMessage | undefined {
        if (!isNonEmptyString(event) || this._disposed || !this._host?.canCapture() || !this._host.state.prepare()) {
            return undefined
        }
        if (!this._acceptRateLimit(skipRateLimit)) return undefined
        const snapshot = this._snapshotProperties(properties, options)
        if (!snapshot) return undefined
        const candidate = this._prepareCapture(event, snapshot, this._host)
        return candidate ? this._commitCapture(candidate, immediate, this._host) : undefined
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
        this._host?.logger.warn(`PostHog client rate limited: ${warning}`)
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

    private _dynamicProperties(): Record<string, unknown> {
        const properties: Record<string, unknown> = {}
        for (const producer of this._dynamicEventProperties.slice()) {
            try {
                Object.assign(properties, producer())
            } catch (error) {
                this._host?.logger.error('An event property producer failed', error)
            }
        }
        return properties
    }

    private _snapshotProperties(
        properties: Record<string, unknown> | null,
        options: CaptureOptions
    ): CaptureProperties | undefined {
        const dynamic = this._dynamicProperties()
        try {
            return snapshotCaptureProperties(dynamic, properties, options)
        } catch (error) {
            this._host?.logger.error('Event properties are not JSON-serializable', error)
            return undefined
        }
    }

    private _prepareCapture(
        event: string,
        snapshot: CaptureProperties,
        host: AnalyticsCaptureHost
    ): PreparedCapture | undefined {
        const preparedSession = host.state.prepareSessionForEvent()
        const session = preparedSession.context
        const distinctId = host.state.distinctId
        const deviceId = host.state.deviceId
        const groups = host.state.groups
        const metadata = {
            token: host.projectToken,
            distinct_id: distinctId,
            $device_id: deviceId,
            $groups: groups,
            $session_id: session.sessionId,
            $window_id: session.windowId,
            $lib: 'web',
            $lib_version: version,
        }
        const observedProperties = { ...snapshot.observed, ...metadata, $groups: { ...groups } }
        const message: AnalyticsMessage = {
            uuid: snapshot.uuid ?? createId(),
            event,
            distinct_id: distinctId,
            properties: { ...snapshot.message, ...metadata },
            timestamp: eventTimestamp(snapshot.timestamp),
        }
        const bytes = this._measureCapture(message)
        if (bytes === undefined) return undefined
        return {
            message,
            bytes,
            preparedSession,
            observedProperties,
        }
    }

    private _measureCapture(message: AnalyticsMessage): number | undefined {
        try {
            return utf8Bytes(JSON.stringify(message))
        } catch (error) {
            this._host?.logger.error('The finalized event could not be measured', error)
            return undefined
        }
    }

    private _warnOversized(event: string, bytes: number): void {
        this._host?.logger.warn(`Event "${event}" (${bytes} bytes) exceeds the local analytics limit and was dropped`)
    }

    private _enqueueCapture(candidate: PreparedCapture, immediate: boolean): boolean {
        const { message, bytes } = candidate
        if (immediate ? bytes > MAX_ANALYTICS_BYTES : !this._buffer.enqueue(message, bytes)) {
            if (bytes > MAX_ANALYTICS_BYTES) this._warnOversized(message.event, bytes)
            return false
        }
        return true
    }

    private _commitCapture(
        candidate: PreparedCapture,
        immediate: boolean,
        host: AnalyticsCaptureHost
    ): AnalyticsMessage | undefined {
        if (!this._enqueueCapture(candidate, immediate)) return undefined
        if (!host.state.sessionAdmitted(candidate.preparedSession)) {
            if (!immediate) this._buffer.discardQueued(candidate.message)
            return undefined
        }
        this._publishCapture(candidate, host)
        if (!immediate) void this._ensureDelivery('capture')
        return candidate.message
    }

    private _publishCapture(candidate: PreparedCapture, host: AnalyticsCaptureHost): void {
        const { preparedSession, message, observedProperties } = candidate
        const session = preparedSession.context
        if (preparedSession.reason) {
            host.publishNewSession({ ...session, reason: preparedSession.reason })
        }
        host.publishEvent(deepFreeze({ event: message.event, properties: observedProperties }))
    }

    readonly identify = async (
        distinctId: string,
        set?: Record<string, unknown>,
        setOnce?: Record<string, unknown>
    ): Promise<void> => {
        if (!isValidDistinctId(distinctId) || this._disposed || !this._host?.canMutate()) {
            return
        }

        this._host.state.prepare()
        const previousDistinctId = this._host.state.distinctId
        const wasIdentified = this._host.state.isIdentified
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
                this._host.state.identify(distinctId)
                this._host.publishIdentify({ distinctId, previousDistinctId, wasIdentified, set, setOnce })
                this.capture('$set', null, { set: set ?? {}, setOnce: setOnce ?? {} })
            } else if (hasPersonProperties) {
                this._host.publishIdentify({ distinctId, previousDistinctId, wasIdentified, set, setOnce })
                this.capture('$set', null, captureOptions)
            }
            return
        }

        this._host.state.identify(distinctId)
        this._host.publishIdentify({ distinctId, previousDistinctId, wasIdentified, set, setOnce })
        if (!wasIdentified) {
            this.capture('$identify', { $anon_distinct_id: previousDistinctId }, captureOptions)
        } else if (hasPersonProperties) {
            this.capture('$set', null, captureOptions)
        }
    }

    readonly group = async (type: string, key: string, properties?: Record<string, unknown>): Promise<void> => {
        if (!isNonEmptyString(type) || !isNonEmptyString(key) || this._disposed || !this._host?.canMutate()) {
            return
        }

        this._host.state.prepare()
        const changed = this._host.state.group(type, key)
        if (!changed && !properties) {
            return
        }
        this._host.publishGroup({ type, key, changed, properties })
        this.capture('$groupidentify', {
            $group_type: type,
            $group_key: key,
            ...(properties ? { $group_set: properties } : {}),
        })
    }

    readonly reset = (): void => {
        if (this._disposed || !this._host?.canMutate()) {
            return
        }
        this._host.state.prepare()
        this._host.state.reset()
        this._host.publishReset(undefined)
    }

    readonly registerDynamicEventProperties = (producer: () => Record<string, unknown>): Disposable => {
        if (this._disposed || !this._host || this._host.isDisposed()) {
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
}
