import type { PostHog } from '../posthog-core'
import { SessionIdManager } from '../sessionid'
import {
    DeadClicksAutoCaptureConfig,
    ExternalIntegrationKind,
    Properties,
    RemoteConfig,
    SiteAppLoader,
    SessionStartReason,
} from '../types'
import type {
    ConversationsRemoteConfig,
    GetMessagesResponse,
    GetTicketsOptions,
    GetTicketsResponse,
    MarkAsReadResponse,
    SendMessageResponse,
    UserProvidedTraits,
} from '../posthog-conversations-types'
// only importing types here, so won't affect the bundle
// eslint-disable-next-line posthog-js/no-external-replay-imports
import type { SessionRecordingStatus, TriggerType } from '../extensions/replay/external/triggerMatching'
import { eventWithTime } from '../extensions/replay/types/rrweb-types'
import { ErrorTracking } from '@posthog/core'

/*
 * Global helpers to protect access to browser globals in a way that is safer for different targets
 * like DOM, SSR, Web workers etc.
 *
 * NOTE: Typically we want the "window" but globalThis works for both the typical browser context as
 * well as other contexts such as the web worker context. Window is still exported for any bits that explicitly require it.
 * If in doubt - export the global you need from this file and use that as an optional value. This way the code path is forced
 * to handle the case where the global is not available.
 */

// eslint-disable-next-line no-restricted-globals
const win: (Window & typeof globalThis) | undefined = typeof window !== 'undefined' ? window : undefined

export type AssignableWindow = Window &
    typeof globalThis & {
        /*
         * Main PostHog instance
         */
        posthog: any

        /*
         * This is our contract between (potentially) lazily loaded extensions and the SDK
         */
        __PosthogExtensions__?: PostHogExtensions

        /**
         * When loading remote config, we assign it to this global configuration
         * for ease of sharing it with the rest of the SDK
         */
        _POSTHOG_REMOTE_CONFIG?: Record<
            string,
            {
                config: RemoteConfig
                siteApps: SiteAppLoader[]
            }
        >

        /**
         * If this is set on the window, our logger will log to the console
         * for ease of debugging. Used for testing purposes only.
         *
         * @see {Config.DEBUG} from config.ts
         */
        POSTHOG_DEBUG: any

        // Exposed by the browser
        doNotTrack: any

        // See entrypoints/customizations.full.ts
        posthogCustomizations: any

        /**
         * This is a legacy way to expose these functions, but we still need to support it for backwards compatibility
         * Can be removed once we drop support for 1.161.1
         *
         * See entrypoints/exception-autocapture.ts
         *
         * @deprecated use `__PosthogExtensions__.errorWrappingFunctions` instead
         */
        posthogErrorWrappingFunctions: any

        /**
         * This is a legacy way to expose these functions, but we still need to support it for backwards compatibility
         * Can be removed once we drop support for 1.161.1
         *
         * See entrypoints/posthog-recorder.ts
         *
         * @deprecated use `__PosthogExtensions__.rrweb` instead
         */
        rrweb: any

        /**
         * This is a legacy way to expose these functions, but we still need to support it for backwards compatibility
         * Can be removed once we drop support for 1.161.1
         *
         * See entrypoints/posthog-recorder.ts
         *
         * @deprecated use `__PosthogExtensions__.rrwebConsoleRecord` instead
         */
        rrwebConsoleRecord: any

        /**
         * This is a legacy way to expose these functions, but we still need to support it for backwards compatibility
         * Can be removed once we drop support for 1.161.1
         *
         * See entrypoints/posthog-recorder.ts
         *
         * @deprecated use `__PosthogExtensions__.getRecordNetworkPlugin` instead
         */
        getRecordNetworkPlugin: any

        /**
         * This is a legacy way to expose these functions, but we still need to support it for backwards compatibility
         * Can be removed once we drop support for 1.161.1
         *
         * See entrypoints/web-vitals.ts
         *
         * @deprecated use `__PosthogExtensions__.postHogWebVitalsCallbacks` instead
         */
        postHogWebVitalsCallbacks: any

        /**
         * This is a legacy way to expose these functions, but we still need to support it for backwards compatibility
         * Can be removed once we drop support for 1.161.1
         *
         * See entrypoints/tracing-headers.ts
         *
         * @deprecated use `__PosthogExtensions__.postHogTracingHeadersPatchFns` instead
         */
        postHogTracingHeadersPatchFns: any

        /**
         * This is a legacy way to expose these functions, but we still need to support it for backwards compatibility
         * Can be removed once we drop support for 1.161.1
         *
         * See entrypoints/surveys.ts
         *
         * @deprecated use `__PosthogExtensions__.generateSurveys` instead
         */
        extendPostHogWithSurveys: any

        /*
         * These are used to handle our toolbar state.
         * @see {Toolbar} from extensions/toolbar.ts
         */
        ph_load_toolbar: any
        ph_load_editor: any
        ph_toolbar_state: any
    } & Record<`__$$ph_site_app_${string}`, any>

/**
 * This is our contract between (potentially) lazily loaded extensions and the SDK
 * changes to this interface can be breaking changes for users of the SDK
 */

