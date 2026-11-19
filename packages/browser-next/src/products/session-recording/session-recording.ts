import type {
    CapturedEventInfo,
    DeepReadonly,
    Disposable,
    RemoteConfig,
    RemoteConfigResult,
    SessionRecordingPersistedConfig,
    SessionStartReason,
} from '@posthog/browser-common'
import {
    RECORDING_REMOTE_CONFIG_TTL_MS,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
    SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
    SESSION_RECORDING_OVERRIDE_SAMPLING,
    SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
    SESSION_RECORDING_REMOTE_CONFIG,
    SESSION_RECORDING_SAMPLE_RATE,
} from '@posthog/browser-common/replay/replay-constants'
import type { SessionRecordingStatus } from '@posthog/browser-common/replay/trigger-matching'

import type { IPostHog } from '../../core/types'
import { analyticsOf } from '../analytics/analytics-core'
import type { SessionRecorder } from './recorder'
import type {
    SessionRecordingExtension,
    SessionRecordingOverride,
    SessionReplayUrlOptions,
} from './session-recording-internal'
import { snapshotSessionRecordingOptions, type SessionRecordingOptions } from './session-recording-options'

export type { SessionRecordingExtension, SessionRecordingOverride, SessionReplayUrlOptions }
export type { SessionRecordingOptions, SessionRecordingConfiguration } from './session-recording-options'

const RECORDING_SCRIPT_NOT_LOADED = '$sdk_debug_recording_script_not_loaded'
const STALE_CONFIG = '$sdk_debug_replay_stale_config'
const MAX_EARLY_EVENTS = 100
const DEBUG_PROPERTIES_INTERVAL_MS = 30_000

// SDK events that carry the optional replay diagnostics, at most once per interval, as in posthog-js
const carriesOptionalDebugProperties = (event: string): boolean =>
    event[0] === '$' && event !== '$feature_flag_called' && event !== '$$heatmap'

const validSampleRate = (rate: unknown): number | null => {
    if (rate === null || rate === undefined) return null
    const parsed = parseFloat(String(rate))
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
}

/** The replay configuration persisted from remote config, in the shape posthog-js persists it. */
const toPersistedConfig = (
    response: DeepReadonly<RemoteConfig>,
    localSampleRate: number | undefined
): SessionRecordingPersistedConfig => {
    const remote = response.sessionRecording === false ? undefined : response.sessionRecording
    const copy = remote ? (JSON.parse(JSON.stringify(remote)) as NonNullable<RemoteConfig['sessionRecording']>) : {}
    const {
        recordCanvas,
        canvasFps,
        canvasQuality,
        networkPayloadCapture,
        sampleRate,
        minimumDurationMilliseconds,
        ...rest
    } = copy as Exclude<RemoteConfig['sessionRecording'], false | undefined>
    return {
        ...rest,
        cache_timestamp: Date.now(),
        enabled: !!remote,
        networkPayloadCapture: {
            capturePerformance: response.capturePerformance as RemoteConfig['capturePerformance'],
            ...networkPayloadCapture,
        },
        canvasRecording: { enabled: recordCanvas, fps: canvasFps, quality: canvasQuality },
        sampleRate: validSampleRate(localSampleRate) ?? validSampleRate(sampleRate),
        minimumDurationMilliseconds: minimumDurationMilliseconds ?? null,
    }
}

/** Whether two saved replay configurations differ only in when they were saved. */
const sameConfig = (a: SessionRecordingPersistedConfig, b: SessionRecordingPersistedConfig): boolean =>
    JSON.stringify({ ...a, cache_timestamp: 0 }) === JSON.stringify({ ...b, cache_timestamp: 0 })

const hasDocumentEverBeenVisible = (): boolean => {
    try {
        const document = globalThis.document
        if (!document?.visibilityState || document.visibilityState === 'visible') return true
        const entries = globalThis.performance?.getEntriesByType?.('visibility-state')
        return !entries?.length || entries.some((entry) => entry.name === 'visible')
    } catch {
        return true
    }
}

const uiHostFor = (apiHost: string, configured: string | undefined): string => {
    const host = (configured || apiHost.replace('.i.posthog.com', '.posthog.com')).replace(/\/$/, '')
    return host === 'https://app.posthog.com' ? 'https://us.posthog.com' : host
}

class SessionRecordingProduct implements SessionRecordingExtension {
    readonly name = 'sessionRecording'
    private _client: IPostHog | undefined
    private _recorder: SessionRecorder | undefined
    private _loading: Promise<SessionRecorder | undefined> | undefined
    private _status: SessionRecordingStatus = 'disabled'
    private _disabledLocally: boolean
    private _disposed = false
    private _documentWasEverVisible = hasDocumentEverBeenVisible()
    private _gzipEnabled = true
    // the configuration recording started with on this page: received fresh, or saved and still fresh at setup
    private _trustedConfig: SessionRecordingPersistedConfig | undefined
    private _receivedConfig = false
    private _staleConfig = false
    private _debugPropertiesPaused = false
    // events admitted before the recorder first starts, such as the initial `$pageview`, so they can still match
    // an event trigger once it loads
    private _earlyEvents: CapturedEventInfo[] | undefined = []
    private _subscriptions: Disposable[] = []

