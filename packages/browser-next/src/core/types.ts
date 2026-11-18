import type { FlagsConfiguration } from '../products/flags/flags-options'
import type {
    BrowserExtension as Extension,
    BrowserProducts,
    ChangePropertiesInfo,
    ConsentChangeInfo,
    GroupInfo,
    IdentifyInfo,
} from './context/browser-client'
import type { LogsConfiguration } from '../products/logs/logs-options'
import type { SurveysConfiguration } from '../products/surveys/surveys-options'
import type { AutocaptureConfiguration } from '../products/autocapture/autocapture-options'
import type { AnalyticsOptions, PersonProfileMode } from '../products/analytics/analytics-options'

import type {
    ApiResponse,
    CaptureOptions,
    Client,
    Disposable,
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
    /** Stop waiting for remote configuration after this duration in milliseconds. Defaults to 10,000. */
    remoteConfigTimeoutMs?: number
    /** Capture scheduling and person-processing policy. */
    analytics?: AnalyticsOptions
    /** Acquire DOM autocapture from saved/fresh signals, or during initialization when configured explicitly. */
    autocapture?: AutocaptureConfiguration
    /** Dynamically include flags by default. Explicit extensions take precedence over this option. */
    flags?: FlagsConfiguration
    /** Acquire surveys from saved/fresh enablement signals, or during initialization when configured explicitly. */
    surveys?: SurveysConfiguration
    /** Acquire logs from saved/fresh console signals, or during initialization when configured explicitly. */
    logs?: LogsConfiguration
    /** Install extensions before the factory resolves. Explicit instances take precedence over automatic product options. */
    extensions?: readonly Extension[]
}

/** Options that `setConfig()` can change after creation. Omitted options keep their current values. */
export interface RuntimeOptions {
    /** Enable or disable SDK diagnostic logs, including loggers that extensions already created. */
    debug?: boolean
    /** Analytics policy applied to subsequent captures. */
    analytics?: Pick<AnalyticsOptions, 'personProfiles'>
}

/** Options for the manually composed `@posthog/browser/core` entrypoint. */
export type CorePostHogOptions = Omit<PostHogOptions, 'flags' | 'logs' | 'surveys' | 'autocapture'>

/** Capture V1's terminal verdict for one reported event. */
export type CaptureOutcomeStatus = 'ok' | 'warning' | 'drop' | 'retry'

/** A backend-reported Capture V1 event verdict. */
export interface CaptureOutcome {
    readonly result: CaptureOutcomeStatus
    readonly details?: string
}

/** Terminal outcome of an immediate Capture V1 operation. */
export interface CaptureSummary {
    /** Number of finalized events handed to the sender; zero if its summary is unavailable. */
    readonly submitted: number
    /** Submitted events without an `ok` or `warning` verdict. */
    readonly notPersisted: number
    /** Whether every submitted event received an `ok` or `warning` verdict and no operation error occurred. */
    readonly allPersisted: boolean
    /** Backend-reported outcomes keyed by event UUID. Missing outcomes count as not persisted. */
    readonly results: Readonly<Record<string, CaptureOutcome>>
    /** Operation-level failure, with any known partial results retained. Errors always set `allPersisted` to false. */
    readonly error?: Error
}

/** The one browser client: the shared `Client` contract plus browser lifecycle, identity and product access. */
export interface IPostHog extends Client, Readonly<Partial<BrowserProducts>>, Disposable {
    readonly isRateLimited: boolean
    captureImmediate(
        event: string,
        properties?: Record<string, unknown> | null,
        options?: CaptureOptions
    ): Promise<CaptureSummary>
    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void
    reset(): void
    register(properties: Record<string, unknown>): void
    registerOnce(properties: Record<string, unknown>, defaultValue?: unknown): void
    unregister(property: string): void
    getProperty(property: string): unknown
    /** The UUID of the last `$pageview` captured in the current session, sent on events as `$pageview_id`. */
    getPageViewId(): string | undefined
    registerForSession(properties: Record<string, unknown>): void
    unregisterForSession(property: string): void
    /** Links another distinct ID to the current person without changing the current identity. */
    alias(aliasId: string): void
    /** Associates future events with a group and, when person processing is enabled, records its properties. */
    group(type: string, key: string, properties?: Record<string, unknown>): void
    /** Sends a group-profile update without changing group membership. */
    groupIdentify(
        type: string,
        key: string | number,
        properties?: Record<string, unknown>,
        options?: CaptureOptions
    ): void
    /** Clears group memberships, retaining identity, sessions and registered properties. */
    resetGroups(): void
    /** Enables person processing for the current identity without identifying it. */
    createPersonProfile(): void
    /** Sets person properties for the current identity. */
    setPersonProperties(set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void
    /** Removes person properties from the current identity. */
    unsetPersonProperties(names: string | readonly string[]): void
    /** Marks the current person as an internal or test user. */
    setInternalOrTestUser(): void
    readonly onNewSession: Listener<NewSessionInfo>
    /** Fires when consent changes, including changes observed from another tab. Does not replay. */
    readonly onConsentChange: Listener<ConsentChangeInfo>
    /** Fires after identification, independently of capture consent. Does not replay. */
    readonly onIdentify: Listener<IdentifyInfo>
    /** Local person-property changes, independently of capture consent. Does not replay. */
    readonly onChangeProperties: Listener<ChangePropertiesInfo>
    /** Fires after group membership or property updates, independently of capture consent. Does not replay. */
    readonly onGroup: Listener<GroupInfo>
    /** Fires after group-only reset clears local membership. Does not replay. */
    readonly onGroupsReset: Listener<void>
    /** Fires after local identity and persisted extension state are reset. Does not replay. */
    readonly onReset: Listener<void>
    resolveExtension<T extends Extension>(token: ExtensionToken<T>): Promise<T | undefined>
    resolveExtension<Name extends keyof BrowserProducts>(name: Name): Promise<BrowserProducts[Name] | undefined>
    resolveExtension<T extends Extension = Extension>(name: string): Promise<T | undefined>
    flush(): Promise<void>
    shutdown(shutdownTimeoutMs?: number): Promise<void>
    dispose(): Promise<void>
    optIn(): void
    optOut(): void
    hasOptedOut(): boolean
    getRemoteConfig(): Promise<RemoteConfig | undefined>
    /** Change the options in `RuntimeOptions`. Other creation options are fixed for the client's lifetime. */
    setConfig(options: RuntimeOptions): void
    /** Enable SDK diagnostic logs, or disable them with `debug(false)`. Equivalent to `setConfig({ debug })`. */
    debug(enabled?: boolean): void
}

export type {
    AnalyticsOptions,
    PersonProfileMode,
    ApiResponse,
    CaptureOptions,
    Disposable,
    Extension,
    RemoteConfig,
    SendRequestInit,
    SessionContext,
}
