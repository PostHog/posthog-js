import { app, session } from 'electron'
import { release } from 'node:os'
import {
    PostHogCore,
    PostHogPersistedProperty,
    isPostHogFetchNetworkError,
    type PostHogCoreOptions,
    type PostHogEventProperties,
    type PostHogFetchOptions,
    type PostHogFetchResponse,
    type PostHogCaptureOptions,
    type GetFlagsResult,
} from '@posthog/core'
import { version } from '../version'
import { ElectronStorage } from './storage'
import { isRecord } from '../shared/protocol'

class RetryLaterError extends Error {}

export class ElectronCore extends PostHogCore {
    private _stopped = false
    private _suspended = false
    private _identityEpoch = 0
    private _controllers = new Set<AbortController>()
    private _retryAt = 0
    private _failures = 0
    private _initialization: Promise<void>
    private _eventContext: PostHogEventProperties = {}
    private _appBuild?: string
    private _maxQueueAgeMs: number
    private _flagsResponseTimeoutMs: number

    constructor(
        token: string,
        options: PostHogCoreOptions & { appBuild?: string; maxQueueAgeMs?: number },
        private _storage: ElectronStorage,
        private _notify: () => void,
        private _report: (error: unknown) => void
    ) {
        super(token, { ...options, flushInterval: 0, disableSurveys: true })
        this._appBuild = options.appBuild
        this._maxQueueAgeMs = options.maxQueueAgeMs ?? 7 * 24 * 60 * 60 * 1000
        this._flagsResponseTimeoutMs = options.featureFlagsRequestTimeoutMs ?? 10000
        this._isInitialized = false
        this._initialization = this._initPromise = this._storage.load().then(() => {
            if (this._stopped) return
            if (!this._storage.isOwned) {
                this.disabled = true
                return
            }
            this._isInitialized = true
            this.setupBootstrap(options)
            this.resetSessionId()
            this.getDistinctId()
            this.getSessionId()
        })
        this.on('error', this._report)
    }

    ready(): Promise<void> {
        return this._initialization
    }

    canIdentify(): boolean {
        return !this.isDisabled && this._personProfiles !== 'never'
    }

    getPersistedProperty<T>(key: PostHogPersistedProperty): T | undefined {
        return this._storage.get<T>(key)
    }

    setPersistedProperty<T>(key: PostHogPersistedProperty, value: T | null): void {
        if (this._stopped || key === PostHogPersistedProperty.SessionReplay) return
        this._storage.set(key, value)
        if (
            this._isInitialized &&
            key !== PostHogPersistedProperty.Queue &&
            key !== PostHogPersistedProperty.SessionLastTimestamp
        ) {
            this._notify()
        }
    }

    capture(event: string, properties?: PostHogEventProperties, options?: PostHogCaptureOptions): void {
        if (this.optedOut || this._stopped) return
        super.capture(event, properties, options)
    }

    group(...args: Parameters<PostHogCore['group']>): void {
        if (this.optedOut || this._stopped) return
        super.group(...args)
    }

    protected async getFlagsForContext(
        ...args: Parameters<PostHogCore['getFlagsForContext']>
    ): Promise<GetFlagsResult> {
        const epoch = this._identityEpoch
        const result = await super.getFlagsForContext(...args)
        if (this._stopped || epoch !== this._identityEpoch) {
            return { success: false, error: { type: 'connection_error' } }
        }
        return result
    }

    getLibraryId(): string {
        return 'posthog-electron'
    }
    getLibraryVersion(): string {
        return version
    }
    getCustomUserAgent(): string {
        return `posthog-electron/${version}`
    }
    protected getEvaluationRuntime(): 'client' {
        return 'client'
    }

    protected getCommonEventProperties(): PostHogEventProperties {
        return {
            ...super.getCommonEventProperties(),
            $electron_process: 'main',
            $app_name: app.getName(),
            $app_version: app.getVersion(),
            $os_name: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux',
            $os_version: release(),
            $device_type: 'Desktop',
            ...(this._appBuild ? { $app_build: this._appBuild } : {}),
            ...this._eventContext,
        }
    }

    withContext<T>(context: PostHogEventProperties, operation: () => T): T {
        const previous = this._eventContext
        this._eventContext = context
        try {
            return operation()
        } finally {
            this._eventContext = previous
        }
    }

    invalidateIdentity(): void {
        this._identityEpoch++
        for (const key of [
            PostHogPersistedProperty.FeatureFlagDetails,
            PostHogPersistedProperty.BootstrapFeatureFlagDetails,
            PostHogPersistedProperty.FeatureFlags,
            PostHogPersistedProperty.FeatureFlagPayloads,
            PostHogPersistedProperty.FlagsEndpointWasHit,
        ])
            this.setPersistedProperty(key, null)
    }