    constructor(
        private readonly _options: SessionRecordingOptions,
        private readonly _loadRecorder: () => Promise<typeof import('./recorder')>
    ) {
        this._disabledLocally = _options.disableSessionRecording === true
    }

    setup(client: IPostHog): void {
        this._client = client
        const onVisibilityChange = (): void => {
            if (globalThis.document?.visibilityState === 'visible') this._documentWasEverVisible = true
        }
        try {
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            globalThis.document?.addEventListener('visibilitychange', onVisibilityChange)
            this._subscriptions.push({
                dispose: () => globalThis.document?.removeEventListener('visibilitychange', onVisibilityChange),
            })
        } catch {
            // Without visibility history a held recording is not released on unload.
        }
        this._subscriptions.push(
            analyticsOf(client)!.registerDynamicEventProperties((event) => {
                const optional = !this._debugPropertiesPaused && carriesOptionalDebugProperties(event)
                return {
                    ...(optional && this._staleConfig ? { [STALE_CONFIG]: true } : {}),
                    ...(this._recorder ? this._recorder.debugProperties(optional) : { $recording_status: this.status }),
                }
            }),
            client.onConsentChange(({ current }) => {
                if (current === 'denied') this._recorder?.discard()
                this._startIfEnabledOrStop()
            }),
            client.onReset(() => {
                // reset clears saved extension state; keep recording the next session under this page's configuration
                if (this._trustedConfig) client.kv.set(SESSION_RECORDING_REMOTE_CONFIG, this._trustedConfig)
            }),
            client.onNewSession(() => {
                // keep the saved configuration fresh for later pages while this page keeps receiving activity
                if (!this._receivedConfig || !this._trustedConfig) return
                this._trustedConfig = { ...this._trustedConfig, cache_timestamp: Date.now() }
                client.kv.set(SESSION_RECORDING_REMOTE_CONFIG, this._trustedConfig)
            }),
            client.onRemoteConfig((result) => this._onRemoteConfig(result)),
            client.onEvent((event) => {
                if (this._earlyEvents && this._earlyEvents.length < MAX_EARLY_EVENTS) this._earlyEvents.push(event)
                // the interval starts once an event that carried the optional diagnostics is accepted
                if (!this._debugPropertiesPaused && carriesOptionalDebugProperties(event.event)) {
                    this._debugPropertiesPaused = true
                    setTimeout(() => (this._debugPropertiesPaused = false), DEBUG_PROPERTIES_INTERVAL_MS)
                }
            })
        )
        this._startIfEnabledOrStop()
    }

    get status(): SessionRecordingStatus {
        if (this._status === 'awaiting_config' || this._status === 'missing_config') return this._status
        return this._recorder?.isStarted ? this._recorder.status : this._status
    }

    startSessionRecording(override?: true | SessionRecordingOverride): void {
        const client = this._client
        if (this._disposed || !client) return
        try {
            const requested: SessionRecordingOverride =
                override === true
                    ? { sampling: true, linkedFlag: true, urlTrigger: true, eventTrigger: true }
                    : (override ?? {})
            const overrides: Array<[boolean | undefined, string, () => void]> = [
                [requested.sampling, SESSION_RECORDING_OVERRIDE_SAMPLING, () => this._recorder?.overrideSampling()],
                [
                    requested.linkedFlag,
                    SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
                    () => this._recorder?.overrideLinkedFlag(),
                ],
                [
                    requested.urlTrigger,
                    SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
                    () => this._recorder?.overrideTrigger('url'),
                ],
                [
                    requested.eventTrigger,
                    SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
                    () => this._recorder?.overrideTrigger('event'),
                ],
            ]
            for (const [enabled, key, apply] of overrides) {
                if (!enabled) continue
                // a recorder that is not running yet applies the override when it starts
                if (this._recorder?.isStarted) apply()
                else client.kv.set(key, true)
            }
            this._disabledLocally = false
            this._startIfEnabledOrStop()
        } catch (error) {
            client.logger.error('Session recording could not start', error)
        }
    }

    stopSessionRecording(): void {
        this._disabledLocally = true
        this._status = 'disabled'
        try {
            this._recorder?.stop()
        } catch (error) {
            this._client?.logger.error('Session recording could not stop', error)
        }
    }

    sessionRecordingStarted(): boolean {
        return !!this._recorder?.isStarted
    }

    getSessionReplayUrl(options?: SessionReplayUrlOptions): string {
        const client = this._client
        const session = client?.session
        const apiHost = client && analyticsOf(client)?._core._requestRuntime[0].api
        if (!client || !session || apiHost === undefined) return ''
        let url = `${uiHostFor(apiHost, this._options.uiHost)}/project/${client.projectToken}/replay/${session.sessionId}`
        if (options?.withTimestamp && session.sessionStartTimestamp) {
            const lookBack = options.timestampLookBack ?? 10
            const offset = Math.max(Math.floor((Date.now() - session.sessionStartTimestamp) / 1000) - lookBack, 0)
            url += `?t=${offset}`
        }
        return url
    }

