import type { Client, Disposable, Extension } from '@posthog/browser-common'
import type { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { SessionRecording } from '@posthog/browser-common/replay/session-recording'
import type {
    ReplayHost,
    ReplayOptions as SharedReplayOptions,
    ReplayRecorderHost,
} from '@posthog/browser-common/replay/host'
import {
    SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP,
    SESSION_RECORDING_FLUSHED_SIZE,
    SESSION_RECORDING_REMOTE_CONFIG,
} from '@posthog/browser-common/replay/constants'
import type { ReplayExtension, ReplayHostContext, ReplaySessionHost } from './replay-internal'
import { createReplayDelivery } from './replay-delivery'
import { snapshotReplayOptions, type ReplayOptions } from './replay-options'

export type { ReplayOptions } from './replay-options'

type FlagSubscription = {
    listener: (variants: Record<string, string | boolean>) => void
    attached: boolean
    dispose: (() => void) | undefined
}

/** Include replay orchestration statically; rrweb still loads only when recording is enabled. */
export const replay = (options: ReplayOptions = {}): Extension => {
    const snapshot = snapshotReplayOptions(options)
    const {
        fullSnapshotIntervalMs,
        triggerPendingBufferIntervalMs,
        compressEvents,
        sessionIdleThresholdMs,
        consoleLogRecordingEnabled,
        networkTiming,
        disableCaptureUrlHashes,
        maskPersonalData,
        personalDataQueryParams,
        ...recording
    } = snapshot
    let session!: ReplaySessionHost
    let context!: ReplayHostContext
    let client: Client | undefined
    let controller: SessionRecording | undefined
    let delivery: ReturnType<typeof createReplayDelivery> | undefined
    let loaded: typeof import('./entrypoints/replay-runtime') | undefined
    let loading: Promise<typeof import('./entrypoints/replay-runtime')> | undefined
    let disposed = false
    let closing = false
    let drainingOnStop = false
    let stopDrainRevoked = false
    let changingConsent = false
    let denied = false
    let savedConfig: unknown
    let sessionProperties: Record<string, unknown> = {}
    const subscriptions: Disposable[] = []
    const listeners: Array<[string, EventListener]> = []
    const flagSubscriptions = new Set<FlagSubscription>()
    const connectFlags = () => {
        if (disposed || closing) return
        const flags = client?.getExtension<PostHogFeatureFlags>('featureFlags')
        if (!flags) return
        for (const subscription of flagSubscriptions) {
            if (subscription.attached) continue
            subscription.attached = true
            const dispose = flags.onFeatureFlags((_keys, variants) => subscription.listener(variants))
            // Cached flag publication can synchronously dispose the subscribing recorder.
            if (flagSubscriptions.has(subscription)) subscription.dispose = dispose
            else dispose()
        }
    }
    const sharedOptions = (): SharedReplayOptions => ({
        recording: {
            ...recording,
            ...(fullSnapshotIntervalMs === undefined ? {} : { full_snapshot_interval_millis: fullSnapshotIntervalMs }),
            ...(triggerPendingBufferIntervalMs === undefined
                ? {}
                : { trigger_pending_buffer_interval_millis: triggerPendingBufferIntervalMs }),
            ...(compressEvents === undefined ? {} : { compress_events: compressEvents }),
            ...(sessionIdleThresholdMs === undefined ? {} : { session_idle_threshold_ms: sessionIdleThresholdMs }),
        },
        disabled: false,
        ...(consoleLogRecordingEnabled === undefined ? {} : { consoleLogRecordingEnabled }),
        ...(networkTiming === undefined ? {} : { networkTiming }),
        apiHost: context.runtime[0].api,
        // Core's pageview has no URL; replay owns its navigation observation.
        capturePageview: false,
        stripUrlHash: disableCaptureUrlHashes ?? true,
        maskPersonalData: maskPersonalData ?? true,
        ...(personalDataQueryParams ? { personalDataQueryParams } : {}),
    })
    const pendingKey = () => `ph_replay_pending_${JSON.stringify([context.persistenceKey, context.runtime[1]])}`
    const purgePending = () => {
        try {
            context.pendingStorage?.removeItem(pendingKey())
        } catch {
            /* Storage may be unavailable. */
        }
    }
    const registerSessionProperties = (properties: Record<string, unknown>) =>
        Object.assign(sessionProperties, properties)
    const recorderHost = (): ReplayRecorderHost => ({
        get sessionActive() {
            return !disposed && !closing && !denied && session.sessionActive && !!client?.canCapture
        },
        canDrainOnStop: () =>
            drainingOnStop && !disposed && !denied && !stopDrainRevoked && !!session.canDrainOnStop?.(),
        sessionTimeoutMs: session.sessionTimeoutMs,
        checkSession: (options) => session.checkSession(options),
        onSessionChange: (listener) => session.onSessionChange(listener),
        onForcedIdle: () => undefined,
        onFlags: (listener) => {
            const subscription: FlagSubscription = { listener, attached: false, dispose: undefined }
            flagSubscriptions.add(subscription)
            connectFlags()
            return {
                dispose() {
                    flagSubscriptions.delete(subscription)
                    subscription.dispose?.()
                    subscription.dispose = undefined
                },
            }
        },
        get targetingUrl() {
            try {
                return globalThis.location?.href
            } catch {
                return undefined
            }
        },
        isIngestionEndpoint: (value) => {
            try {
                const url = new URL(value, context.runtime[0].api)
                const endpoint =
                    client?.kv.get<{ endpoint?: string }>(SESSION_RECORDING_REMOTE_CONFIG)?.endpoint ?? '/s/'
                const routes = [
                    new URL(`${context.runtime[0].api}${endpoint}`),
                    new URL(`${context.runtime[0].api}/i/v1/analytics/events`),
                    new URL('/i/v1/logs', context.runtime[0].api),
                    new URL(`/array/${encodeURIComponent(client?.projectToken ?? '')}/config`, context.runtime[0].api),
                    new URL('/flags/', context.runtime[0].flags),
                ]
                return routes.some((target) => {
                    return (
                        target.origin === url.origin &&
                        target.pathname.replace(/\/$/, '') === url.pathname.replace(/\/$/, '')
                    )
                })
            } catch {
                return false
            }
        },
        registerSessionProperties,
        captureSnapshot: (endpoint, properties) => {
            if (!disposed && !denied && !stopDrainRevoked) delivery?.capture(endpoint, properties)
        },
        onRecorderUnload: () => {
            if (!disposed && !denied) delivery?.teardown()
        },
        createPendingBufferStore: () => {
            const storage = context.pendingStorage
            const key = pendingKey()
            return {
                get enabled() {
                    return !disposed && !denied && !!storage && !!client?.canCapture
                },
                read() {
                    if (!this.enabled) return undefined
                    try {
                        return JSON.parse(storage!.getItem(key) ?? 'null') as unknown
                    } catch {
                        return undefined
                    }
                },
                write(value) {
                    if (!this.enabled) return
                    try {
                        storage!.setItem(key, JSON.stringify(value))
                    } catch {
                        /* Best effort. */
                    }
                },
                remove: () => {
                    try {
                        storage?.removeItem(key)
                    } catch {
                        /* Best effort. */
                    }
                },
            }
        },
        createFlushedSizeWriter: () => (value) => client?.kv.set(SESSION_RECORDING_FLUSHED_SIZE, value),
        recordFirstSnapshot: (timestamp) => {
            if (client?.kv.get(SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP) === undefined) {
                client?.kv.set(SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP, timestamp)
            }
        },
        emitConfigEvent: (emit) => {
            emit('$posthog_config', { config: { replay: snapshot } })
        },
    })
    const start = async () => {
        if (disposed || closing || denied || controller || !client?.canCapture) return
        const value = client
        const host: ReplayHost = {
            get sessionActive() {
                return !disposed && !closing && session.sessionActive
            },
            get isAllowed() {
                return !disposed && !closing && !denied && value.canCapture
            },
            onSessionChange: (listener) => session.onSessionChange(listener),
            registerSessionProperties,
            requestConfigRefresh: () => context.refreshRemoteConfig(),
            loadRecorder: (_script, callback) => {
                loading ??= import('./entrypoints/replay-runtime').catch((error: unknown) => {
                    loading = undefined
                    throw error
                })
                void loading.then(
                    (module) => {
                        loaded = module
                        callback()
                    },
                    () => callback('Replay runtime loading failed')
                )
            },
            createRecorder: (visible) =>
                loaded?.createRecorder(
                    {
                        kv: value.kv,
                        logger: value.logger,
                        library: value.library,
                        onEvent: value.onEvent,
                        replay: recorderHost(),
                    },
                    sharedOptions,
                    visible
                ),
        }
        const next = new SessionRecording(sharedOptions)
        controller = next
        await next.setup({ ...value, replay: host })
        if (!disposed && !closing && controller === next) next.initialize()
    }
    const consentChanged = (allowed: boolean) => {
        if (disposed || changingConsent || !client) return
        denied = !allowed
        if (denied && closing) stopDrainRevoked = true
        changingConsent = true
        try {
            if (denied) {
                const previous = controller
                controller = undefined
                previous?.dispose({ discardBufferedEvents: true })
                delivery?.purge()
                purgePending()
            } else if (!closing) {
                // Core publishes the transition before writing consent storage. Do not reread it mid-write.
                void Promise.resolve()
                    .then(start)
                    .catch((error: unknown) => client?.logger.error('Replay start failed', error))
            }
        } finally {
            changingConsent = false
        }
    }
    const extension: ReplayExtension = {
        name: 'sessionRecording',
        initialize: (value, host) => {
            session = value
            context = host
        },
        async setup(value) {
            client = value
            delivery = createReplayDelivery(value, context)
            subscriptions.push(
                session.onSessionChange(() => {
                    sessionProperties = {}
                })
            )
            subscriptions.push(
                value.registerDynamicEventProperties(() => ({
                    ...sessionProperties,
                    ...controller?.sdkDebugProperties,
                }))
            )
            const observe = (name: string, action: () => void) => {
                const listener = () => {
                    try {
                        action()
                    } catch (error) {
                        value.logger.error('Replay lifecycle failed', error)
                    }
                }
                try {
                    // oxlint-disable-next-line posthog-js/no-add-event-listener
                    globalThis.addEventListener(name, listener)
                    listeners.push([name, listener])
                } catch {
                    /* Non-browser host. */
                }
            }
            // Active recorders hand off after their own final drain, independent of listener order.
            observe('pagehide', () => {
                if (!controller?.started) delivery?.teardown()
            })
            observe('online', () => delivery?.online())
            observe('offline', () => delivery?.offline())
            if (value.isOptedOut) consentChanged(false)
            await start()
        },
        connectFlags,
        consentChanged,
        beforeReset: () => {
            savedConfig = client?.kv.get(SESSION_RECORDING_REMOTE_CONFIG)
            controller?.flushBeforeIdentityReset()
        },
        afterReset: () => {
            sessionProperties = {}
            purgePending()
            if (savedConfig !== undefined) client?.kv.set(SESSION_RECORDING_REMOTE_CONFIG, savedConfig)
            savedConfig = undefined
        },
        async flush(shutdown) {
            if (disposed) return
            if (shutdown) {
                closing = true
                drainingOnStop = true
                try {
                    controller?.stopRecording()
                    controller?.flushBeforeIdentityReset()
                } finally {
                    drainingOnStop = false
                }
            } else {
                controller?.flushBeforeIdentityReset()
            }
            await delivery?.flush()
        },
        async dispose() {
            if (disposed) return
            disposed = true
            controller?.dispose({ discardBufferedEvents: true })
            controller = undefined
            for (const subscription of flagSubscriptions) subscription.dispose?.()
            flagSubscriptions.clear()
            for (const [name, listener] of listeners.splice(0)) globalThis.removeEventListener(name, listener)
            for (const subscription of subscriptions.splice(0)) subscription.dispose()
            await delivery?.dispose()
            client = undefined
        },
    }
    return extension
}