    async fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
        if (this._stopped || !this._storage.isOwned || this._suspended) throw new Error('PostHog delivery is inactive')
        const target = new URL(url)
        const host = new URL(this.host)
        if (target.origin !== host.origin || !target.pathname.startsWith(host.pathname.replace(/\/$/, '') + '/')) {
            throw new Error('PostHog request outside configured host')
        }
        const flagsRequest = target.pathname.endsWith('/flags/') || target.pathname.endsWith('/flags')
        const epoch = this._identityEpoch
        const started = Date.now()
        const controller = new AbortController()
        let responseTimer: ReturnType<typeof setTimeout> | undefined
        const abort = (): void => controller.abort(options.signal?.reason)
        options.signal?.addEventListener('abort', abort, { once: true })
        if (options.signal?.aborted) abort()
        this._controllers.add(controller)
        const cleanup = (): void => {
            clearTimeout(responseTimer)
            options.signal?.removeEventListener('abort', abort)
            controller.signal.removeEventListener('abort', cleanup)
            this._controllers.delete(controller)
        }
        controller.signal.addEventListener('abort', cleanup, { once: true })
        try {
            await app.whenReady()
            if (this._stopped || controller.signal.aborted) throw new Error('PostHog request cancelled')
            const response = await session.fromPartition('posthog-electron').fetch(url, {
                method: options.method,
                headers: options.headers,
                body: options.body,
                signal: controller.signal,
                credentials: 'omit',
                redirect: 'error',
            })
            if (!response.body) cleanup()
            else if (response.status < 200 || response.status >= 300) {
                // Core permits lazy diagnostics until this attempt's deadline, not until shutdown.
                const timeout = flagsRequest ? this._flagsResponseTimeoutMs : this.requestTimeout
                responseTimer = setTimeout(
                    () => {
                        controller.abort(new Error('PostHog error response body deadline exceeded'))
                        void response.body?.cancel().catch(() => {})
                        cleanup()
                    },
                    Math.max(0, timeout - (Date.now() - started)) + 1
                )
                responseTimer.unref()
            }
            return {
                status: response.status,
                headers: response.headers,
                body: response.body
                    ? new ReadableStream({
                          cancel: async (reason) => {
                              try {
                                  await response.body?.cancel(reason)
                              } finally {
                                  cleanup()
                              }
                          },
                      })
                    : null,
                text: async () => {
                    try {
                        return await response.text()
                    } finally {
                        cleanup()
                    }
                },
                json: async () => {
                    try {
                        const value: unknown = await response.json()
                        if (this._stopped || (flagsRequest && epoch !== this._identityEpoch)) {
                            throw new Error('Discarded stale PostHog response')
                        }
                        return value
                    } finally {
                        cleanup()
                    }
                },
            }
        } catch (error) {
            cleanup()
            throw error
        }
    }

    protected shouldRetainBatchOnError(error: unknown): boolean {
        if (error instanceof RetryLaterError) return true
        const status = isRecord(error) ? error.status : undefined
        return (
            isPostHogFetchNetworkError(error) ||
            status === 407 ||
            status === 408 ||
            status === 429 ||
            (typeof status === 'number' && status >= 500)
        )
    }

    protected async sendBatch(...args: Parameters<PostHogCore['sendBatch']>): Promise<void> {
        if (this._stopped || this._suspended || !this._storage.isOwned || Date.now() < this._retryAt)
            throw new RetryLaterError('PostHog delivery paused')
        try {
            await this._storage.flush()
        } catch (error) {
            throw new RetryLaterError('PostHog storage write failed', { cause: error })
        }
        if (this._stopped || this._suspended) throw new RetryLaterError('PostHog delivery paused')
        try {
            const cutoff = Date.now() - this._maxQueueAgeMs
            const eligible = args[0].filter((message) => {
                const timestamp = message?.timestamp
                return (
                    (typeof timestamp === 'string' || timestamp instanceof Date) &&
                    new Date(timestamp).getTime() >= cutoff
                )
            })
            if (eligible.length) await super.sendBatch(eligible, args[1], args[2])
            this._failures = 0
            this._retryAt = 0
        } catch (error) {
            if (this.shouldRetainBatchOnError(error)) {
                this._failures++
                const retryAfter = isRecord(error) && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : 0
                const delay = Math.min(60_000, 1000 * 2 ** Math.min(this._failures, 6)) * (0.5 + Math.random() * 0.5)
                this._retryAt = Date.now() + Math.max(retryAfter, delay)
            }
            throw error
        }
    }

    protected flushStorage(): Promise<void> {
        return this._storage.flush()
    }
    persist(): Promise<void> {
        return this._storage.flush()
    }

    suspend(): void {
        this._suspended = true
        for (const controller of this._controllers) controller.abort()
    }

    resume(): void {
        this._suspended = false
    }

    stop(): Promise<void> {
        this._stopped = true
        this.disabled = true
        clearTimeout(this._flushTimer)
        for (const controller of this._controllers) controller.abort()
        this._controllers.clear()
        return this._storage.stop()
    }
}