    async flush(): Promise<void> {
        await this._recorder?.flush()
    }

    dispose(): void {
        this._disposed = true
        for (const subscription of this._subscriptions.splice(0)) subscription.dispose()
        this._recorder?.dispose()
        this._recorder = undefined
        this._client = undefined
    }

    private _persistedConfig(): SessionRecordingPersistedConfig | undefined {
        const value = this._client?.kv.get<SessionRecordingPersistedConfig>(SESSION_RECORDING_REMOTE_CONFIG)
        return value && typeof value === 'object' ? value : undefined
    }

    private _isRecordingEnabled(): boolean {
        return (
            !this._disposed &&
            !this._disabledLocally &&
            !!this._client?.canCapture &&
            this._persistedConfig()?.enabled === true &&
            typeof globalThis.window !== 'undefined'
        )
    }

    private _onRemoteConfig(result: DeepReadonly<RemoteConfigResult>): void {
        const client = this._client
        if (!client || this._disposed) return
        if (!result.ok || !('sessionRecording' in result.config)) {
            // no fresh replay configuration arrived, so recording relies on what was persisted
            if (this._status === 'awaiting_config') {
                this._status = 'missing_config'
                this._staleConfig = true
            }
            this._startIfEnabledOrStop()
            return
        }
        this._gzipEnabled = result.config.supportedCompression?.includes('gzip-js') ?? true
        const persisted = toPersistedConfig(result.config, this._options.sampleRate)
        if (persisted.sampleRate === null) {
            client.kv.remove([SESSION_RECORDING_IS_SAMPLED, SESSION_RECORDING_SAMPLE_RATE])
        }
        const previous = this._trustedConfig
        this._trustedConfig = persisted
        this._receivedConfig = true
        client.kv.set(SESSION_RECORDING_REMOTE_CONFIG, persisted)
        if (!persisted.enabled) {
            this._recorder?.discard()
            this._status = 'disabled'
            return
        }
        if (this._status === 'awaiting_config' || this._status === 'missing_config') this._status = 'disabled'
        // a recorder started from a saved configuration restarts so what it records next follows the fresh one
        if (this._recorder?.isStarted && previous && !sameConfig(previous, persisted)) this._recorder.stop()
        this._startIfEnabledOrStop()
    }

    private _startIfEnabledOrStop(startReason?: SessionStartReason): void {
        if (!this._isRecordingEnabled()) {
            if (this._status !== 'missing_config') this._status = 'disabled'
            this._recorder?.stop()
            return
        }
        if (this._recorder?.isStarted) return
        const persisted = this._persistedConfig()
        const cacheTimestamp = persisted?.cache_timestamp
        const fresh =
            Number.isFinite(cacheTimestamp) && Date.now() - (cacheTimestamp as number) <= RECORDING_REMOTE_CONFIG_TTL_MS
        // once trusted on this page, a configuration stays trusted until reload, as in posthog-js
        if (fresh) this._trustedConfig ??= persisted
        else if (!this._trustedConfig) {
            // a stale configuration may carry outdated triggers or sampling, so wait for a fresh one
            if (this._status !== 'missing_config') this._status = 'awaiting_config'
            return
        }
        this._status = 'lazy_loading'
        void this._ensureRecorder().then((recorder) => {
            if (!recorder || !this._isRecordingEnabled() || recorder.isStarted) return
            try {
                recorder.start(startReason)
            } catch (error) {
                this._client?.logger.error('Session recording could not start', error)
            }
        })
    }

    private _ensureRecorder(): Promise<SessionRecorder | undefined> {
        if (this._recorder) return Promise.resolve(this._recorder)
        this._loading ??= this._loadRecorder()
            .then(({ createSessionRecorder }) => {
                const client = this._client
                if (this._disposed || !client) return undefined
                this._recorder ??= createSessionRecorder({
                    client,
                    options: this._options,
                    remoteConfig: () => this._persistedConfig() ?? this._trustedConfig,
                    gzipEnabled: () => this._gzipEnabled,
                    documentWasEverVisible: () => this._documentWasEverVisible,
                    takeEarlyEvents: () => {
                        const events = this._earlyEvents ?? []
                        this._earlyEvents = undefined
                        return events
                    },
                })
                return this._recorder
            })
            .catch((error: unknown) => {
                this._loading = undefined
                this._status = 'disabled'
                // most often an ad blocker; make it visible on the session's events
                this._client?.registerForSession({ [RECORDING_SCRIPT_NOT_LOADED]: true })
                this._client?.logger.error('Session recording could not load the recorder', error)
                return undefined
            })
        return this._loading
    }
}

/** Create the session recording product. The recorder and rrweb load only when recording starts. */
export const createSessionRecording = (
    options: SessionRecordingOptions,
    loadRecorder: () => Promise<typeof import('./recorder')>
): SessionRecordingExtension => new SessionRecordingProduct(snapshotSessionRecordingOptions(options), loadRecorder)

/** Include session recording statically instead of loading the product at initialization. */
export const sessionRecording = (options: SessionRecordingOptions = {}): SessionRecordingExtension =>
    createSessionRecording(options, () => import('./recorder'))
