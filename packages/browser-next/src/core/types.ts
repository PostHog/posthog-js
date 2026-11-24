import type { FlagsConfiguration, FlagsOptions } from '../products/flags/flags-options'
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
import type { WebVitalsConfiguration } from '../products/web-vitals/web-vitals-options'
import type { TracingHeadersOptions } from '../products/tracing-headers/tracing-headers-options'
import type { ErrorTrackingConfiguration } from '../products/error-tracking/error-tracking-options'
import type { ToolbarConfiguration } from '../products/toolbar/toolbar-options'
import type { ConversationsConfiguration } from '../products/conversations/conversations-options'
import type { SessionRecordingConfiguration } from '../products/session-recording/session-recording-options'
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

/** Whether the user explicitly opted in, explicitly opted out, or has not chosen. */
export type ExplicitConsentStatus = 'granted' | 'denied' | 'pending'

/** Identity and session values to use instead of generated ones. */
export interface BootstrapOptions {
    /** Distinct ID to use when no identity is stored. An identified ID also identifies a stored anonymous user. */
    distinctId?: string
    /** Whether `distinctId` identifies a known person rather than an anonymous user. */
    isIdentifiedId?: boolean
    /**
     * UUIDv7 session ID to continue, such as one passed from another domain. Like a generated session, it starts with
     * the first admitted event, so `session` and `onSessionId` report it from then on.
     */
    sessionId?: string
}

export interface ResetOptions {
    /** Also replace the device ID. */
    resetDeviceId?: boolean
    /**
     * Seed the new identity and next session instead of generating them. With feature flags, `featureFlags` and
     * `featureFlagPayloads` are served for the new identity until flags load.
     */
    bootstrap?: BootstrapOptions & FlagsOptions['bootstrap']
}

/** Selects how the page URL is recorded on events. Credentials are always removed. */
export interface UrlSanitizationOptions {
    /** Include the pathname. Defaults to true; when false, the path is `/`. */
    path?: boolean
    /** Include query parameters. Defaults to true. */
    query?: boolean
    /** Include the fragment, which can carry tokens. Defaults to false, as in posthog-js's current `defaults`. */
    hash?: boolean
    /**
     * Rewrite a copy of the page URL before `path`, `query` and `hash` apply. Return an absolute URL or URL string.
     * Throwing or returning anything else omits `$current_url`, `$host` and `$pathname` from the event. Replay can
     * apply it to a URL it already returned, so sanitizing a sanitized URL must not change it.
     */
    sanitize?: (url: URL) => URL | string
}

/**
 * Shares identity and session state through a cookie. Create one with `cookiePersistence()` from
 * `@posthog/browser/persistence/cookie`; only instances it returns are supported. `wrap` and the state record it
 * reads and writes are internal, so their shape can change in any release.
 */
export interface CookiePersistence {
    /** Wraps the state storage so the identity record also reads from and writes to the cookie. */
    wrap(storage: StorageLike, stateKey: string, projectToken: string): StorageLike
}

export interface PostHogOptions {
    /** PostHog project token. */
    projectToken: string
    /** PostHog API origin. */
    apiHost?: string
    /** Origin used for requests targeting feature flags. Defaults to `apiHost`. */
    flagsHost?: string
    /**
     * PostHog app origin, used by the toolbar and session replay links. Defaults to the app origin for a PostHog
     * Cloud `apiHost`, otherwise `apiHost`.
     */
    uiHost?: string
    /**
     * Storage implementation. Pass `false` to keep all SDK state in memory. Like posthog-js, surveys, conversations and
     * the toolbar keep their own localStorage keys regardless; conversations writes its widget session to
     * `ph_conv_<projectToken>` even while opted out.
     */
    storage?: StorageLike | false
    /** Override the storage key. */
    persistenceKey?: string
    /** Also persist identity and session state in a cookie, sharing them across subdomains. */
    cookie?: CookiePersistence
    /**
     * Identity and session values to use instead of generated ones. A stored identity takes precedence, except that an
     * identified bootstrap ID identifies a stored anonymous user, as in posthog-js.
     */
    bootstrap?: BootstrapOptions
    /** Override the consent key verbatim. Defaults to `__ph_opt_in_out_<projectToken>`. */
    consentPersistenceName?: string
    /** Fetch implementation. Pass `false` to disable network requests. */
    fetch?: BrowserFetch | false
    /** Navigator implementation. Pass `false` to disable navigator capabilities. */
    navigator?: BrowserNavigator | false
    /** Start with capture disabled until `optIn()` runs. Feature flags still load, as in posthog-js. */
    optOutByDefault?: boolean
    /**
     * Shapes the page URL that every event carries as `$current_url`, with the `$host` and `$pathname` derived from it.
     * It also applies to logs' `url.full`, web vitals measured URLs and session replay page URLs. Defaults to the page
     * URL without its fragment or credentials.
     */
    urlSanitization?: UrlSanitizationOptions
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
    /** Acquire web vitals from saved/fresh project signals, or during initialization when `enabled` is true. */
    webVitals?: WebVitalsConfiguration
    /** Load tracing headers during initialization to add correlation headers to matching application requests. */
    tracingHeaders?: TracingHeadersOptions
    /** Acquire error tracking from saved/fresh exception autocapture signals, or during initialization when configured explicitly. */
    errorTracking?: ErrorTrackingConfiguration
    /** Load the toolbar when the URL or a previous toolbar session authorizes it. Pass `false` to disable. */
    toolbar?: ToolbarConfiguration
    /**
     * Acquire conversations when remote configuration enables them, or during initialization when configured
     * explicitly. Like posthog-js, conversations stores its widget session in `ph_conv_<projectToken>` localStorage
     * regardless of `storage`, and sends widget requests while opted out.
     */
    conversations?: ConversationsConfiguration
    /** Acquire session recording from saved/fresh enablement signals, or during initialization when configured explicitly. */
    sessionRecording?: SessionRecordingConfiguration
    /** Install extensions before the factory resolves. Explicit instances take precedence over automatic product options. */
    extensions?: readonly Extension[]
}

