import { ErrorProperties } from '../extensions/exception-autocapture/error-conversion'
import type { PostHog } from '../posthog-core'
import { SessionIdManager } from '../sessionid'
import { DeadClicksAutoCaptureConfig, ExternalIntegrationKind, RemoteConfig, SiteAppLoader } from '../types'

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
        __PosthogExtensions__?: PostHogExtensions

        _POSTHOG_REMOTE_CONFIG?: Record<
            string,
            {
                config: RemoteConfig
                siteApps: SiteAppLoader[]
            }
        >

        doNotTrack: any
        posthogCustomizations: any
        posthogErrorWrappingFunctions: any
        rrweb: any
        rrwebConsoleRecord: any
        getRecordNetworkPlugin: any
        POSTHOG_DEBUG: any
        posthog: any
        ph_load_toolbar: any
        ph_load_editor: any
        ph_toolbar_state: any
        postHogWebVitalsCallbacks: any
        postHogTracingHeadersPatchFns: any
        extendPostHogWithSurveys: any
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
    | 'recorder'
    | 'tracing-headers'
    | 'surveys'
    | 'dead-clicks-autocapture'
    | 'remote-config'
    | ExternalExtensionKind

export interface LazyLoadedDeadClicksAutocaptureInterface {
    start: (observerTarget: Node) => void
    stop: () => void
}

interface PostHogExtensions {
    loadExternalDependency?: (
        posthog: PostHog,
        kind: PostHogExtensionKind,
        callback: (error?: string | Event, event?: Event) => void
    ) => void

    loadSiteApp?: (posthog: PostHog, appUrl: string, callback: (error?: string | Event, event?: Event) => void) => void

    errorWrappingFunctions?: {
        wrapOnError: (captureFn: (props: ErrorProperties) => void) => () => void
        wrapUnhandledRejection: (captureFn: (props: ErrorProperties) => void) => () => void
        wrapConsoleError: (captureFn: (props: ErrorProperties) => void) => () => void
    }
    rrweb?: { record: any; version: string }
    rrwebPlugins?: { getRecordConsolePlugin: any; getRecordNetworkPlugin?: any }
    generateSurveys?: (posthog: PostHog, isSurveysEnabled: boolean) => any | undefined
    postHogWebVitalsCallbacks?: {
        onLCP: (metric: any) => void
        onCLS: (metric: any) => void
        onFCP: (metric: any) => void
        onINP: (metric: any) => void
    }
    tracingHeadersPatchFns?: {
        _patchFetch: (distinctId: string, sessionManager?: SessionIdManager) => () => void
        _patchXHR: (distinctId: string, sessionManager?: SessionIdManager) => () => void
    }
    initDeadClicksAutocapture?: (
        ph: PostHog,
        config: DeadClicksAutoCaptureConfig
    ) => LazyLoadedDeadClicksAutocaptureInterface
    integrations?: {
        [K in ExternalIntegrationKind]?: { start: (posthog: PostHog) => void; stop: () => void }
    }
}

const global: typeof globalThis | undefined = typeof globalThis !== 'undefined' ? globalThis : win

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