export type ExternalExtensionKind = 'intercom-integration' | 'crisp-chat-integration'

export type PostHogExtensionKind =
    | 'toolbar'
    | 'exception-autocapture'
    | 'web-vitals'
    | 'web-vitals-with-attribution'
    | 'recorder'
    | 'lazy-recorder'
    | 'tracing-headers'
    | 'surveys'
    | 'logs'
    | 'conversations'
    | 'product-tours'
    | 'dead-clicks-autocapture'
    | 'remote-config'
    | ExternalExtensionKind

export interface LazyLoadedSessionRecordingInterface {
    start: (startReason?: SessionStartReason) => void
    stop: () => void
    sessionId: string
    status: SessionRecordingStatus
    onRRwebEmit: (rawEvent: eventWithTime) => void
    log: (message: string, level: 'log' | 'warn' | 'error') => void
    sdkDebugProperties: Properties
    overrideLinkedFlag: () => void
    overrideSampling: () => void
    overrideTrigger: (triggerType: TriggerType) => void
    isStarted: boolean
    tryAddCustomEvent(tag: string, payload: any): boolean
}

export interface LazyLoadedDeadClicksAutocaptureInterface {
    start: (observerTarget: Node) => void
    stop: () => void
}

export interface LazyLoadedConversationsInterface {
    // Widget control
    show: () => void
    hide: () => void
    isVisible: () => boolean

    // Lifecycle
    reset: () => void

    // API methods
    sendMessage: (message: string, userTraits?: UserProvidedTraits, newTicket?: boolean) => Promise<SendMessageResponse>
    getMessages: (ticketId?: string, after?: string) => Promise<GetMessagesResponse>
    markAsRead: (ticketId?: string) => Promise<MarkAsReadResponse>
    getTickets: (options?: GetTicketsOptions) => Promise<GetTicketsResponse>
    getCurrentTicketId: () => string | null
    getWidgetSessionId: () => string
}

interface PostHogExtensions {
    loadExternalDependency?: (
        posthog: PostHog,
        kind: PostHogExtensionKind,
        callback: (error?: string | Event, event?: Event) => void
    ) => void

    loadSiteApp?: (posthog: PostHog, appUrl: string, callback: (error?: string | Event, event?: Event) => void) => void

    errorWrappingFunctions?: {
        wrapOnError: (captureFn: (props: ErrorTracking.ErrorProperties) => void) => () => void
        wrapUnhandledRejection: (captureFn: (props: ErrorTracking.ErrorProperties) => void) => () => void
        wrapConsoleError: (captureFn: (props: ErrorTracking.ErrorProperties) => void) => () => void
    }
    rrweb?: { record: any; version: string }
    rrwebPlugins?: { getRecordConsolePlugin: any; getRecordNetworkPlugin?: any }
    generateSurveys?: (posthog: PostHog, isSurveysEnabled: boolean) => any | undefined
    generateProductTours?: (posthog: PostHog, isEnabled: boolean) => any | undefined
    logs?: {
        initializeLogs?: (posthog: PostHog) => any | undefined
    }
    postHogWebVitalsCallbacks?: {
        onLCP: (metric: any) => void
        onCLS: (metric: any) => void
        onFCP: (metric: any) => void
        onINP: (metric: any) => void
    }
    /**
     * @deprecated
     *
     * this was introduced briefly, it is now always a no-op and only kept for backwards compatibility
     */
    loadWebVitalsCallbacks?: (useAttribution?: boolean) => PostHogExtensions['postHogWebVitalsCallbacks']
    tracingHeadersPatchFns?: {
        _patchFetch: (hostnames: string[], distinctId: string, sessionManager?: SessionIdManager) => () => void
        _patchXHR: (hostnames: string[], distinctId: string, sessionManager?: SessionIdManager) => () => void
    }
    initDeadClicksAutocapture?: (
        ph: PostHog,
        config: DeadClicksAutoCaptureConfig
    ) => LazyLoadedDeadClicksAutocaptureInterface
    integrations?: {
        [K in ExternalIntegrationKind]?: { start: (posthog: PostHog) => void; stop: () => void }
    }
    initSessionRecording?: (ph: PostHog) => LazyLoadedSessionRecordingInterface
    initConversations?: (config: ConversationsRemoteConfig, posthog: PostHog) => LazyLoadedConversationsInterface
}

const global: typeof globalThis | undefined = typeof globalThis !== 'undefined' ? globalThis : win

// React Native polyfills for posthog-js compatibility
if (typeof self === 'undefined') {
    ;(global as any).self = global
}
if (typeof File === 'undefined') {
    ;(global as any).File = function () {}
}

export const ArrayProto = Array.prototype
export const nativeForEach = ArrayProto.forEach
export const nativeIndexOf = ArrayProto.indexOf

export const navigator = global?.navigator
export const document = global?.document
export const location = global?.location
export const fetch = global?.fetch
export const XMLHttpRequest =
    global?.XMLHttpRequest && 'withCredentials' in new global.XMLHttpRequest() ? global.XMLHttpRequest : undefined
export const AbortController = global?.AbortController
export const userAgent = navigator?.userAgent
export const assignableWindow: AssignableWindow = win ?? ({} as any)

export { win as window }
