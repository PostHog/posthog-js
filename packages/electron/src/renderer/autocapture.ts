import {
    Autocapture,
    type AutocaptureClient,
    type AutocaptureRemoteConfigResult,
} from '@posthog/browser-common/autocapture'
import type { AutocaptureConfig as SharedAutocaptureConfig } from '@posthog/browser-common/autocapture-config'
import type { KeyValueStore } from '@posthog/browser-common'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '@posthog/browser-common/constants'
import type { Properties, State } from '../shared/protocol'

const AUTOCAPTURE_CONFIG_KEYS = [
    'maskAllText',
    'maskAllElementAttributes',
    'disableCaptureUrlHashes',
    'url_allowlist',
    'url_ignorelist',
    'dom_event_allowlist',
    'element_allowlist',
    'css_selector_allowlist',
    'css_selector_ignorelist',
    'element_attribute_ignorelist',
] as const

export type AutocaptureConfig = Partial<Pick<SharedAutocaptureConfig, (typeof AUTOCAPTURE_CONFIG_KEYS)[number]>>

interface AutocaptureHost {
    getState(): Pick<State, 'generation' | 'distinctId' | 'optedOut' | 'autocapture'>
    capture(event: string, properties?: Properties): Promise<void>
    loadConfig(): Promise<void>
    onError(error: unknown): void
}

/** Volatile extension state only; main owns the durable project config cache. */
class AutocaptureStore implements KeyValueStore {
    private values = new Map<string, unknown>()
    initialize(): void {}
    get<T extends object>(keys: readonly (keyof T & string)[]): Partial<T>
    get<T = unknown>(key: string): T | undefined
    get(key: string | readonly string[]): unknown {
        if (typeof key === 'string') return this.values.get(key)
        return Object.fromEntries(
            key.filter((name) => this.values.has(name)).map((name) => [name, this.values.get(name)])
        )
    }
    set(key: string, value: unknown): void
    set(values: Record<string, unknown>): void
    set(key: string | Record<string, unknown>, value?: unknown): void {
        if (typeof key === 'string') this.values.set(key, value)
        else for (const [name, item] of Object.entries(key)) this.values.set(name, item)
    }
    remove(keys: string | readonly string[]): void {
        for (const key of typeof keys === 'string' ? [keys] : keys) this.values.delete(key)
    }
}

export class RendererAutocapture {
    private extension?: Autocapture
    private remoteListener?: (result: AutocaptureRemoteConfigResult) => void
    private generation?: number
    private requestedGeneration?: number
    private disposed = false
    private active = false
    private loading = false
    private retryTimer?: ReturnType<typeof setTimeout>
    private retryDelay = 1000

    constructor(
        private host: AutocaptureHost,
        private config: AutocaptureConfig
    ) {}

    update(paused: boolean): void {
        if (this.disposed) return
        const state = this.host.getState()
        if (paused || state.optedOut || state.generation !== this.generation) this.stop()
        if (paused || state.optedOut) return
        this.active = true
        this.generation = state.generation
        if (!this.extension) {
            const kv = new AutocaptureStore()
            if (typeof state.autocapture?.autocapture_opt_out === 'boolean') {
                kv.set(AUTOCAPTURE_DISABLED_SERVER_SIDE, state.autocapture.autocapture_opt_out)
            }
            const extension = new Autocapture({
                refresh: (config) => {
                    for (const key of AUTOCAPTURE_CONFIG_KEYS) {
                        if (this.config[key] !== undefined) Object.assign(config, { [key]: this.config[key] })
                    }
                    // This runs before shared Autocapture reads or serializes an event target.
                    const current = this.host.getState()
                    config.enabled = !this.disposed && !current.optedOut && current.autocapture?.status !== 'pending'
                    config.remoteRequestsDisabled = current.autocapture?.status === 'disabled'
                },
            })
            this.extension = extension
            const host = this.host
            const adapter: AutocaptureClient = {
                get distinctId() {
                    return host.getState().distinctId
                },
                kv,
                onRemoteConfig: (listener) => {
                    this.remoteListener = listener
                    return {
                        dispose: () => {
                            this.remoteListener = undefined
                        },
                    }
                },
                capture: (event, properties) => {
                    void host.capture(event, properties ?? undefined).catch((error) => host.onError(error))
                    return true
                },
            }
            try {
                extension.setup(adapter)
            } catch (error) {
                this.stop()
                host.onError(error)
                return
            }
        }
        const remote = state.autocapture
        if (remote?.status === 'loaded' || remote?.status === 'failed') {
            this.remoteListener?.(remote.status === 'loaded' ? { ok: true, config: remote } : { ok: false })
        }
        if (remote?.status === 'disabled') this.extension?.startIfEnabled()
        if (remote?.status === 'loaded' || remote?.status === 'disabled') {
            clearTimeout(this.retryTimer)
            this.retryTimer = undefined
            this.retryDelay = 1000
        }
        if (this.requestedGeneration !== state.generation && remote?.status !== 'disabled') this.loadConfig()
        else if (remote?.status === 'failed') this.scheduleRetry()
    }

    private loadConfig(): void {
        if (this.disposed || !this.active || this.loading) return
        this.loading = true
        this.requestedGeneration = this.host.getState().generation
        void this.host
            .loadConfig()
            .catch((error) => this.host.onError(error))
            .finally(() => {
                this.loading = false
                if (this.disposed || !this.active) return
                if (this.requestedGeneration !== this.host.getState().generation) this.update(false)
                else this.scheduleRetry()
            })
    }

    private scheduleRetry(): void {
        const status = this.host.getState().autocapture?.status
        if (
            this.disposed ||
            !this.active ||
            this.loading ||
            this.retryTimer ||
            status === 'loaded' ||
            status === 'disabled'
        )
            return
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined
            this.loadConfig()
        }, this.retryDelay)
        this.retryDelay = Math.min(this.retryDelay * 2, 60_000)
    }

    private stop(): void {
        this.active = false
        clearTimeout(this.retryTimer)
        this.retryTimer = undefined
        this.retryDelay = 1000
        this.requestedGeneration = undefined
        this.extension?.dispose()
        this.extension = undefined
        this.remoteListener = undefined
    }

    dispose(): void {
        this.disposed = true
        this.stop()
    }
}
