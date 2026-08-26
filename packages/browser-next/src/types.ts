import type {
    ApiResponse,
    CaptureOptions,
    Client,
    Disposable,
    Extension,
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
    /** Install extensions before the factory resolves. */
    extensions?: readonly Extension[]
}

export interface PostHog extends Client, Disposable {
    readonly onNewSession: Listener<NewSessionInfo>
    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): Promise<void>
    group(type: string, key: string, properties?: Record<string, unknown>): Promise<void>
    reset(): void
    flush(): Promise<void>
    optIn(): void
    optOut(): void
    hasOptedOut(): boolean
    installExtension(extension: Extension): Promise<Disposable>
    loadExtension(loader: () => Promise<Extension>): Promise<Disposable>
    getExtension<T extends Extension = Extension>(name: string): T | undefined
    getRemoteConfig(): Promise<RemoteConfig | undefined>
}

export type { ApiResponse, CaptureOptions, Disposable, Extension, RemoteConfig, SendRequestInit, SessionContext }
