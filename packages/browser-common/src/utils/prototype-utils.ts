// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

/**
 * Also adapted from https://github.com/PostHog/rrweb/blob/804380afbb1b9bed70b8792cb5a25d827f5c0cb5/packages/utils/src/index.ts#L31
 * after a number of performance reports from Angular users
 */

import { isFunction, isNativeFunction } from '@posthog/core'

import { logger } from './logger'
import { isAngularZonePresent } from './type-utils'

interface NativeImplementationsCache {
    MutationObserver: typeof MutationObserver
}

type BrowserWindow = Window & typeof globalThis

const cachedImplementations: Partial<NativeImplementationsCache> = {}

export function getNativeImplementation<T extends keyof NativeImplementationsCache>(
    name: T,
    assignableWindow: BrowserWindow
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
        let sandbox: HTMLIFrameElement | undefined
        let keepSandboxAttached = false
        try {
            sandbox = document.createElement('iframe')
            sandbox.hidden = true
            document.head.appendChild(sandbox)
            const contentWindow = sandbox.contentWindow
            if (contentWindow && (contentWindow as any)[name]) {
                impl = (contentWindow as any)[name] as NativeImplementationsCache[T]

                // WebKit tears down a detached iframe's ScriptExecutionContext, causing
                // MutationObserver callbacks from its realm to be silently dropped.
                // Keep the iframe alive for the lifetime of the cached constructor.
                // See https://webkit.org/b/179224 and the equivalent rrweb fallback.
                if (name === 'MutationObserver' && isSafari(assignableWindow)) {
                    sandbox.classList.add('rr-block', 'ph-no-capture')
                    keepSandboxAttached = true
                }
            }
        } catch (e) {
            // Could not create sandbox iframe, just use assignableWindow.xxx
            logger.warn(`Could not create sandbox iframe for ${name} check, bailing to assignableWindow.${name}: `, e)
        } finally {
            if (!keepSandboxAttached && sandbox?.parentNode) {
                sandbox.parentNode.removeChild(sandbox)
            }
        }
    }

    // Sanity check: This _should_ not happen, but if it does, we just skip caching...
    // This can happen e.g. in tests where fetch may not be available in the env, or similar.
    if (!impl || !isFunction(impl)) {
        return impl
    }

    return (cachedImplementations[name] = impl.bind(assignableWindow) as NativeImplementationsCache[T])
}

function isSafari(assignableWindow: BrowserWindow): boolean {
    const userAgent = assignableWindow.navigator?.userAgent ?? ''
    return userAgent.includes('Safari') && !userAgent.includes('Chrome')
}

export function getNativeMutationObserverImplementation(assignableWindow: BrowserWindow): typeof MutationObserver {
    return getNativeImplementation('MutationObserver', assignableWindow)
}
