import type {
    AnalyticsConfiguration,
    AnalyticsOptions,
    AutomaticAnalyticsOptions,
    LoadStrategy,
} from './analytics-options'

import type {
    ApiResponse,
    CaptureOptions,
    Client,
    Disposable,
    Extension,
    ExtensionToken,
    Listener,
    RemoteConfig,
    SendRequestInit,
    SessionContext,
} from '@posthog/browser-common'

export interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
    /** Observe external changes when the adapter can provide prompt notification. */
    subscribe?(key: string, listener: () => void): Disposable
}

export interface BrowserNavigator {
    readonly userAgent?: string
    readonly webdriver?: boolean
    readonly onLine?: boolean
    sendBeacon?(url: string, data?: BodyInit | null): boolean
}

export type BrowserFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type NewSessionReason = 'idleTimeout' | 'maxLength' | 'reset'

export interface NewSessionInfo extends SessionContext {
    readonly reason: NewSessionReason
}

export interface PostHogOptions {
    /** PostHog project token. */
    projectToken: string
    /** PostHog API origin. */
    apiHost?: string
    /** Origin used for requests targeting feature flags. Defaults to `apiHost`. */
    flagsHost?: string
    /** Origin used for requests targeting static assets. Defaults to `apiHost`. */
    assetsHost?: string
    /** Storage implementation. Pass `false` to keep all state in memory. */
    storage?: StorageLike | false
    /** Override the storage key. */
    persistenceKey?: string
    /** Override the consent key verbatim. Defaults to `__ph_opt_in_out_<projectToken>`. */
    consentPersistenceName?: string
    /** Fetch implementation. Pass `false` to disable network requests. */
    fetch?: BrowserFetch | false
    /** Navigator implementation. Pass `false` to disable navigator capabilities. */
    navigator?: BrowserNavigator | false
    /** Start with capture disabled until `optIn()` runs. */
    optOutByDefault?: boolean
    /** Capture one initial `$pageview` after configured extensions install. Defaults to `true`. */
    capturePageview?: boolean
    /** Initial person properties exposed to feature-evaluation extensions. */
    initialPersonProperties?: Record<string, unknown>
    /** Disable the default user-agent bot filter. */
    disableBotDetection?: boolean
    /** Add blocked user-agent fragments to the default bot filter. */
    blockedUserAgents?: readonly string[]
    /** Enable SDK diagnostic logs. */
    debug?: boolean
    /** Supply initial remote configuration without a request. */
    remoteConfig?: RemoteConfig
    /** Load remote configuration when an extension first requests it. */
    remoteConfigLoader?: () => Promise<RemoteConfig | undefined>
    /** Stop waiting for remote configuration after this duration. */
    remoteConfigTimeoutMs?: number
    /**
     * Automatic first-party analytics delivery. Defaults to lazy loading after the first admitted event.
     * Pass `false` to retain events without automatically loading delivery.
     */
    analytics?: AnalyticsConfiguration
    /** Install extensions before the factory resolves. A preinstalled analytics extension satisfies delivery. */
    extensions?: readonly Extension[]
}

/** Options for the analytics-free `@posthog/browser/core` entrypoint. */
export type CorePostHogOptions = Omit<PostHogOptions, 'analytics'>

/** Capture V1's terminal verdict for one reported event. */
export type CaptureOutcomeStatus = 'ok' | 'warning' | 'drop' | 'retry'

/** A backend-reported Capture V1 event verdict. */
export interface CaptureOutcome {
    readonly result: CaptureOutcomeStatus
    readonly details?: string
}

/** Terminal outcome of an immediate Capture V1 operation. */
export interface CaptureSummary {
    /** Number of finalized events submitted on the wire. */
    readonly submitted: number
    /** Submitted events without an `ok` or `warning` verdict. */
    readonly notPersisted: number
    /** Whether every submitted event received an `ok` or `warning` verdict. */
    readonly allPersisted: boolean
    /** Backend-reported outcomes keyed by event UUID. Missing outcomes count as not persisted. */
    readonly results: Readonly<Record<string, CaptureOutcome>>
}

export interface PostHog extends Client, Disposable {
    readonly onNewSession: Listener<NewSessionInfo>
    /** Sends one finalized event inline and resolves after Capture V1 reaches a terminal outcome. */
    captureImmediate(
        event: string,
        properties?: Record<string, unknown> | null,
        options?: CaptureOptions
    ): Promise<CaptureSummary>
    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): Promise<void>
    group(type: string, key: string, properties?: Record<string, unknown>): Promise<void>
    reset(): void
    flush(): Promise<void>
    shutdown(shutdownTimeoutMs?: number): Promise<void>
    dispose(): Promise<void>
    optIn(): void
    optOut(): void
    hasOptedOut(): boolean
    getExtension<T extends Extension>(token: ExtensionToken<T>): T | undefined
    getExtension<T extends Extension = Extension>(name: string): T | undefined
    getRemoteConfig(): Promise<RemoteConfig | undefined>
}

export type {
    AnalyticsConfiguration,
    AnalyticsOptions,
    AutomaticAnalyticsOptions,
    LoadStrategy,
    ApiResponse,
    CaptureOptions,
    Disposable,
    Extension,
    RemoteConfig,
    SendRequestInit,
    SessionContext,
}