/** Options that `setConfig()` can change after creation. Omitted options keep their current values. */
export interface RuntimeOptions {
    /** Enable or disable SDK diagnostic logs, including loggers that extensions already created. */
    debug?: boolean
    /**
     * Analytics policy applied to subsequent captures. As in `posthog-js`, downgrading `personProfiles` from `'always'`
     * to `'identified_only'` keeps person processing for a visitor whose events were already processed; `'never'` stops it.
     */
    analytics?: Pick<AnalyticsOptions, 'personProfiles'>
}

/** Options for the manually composed `@posthog/browser/core` entrypoint. */
export type CorePostHogOptions = Omit<
    PostHogOptions,
    | 'flags'
    | 'logs'
    | 'surveys'
    | 'autocapture'
    | 'webVitals'
    | 'tracingHeaders'
    | 'errorTracking'
    | 'toolbar'
    | 'conversations'
    | 'sessionRecording'
>

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
/** The application-facing client. Request sending is internal; extensions reach it through {@link IPostHogExtensionHost}. */
export interface IPostHog extends Omit<Client, 'sendRequest'>, Readonly<Partial<BrowserProducts>>, Disposable {
    readonly isRateLimited: boolean
    captureImmediate(
        event: string,
        properties?: Record<string, unknown> | null,
        options?: CaptureOptions
    ): Promise<CaptureSummary>
    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void
    /**
     * Starts a new anonymous identity and session, and forgets the stored consent choice. Pass `true`, as in
     * posthog-js, or `{ resetDeviceId: true }` to also replace the device ID.
     *
     * With `optOutByDefault`, capture returns to the default (opted out), so calling `reset()` after `optIn()` stops
     * capture. Reset first, then opt in again if needed: `posthog.reset(); posthog.optIn()`. Events captured before
     * the reset, in this or another tab, are still delivered. Consent listeners hear of the forgotten choice after the
     * new identity is in place and `onReset` listeners have run.
     */
    reset(options?: boolean | ResetOptions): void
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
    /**
     * Fires with the current session immediately when one exists, then whenever this tab's session or window ID
     * changes, including when it adopts a sibling tab's session. Sessions start with admitted events, not subscriptions.
     */
    readonly onSessionId: Listener<SessionContext>
    /** Fires when consent changes, including changes observed from another tab. Does not replay. */
    readonly onConsentChange: Listener<ConsentChangeInfo>
    /**
     * Fires after identification, independently of capture consent, including an identification this client adopts
     * from another subdomain through cookie persistence. Does not replay.
     */
    readonly onIdentify: Listener<IdentifyInfo>
    /** Local person-property changes, independently of capture consent. Does not replay. */
    readonly onChangeProperties: Listener<ChangePropertiesInfo>
    /** Fires after group membership or property updates, independently of capture consent. Does not replay. */
    readonly onGroup: Listener<GroupInfo>
    /** Fires after group-only reset clears local membership. Does not replay. */
    readonly onGroupsReset: Listener<void>
    /**
     * Fires after local identity and persisted extension state are reset, including a reset this client adopts from
     * another subdomain through cookie persistence. Does not replay.
     */
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
    /** The stored opt-in or opt-out choice, independently of `optOutByDefault`. */
    getExplicitConsentStatus(): ExplicitConsentStatus
    /**
     * Forgets the stored opt-in or opt-out choice, returning consent to the configured default. Events captured before
     * the call are still delivered.
     */
    clearOptInOut(): void
    getRemoteConfig(): Promise<RemoteConfig | undefined>
    /** Change the options in `RuntimeOptions`. Other creation options are fixed for the client's lifetime. */
    setConfig(options: RuntimeOptions): void
    /** Enable SDK diagnostic logs, or disable them with `debug(false)`. Equivalent to `setConfig({ debug })`. */
    debug(enabled?: boolean): void
}

/** The client an extension receives in `setup()`: the application API plus request sending through the SDK. */
export interface IPostHogExtensionHost extends IPostHog, Pick<Client, 'sendRequest'> {}

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
