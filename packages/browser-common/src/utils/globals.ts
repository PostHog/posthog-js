/*
 * Global helpers to protect access to browser globals in a way that is safer for different targets
 * like DOM, SSR, Web workers etc.
 *
 * Typically we want the browser `window`, but `globalThis` works for browser, workers, and SSR-ish targets.
 * Export optional globals so callers are forced to handle absence.
 */

// eslint-disable-next-line no-restricted-globals
const win: (Window & typeof globalThis) | undefined = typeof window !== 'undefined' ? window : undefined
const global: typeof globalThis | undefined = typeof globalThis !== 'undefined' ? globalThis : win

// React Native polyfills for posthog-js compatibility.
if (global && typeof self === 'undefined') {
    ;(global as any).self = global
}
if (global && typeof File === 'undefined') {
    ;(global as any).File = function () {}
}

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
    start: (startReason?: any) => void
    stop: () => void
    discard: () => void
    sessionId: string
    status: any
    onRRwebEmit: (rawEvent: any) => void
    log: (message: string, level: 'log' | 'warn' | 'error') => void
    sdkDebugProperties: Record<string, any>
    overrideLinkedFlag: () => void
    overrideSampling: () => void
    overrideTrigger: (triggerType: any) => void
    isStarted: boolean
    tryAddCustomEvent(tag: string, payload: any): boolean
}

export interface LazyLoadedDeadClicksAutocaptureInterface {
    start: (observerTarget: Node) => void
    stop: () => void
}

export interface LazyLoadedConversationsInterface {
    show: () => void
    hide: () => void
    isVisible: () => boolean
    reset: () => void
    setIdentity: () => void
    clearIdentity: () => void
    sendMessage: (message: string, userTraits?: any, newTicket?: boolean) => Promise<any>
    getMessages: (ticketId?: string, after?: string) => Promise<any>
    markAsRead: (ticketId?: string) => Promise<any>
    getTickets: (options?: any) => Promise<any>
    requestRestoreLink: (email: string) => Promise<any>
    restoreFromToken: (restoreToken: string) => Promise<any>
    restoreFromUrlToken: () => Promise<any | null>
    getCurrentTicketId: () => string | null
    getWidgetSessionId: () => string
}

export interface PostHogExtensions {
    loadExternalDependency?: (
        posthog: any,
        kind: PostHogExtensionKind,
        callback: (error?: string | Event, event?: Event) => void
    ) => void
    loadSiteApp?: (posthog: any, appUrl: string, callback: (error?: string | Event, event?: Event) => void) => void
    errorWrappingFunctions?: {
        wrapOnError: (captureFn: (props: any) => void) => () => void
        wrapUnhandledRejection: (captureFn: (props: any) => void) => () => void
        wrapConsoleError: (captureFn: (props: any) => void) => () => void
    }
    rrweb?: { record: any; version: string; wasMaxDepthReached?: () => boolean; resetMaxDepthState?: () => void }
    rrwebPlugins?: { getRecordConsolePlugin: any; getRecordNetworkPlugin?: any }
    generateSurveys?: (posthog: any, isSurveysEnabled: boolean) => any | undefined
    generateProductTours?: (posthog: any, isEnabled: boolean) => any | undefined
    logs?: {
        initializeLogs?: (posthog: any) => any | undefined
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
        _patchFetch: (hostnames: any, distinctId: any, sessionManager?: any) => () => void
        _patchXHR: (hostnames: any, distinctId: any, sessionManager?: any) => () => void
    }
    initDeadClicksAutocapture?: (ph: any, config: any) => LazyLoadedDeadClicksAutocaptureInterface
    integrations?: Record<string, { start: (posthog: any) => void; stop: () => void } | undefined>
    initSessionRecording?: (ph: any) => LazyLoadedSessionRecordingInterface
    initConversations?: (config: any, posthog: any) => LazyLoadedConversationsInterface
}

export type AssignableWindow = Window &
    typeof globalThis & {
        posthog: any
        __PosthogExtensions__?: PostHogExtensions
        _POSTHOG_REMOTE_CONFIG?: Record<string, { config: any; siteApps: any[] }>
        POSTHOG_DEBUG: any
        doNotTrack: any
        posthogCustomizations: any
        posthogErrorWrappingFunctions: any
        rrweb: any
        rrwebConsoleRecord: any
        getRecordNetworkPlugin: any
        postHogWebVitalsCallbacks: any
        postHogTracingHeadersPatchFns: any
        extendPostHogWithSurveys: any
        ph_load_toolbar: any
        ph_load_editor: any
        ph_toolbar_state: any
    } & Record<`__$$ph_site_app_${string}`, any>

export const navigator = global?.navigator
export const document = global?.document
export const location = global?.location
export const fetch = global?.fetch
export const XMLHttpRequest =
    global?.XMLHttpRequest && 'withCredentials' in new global.XMLHttpRequest() ? global.XMLHttpRequest : undefined
export const AbortController = global?.AbortController
export const CompressionStream = global?.CompressionStream
export const userAgent = navigator?.userAgent
export const assignableWindow: AssignableWindow = (win as AssignableWindow | undefined) ?? ({} as AssignableWindow)

export { win as window }
