import { app, powerMonitor, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { PostHogPersistedProperty, type PostHogCoreOptions, type FeatureFlagValue, type JsonType } from '@posthog/core'
import { ElectronCore } from './client'
import { ElectronStorage } from './storage'
import {
    COMMAND_CHANNEL,
    STATE_CHANNEL,
    validateRequest,
    trustedUrl,
    type Command,
    type Properties,
    type Response,
    type State,
} from '../shared/protocol'

export type { State, Properties, FeatureFlagValue, JsonType }

export interface PostHogOptions extends Pick<
    PostHogCoreOptions,
    | 'host'
    | 'flushAt'
    | 'flushInterval'
    | 'maxBatchSize'
    | 'maxQueueSize'
    | 'requestTimeout'
    | 'fetchRetryCount'
    | 'fetchRetryDelay'
    | 'preloadFeatureFlags'
    | 'disableRemoteFeatureFlags'
    | 'defaultOptIn'
    | 'disabled'
    | 'bootstrap'
    | 'before_send'
    | 'personProfiles'
    | 'sessionExpirationTimeSeconds'
    | 'disableGeoip'
    | 'disableCompression'
    | 'featureFlagsRequestTimeoutMs'
    | 'featureFlagsRequestMaxRetries'
> {
    projectToken: string
    storageDirectory?: string
    maxStorageBytes?: number
    maxQueueAgeMs?: number
    captureAppLifecycleEvents?: boolean
    appBuild?: string
    onError?: (error: unknown) => void
}

interface RegisteredWindow {
    contents: WebContents
    allowedUrls: readonly string[]
    sequence: number
    frame: number | undefined
    requests: number
    period: number
    dispose: () => void
}

let singleton: PostHog | undefined
let singletonOptions: Pick<PostHogOptions, 'projectToken' | 'host'> | undefined

export class PostHog {
    private _core: ElectronCore
    private _ready: Promise<void>
    private _windows = new Map<number, RegisteredWindow>()
    private _revision = 0
    private _generation = 0
    private _closed = false
    private _closing = false
    private _shutdownPromise?: Promise<void>
    private _notifyPending = false
    private _lastPublished = ''
    private _flagRevision = 0
    private _lastFlags = ''
    private _focusTimer?: ReturnType<typeof setTimeout>
    private _timer?: ReturnType<typeof setInterval>
    private _foreground = false
    private _cancelReady!: () => void
    private _cleanups: (() => void)[] = []
    private _tail: Promise<unknown> = Promise.resolve()

    constructor(private _options: PostHogOptions) {
        if (singleton) throw new Error('PostHog Electron is already initialized; use init()')
        if (!this._options.projectToken?.trim()) throw new Error('PostHog projectToken is required')
        const host = new URL(this._options.host ?? 'https://us.i.posthog.com')
        if (
            !['http:', 'https:'].includes(host.protocol) ||
            host.username ||
            host.password ||
            host.search ||
            host.hash
        ) {
            throw new Error('PostHog host must be an HTTP(S) URL without credentials, query or fragment')
        }
        const namespace = createHash('sha256')
            .update(this._options.projectToken.trim() + host.href)
            .digest('hex')
            .slice(0, 24)
        const directory = join(this._options.storageDirectory ?? join(app.getPath('userData'), 'posthog'), namespace)
        const storage = new ElectronStorage(directory, {
            maxStorageBytes: this._options.maxStorageBytes,
            maxQueueAgeMs: this._options.maxQueueAgeMs,
            onError: (error) => this._report(error),
        })
        this._core = new ElectronCore(
            this._options.projectToken,
            { ...this._options, host: host.href },
            storage,
            () => this._scheduleState(),
            (error) => this._report(error)
        )
        const exit = (): void => storage.releaseOnExit()
        process.once('exit', exit)
        this._cleanups.push(() => process.removeListener('exit', exit))
        singleton = this
        singletonOptions = { projectToken: this._options.projectToken, host: this._options.host }
        ipcMain.handle(COMMAND_CHANNEL, (event, request: unknown) => this._handle(event, request))
        this._ready = Promise.race([
            this._initialize(),
            new Promise<void>((resolve) => {
                this._cancelReady = resolve
            }),
        ])
    }

    private _report(error: unknown): void {
        try {
            this._options.onError?.(error)
        } catch {}
    }

    private async _initialize(): Promise<void> {
        await this._core.ready()
        if (this._closing || this._core.isDisabled) return
        await app.whenReady()
        if (this._closing) return
        if (!this._core.isDisabled && this._options.captureAppLifecycleEvents !== false) {
            const previous = this._core.getPersistedProperty<string>(PostHogPersistedProperty.InstalledAppVersion)
            const previousBuild = this._core.getPersistedProperty<string>(PostHogPersistedProperty.InstalledAppBuild)
            const version = app.getVersion()
            const build = this._options.appBuild
            const properties = {
                $electron_version: process.versions.electron,
                $node_version: process.versions.node,
                $chromium_version: process.versions.chrome,
                ...(build ? { $app_build: build } : {}),
            }
            if (!previous) this._core.capture('Application Installed', properties)
            else if (previous !== version || previousBuild !== build)
                this._core.capture('Application Updated', {
                    ...properties,
                    previous_version: previous,
                    ...(previousBuild ? { previous_build: previousBuild } : {}),
                })
            this._core.setPersistedProperty(PostHogPersistedProperty.InstalledAppVersion, version)
            this._core.setPersistedProperty(PostHogPersistedProperty.InstalledAppBuild, build ?? null)
            this._core.capture('Application Opened', { from_background: false })
            this._foreground = true
        }
        const interval = this._options.flushInterval ?? 10_000
        if (interval > 0) {
            this._timer = setInterval(() => {
                if (!this._closing) void this._core.flush().catch((error) => this._report(error))
            }, interval)
            this._timer.unref()
        }
        const suspend = (): void => this._core.suspend()
        const resume = (): void => {
            this._core.resume()
            if (!this._closing) void this.flush().catch((error) => this._report(error))
        }
        powerMonitor.on('suspend', suspend)
        powerMonitor.on('resume', resume)
        this._cleanups.push(() => {
            powerMonitor.removeListener('suspend', suspend)
            powerMonitor.removeListener('resume', resume)
        })
        const quit = (event: Electron.Event): void => {
            if (this._closed || event.defaultPrevented) return
            // Observe cancellation by other will-quit listeners too. Do not force a second quit.
            queueMicrotask(() => {
                if (event.defaultPrevented) return
                void this.flush().catch((error) => this._report(error))
            })
        }
        app.on('will-quit', quit)
        this._cleanups.push(() => app.removeListener('will-quit', quit))
        if (this._core.preloadFeatureFlags && !this._core.isDisabled) {
            void this._core.reloadFeatureFlagsAsync().catch((error) => this._report(error))
        }
        await this._core.persist()
        this._scheduleState()
    }

    ready(): Promise<void> {
        return this._ready
    }

    private async _run(
        operation: () => void | Promise<unknown>,
        generation?: number,
        authorize?: () => void
    ): Promise<void> {
        if (this._closing) throw new Error('PostHog is shut down')
        const pending = this._tail.then(async () => {
            await this._ready
            if (this._closed) throw new Error('PostHog is shut down')
            if (generation !== undefined && generation !== this._generation) throw new Error('Stale PostHog identity')
            authorize?.()
            await operation()
            await this._core.persist()
            this._scheduleState()
        })
        this._tail = pending.catch(() => {})
        return pending
    }

    capture(event: string, properties?: Properties): Promise<void> {
        if (!event.trim() || event === '$snapshot') return Promise.resolve()
        return this._run(() => this._core.capture(event, properties))
    }
    identify(distinctId: string, properties?: Properties): Promise<void> {
        if (!distinctId?.trim()) return Promise.resolve()
        return this._run(() => this._identify(distinctId, properties))
    }
    private _identify(distinctId: string, properties?: Properties): void {
        if (!this._core.canIdentify()) {
            this._core.identify(distinctId, properties)
            return
        }
        if (distinctId !== this._core.getDistinctId()) {
            this._generation++
            this._core.invalidateIdentity()
        }
        this._core.identify(distinctId, properties)
    }
    reset(): Promise<void> {
        return this._run(() => this._reset())
    }
    private _reset(): void {
        this._generation++
        this._core.invalidateIdentity()
        const optedOut = this._core.optedOut
        this._core.reset([
            PostHogPersistedProperty.OptedOut,
            PostHogPersistedProperty.InstalledAppVersion,
            PostHogPersistedProperty.InstalledAppBuild,
        ])
        this._core.setPersistedProperty(PostHogPersistedProperty.OptedOut, optedOut)
        this._core.getDistinctId()
        this._core.getSessionId()
    }
    group(type: string, key: string | number, properties?: Properties): Promise<void> {
        return this._run(() => this._core.group(type, key, properties))
    }
    register(properties: Properties): Promise<void> {
        return this._run(() => this._core.register(properties))
    }
    unregister(key: string): Promise<void> {
        return this._run(() => this._core.unregister(key))
    }
    optIn(): Promise<void> {
        return this._run(() => this._core.optIn())
    }
    optOut(): Promise<void> {
        return this._run(() => this._optOut())
    }
    private async _optOut(): Promise<void> {
        this._generation++
        await this._core.optOut()
    }
    captureException(error: unknown, properties?: Properties): Promise<void> {
        return this._run(() => {
            if (this._core.optedOut || this._core.isDisabled) return
            try {
                const exception = this._core.getErrorPropertiesBuilder().buildFromUnknown(error)
                this._core.capture('$exception', { ...properties, ...exception } as unknown as Properties, {
                    _originatedFromCaptureException: true,
                })
            } catch (captureError) {
                this._report(captureError)
            }
        })
    }
    getDistinctId(): string {
        return this._core.getDistinctId()
    }
    getSessionId(): string {
        return this._core.isDisabled ? '' : this._core.getSessionId()
    }
    getFeatureFlag(key: string): FeatureFlagValue | undefined {
        return this._core.getFeatureFlag(key)
    }
    getFeatureFlagPayload(key: string): JsonType | undefined {
        return this._core.getFeatureFlagPayload(key)
    }
    get optedOut(): boolean {
        return this._core.optedOut
    }
    async reloadFeatureFlagsAsync(): Promise<void> {
        await this._ready
        if (this._closing) return
        await this._core.reloadFeatureFlagsAsync()
        await this._core.persist()
        this._scheduleState()
    }
    async flush(): Promise<void> {
        await this._ready
        await this._tail
        if (this._closed) return
        await this._core.flush()
        await this._core.persist()
    }

    getState(): State {
        const details = this._core.getFeatureFlagDetails()
        const flags = details?.featureFlags ?? {}
        const payloads: Record<string, JsonType> = Object.create(null)
        for (const key of Object.keys(flags)) {
            payloads[key] =
                details && Object.prototype.hasOwnProperty.call(details.featureFlagPayloads, key)
                    ? (details.featureFlagPayloads[key] ?? null)
                    : null
        }
        return structuredClone({
            revision: this._revision,
            generation: this._generation,
            distinctId: this._core.getDistinctId(),
            anonymousId: this._core.getAnonymousId(),
            sessionId: this._core.getPersistedProperty<string>(PostHogPersistedProperty.SessionId) ?? '',
            optedOut: this._core.optedOut,
            featureFlags: flags,
            flagsLoaded: details !== undefined,
            flagRevision: this._flagRevision,
            featureFlagPayloads: payloads,
        })
    }

    private _scheduleState(): void {
        if (this._notifyPending || this._closed) return
        this._notifyPending = true
        queueMicrotask(() => {
            this._notifyPending = false
            if (this._closed) return
            const flags = JSON.stringify([
                this._core.getPersistedProperty(PostHogPersistedProperty.FeatureFlagDetails),
                this._core.getPersistedProperty(PostHogPersistedProperty.FlagsEndpointWasHit),
            ])
            if (flags !== this._lastFlags) {
                this._lastFlags = flags
                this._flagRevision++
            }
            const state = this.getState()
            const serialized = JSON.stringify({ ...state, revision: 0 })
            if (serialized === this._lastPublished) return
            this._lastPublished = serialized
            state.revision = ++this._revision
            for (const registered of this._windows.values()) {
                if (
                    !registered.contents.isDestroyed() &&
                    registered.frame !== undefined &&
                    trustedUrl(registered.contents.getURL(), registered.allowedUrls)
                ) {
                    registered.contents.mainFrame.send(STATE_CHANNEL, state)
                }
            }
        })
    }

    registerWindow(window: BrowserWindow, options: { allowedUrls: readonly string[] }): () => void {
        if (!options.allowedUrls.length || options.allowedUrls.some((url) => !trustedUrl(url, [url]))) {
            throw new Error('PostHog requires explicit trusted window URLs')
        }
        const contents = window.webContents
        this._windows.get(contents.id)?.dispose()
        const registration: RegisteredWindow = {
            contents,
            allowedUrls: [...options.allowedUrls],
            sequence: 0,
            frame: undefined,
            requests: 0,
            period: performance.now(),
            dispose: () => {},
        }
        const navigation = (): void => {
            registration.sequence = 0
            registration.frame = undefined
        }
        const focus = (): void => {
            clearTimeout(this._focusTimer)
            this._updateFocus()
        }
        const blur = (): void => {
            clearTimeout(this._focusTimer)
            this._focusTimer = setTimeout(() => this._updateFocus(), 50)
            this._focusTimer.unref()
        }
        const dispose = (): void => {
            contents.removeListener('did-navigate', navigation)
            contents.removeListener('destroyed', dispose)
            window.removeListener('focus', focus)
            window.removeListener('blur', blur)
            this._windows.delete(contents.id)
            this._updateFocus()
        }
        registration.dispose = dispose
        contents.on('did-navigate', navigation)
        contents.once('destroyed', dispose)
        window.on('focus', focus)
        window.on('blur', blur)
        this._windows.set(contents.id, registration)
        return dispose
    }

    private _updateFocus(): void {
        if (this._closing || this._options.captureAppLifecycleEvents === false) return
        const active = [...this._windows.values()].some(
            ({ contents }) => !contents.isDestroyed() && contents.isFocused()
        )
        if (this._foreground === active) return
        const previous = this._foreground
        this._foreground = active
        if (active) {
            if (previous === false)
                void this.capture('Application Opened', { from_background: true }).catch((error) => this._report(error))
        } else void this.capture('Application Backgrounded').catch((error) => this._report(error))
    }

    private async _handle(event: IpcMainInvokeEvent, value: unknown): Promise<Response> {
        try {
            const registered = this._windows.get(event.sender.id)
            if (
                !registered ||
                !event.senderFrame ||
                event.senderFrame !== event.sender.mainFrame ||
                !trustedUrl(event.senderFrame.url, registered.allowedUrls)
            )
                throw new Error('Unauthorized PostHog sender')
            if (performance.now() - registered.period >= 1000) {
                registered.period = performance.now()
                registered.requests = 0
            }
            if (++registered.requests > 100) throw new Error('PostHog renderer rate limit exceeded')
            validateRequest(value)
            if (value.command.type === 'hello') {
                if (registered.frame === event.senderFrame.routingId && value.sequence <= registered.sequence)
                    throw new Error('Duplicate PostHog request')
                registered.frame = event.senderFrame.routingId
            } else if (registered.frame !== event.senderFrame.routingId) throw new Error('PostHog handshake required')
            if (value.sequence <= registered.sequence) throw new Error('Out-of-order PostHog request')
            registered.sequence = value.sequence
            await this._ready
            if (this._closing) throw new Error('PostHog is shut down')
            const command = value.command
            if (
                command.type !== 'hello' &&
                command.type !== 'flush' &&
                command.type !== 'optOut' &&
                value.generation !== this._generation
            ) {
                throw new Error('Stale PostHog identity; synchronize before capturing')
            }
            const context: Properties = { $electron_process: 'renderer', $window_id: String(event.sender.id) }
            const authorize = (): void => {
                if (
                    this._windows.get(event.sender.id) !== registered ||
                    registered.frame !== event.senderFrame?.routingId ||
                    !trustedUrl(event.sender.getURL(), registered.allowedUrls)
                )
                    throw new Error('PostHog sender navigated or disconnected')
            }
            authorize()
            await this._execute(command, context, value.generation, authorize)
            return { ok: true, state: this.getState() }
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'PostHog request failed' }
        }
    }

    private async _execute(
        command: Command,
        context: Properties,
        generation: number,
        authorize: () => void
    ): Promise<void> {
        if (command.type === 'hello') return
        if (command.type === 'flush') return this.flush()
        if (command.type === 'reloadFeatureFlags') return this.reloadFeatureFlagsAsync()
        return this._run(
            () =>
                this._core.withContext(context, () => {
                    switch (command.type) {
                        case 'capture':
                            return this._core.capture(command.event, { ...command.properties, ...context })
                        case 'identify':
                            return this._identify(command.distinctId, command.properties)
                        case 'reset':
                            return this._reset()
                        case 'group':
                            return this._core.group(command.groupType, command.groupKey, command.properties)
                        case 'register':
                            return this._core.register(command.properties)
                        case 'unregister':
                            return this._core.unregister(command.key)
                        case 'optIn':
                            return this._core.optIn()
                        case 'optOut':
                            return this._optOut()
                        case 'flag': {
                            if (
                                command.flagRevision === this._flagRevision &&
                                this._core.getFeatureFlag(command.key, { sendEvent: false }) ===
                                    (command.value ?? undefined)
                            ) {
                                this._core.getFeatureFlag(command.key)
                            }
                            return
                        }
                        case 'exception':
                            return this._core.capture(
                                '$exception',
                                { ...command.properties, ...context },
                                { _originatedFromCaptureException: true }
                            )
                    }
                }),
            command.type === 'optOut' ? undefined : generation,
            authorize
        )
    }

    shutdown(timeoutMs = 2000): Promise<void> {
        if (this._shutdownPromise) return this._shutdownPromise
        this._closing = true
        clearInterval(this._timer)
        clearTimeout(this._focusTimer)
        let timer: ReturnType<typeof setTimeout> | undefined
        let cleanupPromise: Promise<void> | undefined
        const cleanup = (): Promise<void> => {
            if (cleanupPromise) return cleanupPromise
            this._closed = true
            this._cancelReady()
            const stopped = this._core.stop()
            ipcMain.removeHandler(COMMAND_CHANNEL)
            for (const cleanup of this._cleanups) cleanup()
            for (const registration of this._windows.values()) registration.dispose()
            if (singleton === this) singleton = undefined
            return (cleanupPromise = stopped)
        }
        const drain = async (): Promise<void> => {
            await this._ready
            if (this._closed) return
            await this._tail
            if (this._closed) return
            await this._core.shutdown(timeoutMs)
            if (!this._closed) await this._core.persist()
            await cleanup()
        }
        this._shutdownPromise = Promise.race([
            drain().catch(async (error) => {
                this._report(error)
                await cleanup()
            }),
            new Promise<void>((resolve) => {
                timer = setTimeout(
                    () => {
                        this._report(new Error('PostHog shutdown timed out; unsent events remain in storage'))
                        resolve()
                    },
                    Math.max(0, timeoutMs)
                )
            }),
        ]).finally(() => {
            clearTimeout(timer)
            // Filesystem work cannot be cancelled safely. Keep ownership until it settles,
            // without extending the caller's shutdown budget.
            void cleanup().catch((error) => this._report(error))
        })
        return this._shutdownPromise
    }
}

export function init(options: PostHogOptions): PostHog {
    if (singleton) {
        if (singletonOptions?.projectToken !== options.projectToken || singletonOptions?.host !== options.host) {
            throw new Error('PostHog Electron is already initialized for a different project')
        }
        return singleton
    }
    return new PostHog(options)
}
