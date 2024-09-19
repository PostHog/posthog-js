import { SessionIdManager } from '../sessionid'
import { ErrorEventArgs, ErrorProperties, Properties } from '../types'
import { PostHog } from '../posthog-core'

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

/**
 * This is our contract between (potentially) lazily loaded extensions and the SDK
 * changes to this interface can be breaking changes for users of the SDK
 */
interface PosthogExtensions {
    parseErrorAsProperties?: ([event, source, lineno, colno, error]: ErrorEventArgs) => ErrorProperties
    errorWrappingFunctions?: {
        wrapOnError: (captureFn: (props: Properties) => void) => () => void
        wrapUnhandledRejection: (captureFn: (props: Properties) => void) => () => void
    }
    rrweb?: { record: any; version: string; rrwebVersion: string }
    rrwebPlugins?: { getRecordConsolePlugin: any; getRecordNetworkPlugin?: any }
    canActivateRepeatedly?: (survey: any) => boolean
    generateSurveys?: (posthog: PostHog) => any | undefined
    postHogWebVitalsCallbacks?: {
        onLCP: (metric: any) => void
        onCLS: (metric: any) => void
        onFCP: (metric: any) => void
        onINP: (metric: any) => void
    }
    tracingHeadersPatchFns?: {
        _patchFetch: (sessionManager: SessionIdManager) => () => void
        _patchXHR: (sessionManager: any) => () => void
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
export const assignableWindow: Window &
    typeof globalThis &
    Record<string, any> & {
        __PosthogExtensions__?: PosthogExtensions
    } = win ?? ({} as any)

export { win as window }
