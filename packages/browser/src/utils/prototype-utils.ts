/**
 * adapted from https://github.com/getsentry/sentry-javascript/blob/72751dacb88c5b970d8bac15052ee8e09b28fd5d/packages/browser-utils/src/getNativeImplementation.ts#L27
 * and https://github.com/PostHog/rrweb/blob/804380afbb1b9bed70b8792cb5a25d827f5c0cb5/packages/utils/src/index.ts#L31
 * after a number of performance reports from Angular users
 */

import { AssignableWindow } from './globals'
import { isAngularZonePresent } from './type-utils'
import { isFunction, isNativeFunction } from '@posthog/core'
import { logger } from './logger'

interface NativeImplementationsCache {
    MutationObserver: typeof MutationObserver
}

const cachedImplementations: Partial<NativeImplementationsCache> = {}

export function getNativeImplementation<T extends keyof NativeImplementationsCache>(
    name: T,
    assignableWindow: AssignableWindow
): NativeImplementationsCache[T] {
    const cached = cachedImplementations[name]
    if (cached) {
        return cached
    }

    let impl = assignableWindow[name] as NativeImplementationsCache[T]

    if (isNativeFunction(impl) && !isAngularZonePresent()) {
        return (cachedImplementations[name] = impl.bind(assignableWindow) as NativeImplementationsCache[T])
    }

    const document = assignableWindow.document
    if (document && isFunction(document.createElement)) {
        try {
            const sandbox = document.createElement('iframe')
            sandbox.hidden = true
            document.head.appendChild(sandbox)
            const contentWindow = sandbox.contentWindow
            if (contentWindow && (contentWindow as any)[name]) {
                impl = (contentWindow as any)[name] as NativeImplementationsCache[T]
            }
            document.head.removeChild(sandbox)
        } catch (e) {
            // Could not create sandbox iframe, just use assignableWindow.xxx
            logger.warn(`Could not create sandbox iframe for ${name} check, bailing to assignableWindow.${name}: `, e)
        }
    }

    // Sanity check: This _should_ not happen, but if it does, we just skip caching...
    // This can happen e.g. in tests where fetch may not be available in the env, or similar.
    if (!impl || !isFunction(impl)) {
        return impl
    }

    return (cachedImplementations[name] = impl.bind(assignableWindow) as NativeImplementationsCache[T])
}

export function getNativeMutationObserverImplementation(assignableWindow: AssignableWindow): typeof MutationObserver {
    return getNativeImplementation('MutationObserver', assignableWindow)
}
