// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

// import { patch } from 'rrweb/typings/utils'
// copied from https://github.com/rrweb-io/rrweb/blob/8aea5b00a4dfe5a6f59bd2ae72bb624f45e51e81/packages/rrweb/src/utils.ts#L129
import { isFunction } from '@posthog/core'

// Each call to `patch` installs a "layer" in the wrapper chain. A wrapper calls
// down through its layer's mutable `next` reference rather than closing over the
// original directly, so that any layer can later be spliced out of the chain —
// even when newer wrappers sit on top of it.
//
// Without this, restoring a patch only worked when it was still on top of the
// chain (`source[name] === wrapped`). posthog-js wraps `window.fetch` in two
// independent places (tracing headers and session-recording network capture),
// so restores routinely ran out of order and silently no-op'd. Each leaked
// wrapper stayed in the call path, and repeated start/stop cycles grew the chain
// without bound until a real fetch walked a chain deep enough to overflow the
// call stack ("Maximum call stack size exceeded" from recursive `window.fetch`).
interface PatchLayer {
    next: (...args: any[]) => any
}

const noop = () => {
    //
}

const spliceableLayer = (method: unknown): PatchLayer | undefined => {
    if (!isFunction(method)) {
        return undefined
    }
    return ((method as any).__posthog_layer__ ?? (method as any).__rrweb_layer__) as PatchLayer | undefined
}

export function patch(
    source: { [key: string]: any },
    name: string,
    replacement: (...args: unknown[]) => unknown
): () => void {
    try {
        if (!(name in source)) {
            return noop
        }

        const original = source[name] as (...args: any[]) => any

        const layer: PatchLayer = {
            next: original,
        }

        // The wrapper receives this stable delegate instead of `original`, so the
        // function it actually calls can be re-pointed when a lower layer is removed.
        const callNext = function (this: unknown, ...args: unknown[]) {
            return layer.next.apply(this, args)
        }

        const wrapped = replacement(callNext)

        // Make sure it's a function first, as we need to attach an empty prototype for `defineProperties` to work
        // otherwise it'll throw "TypeError: Object.defineProperties called on non-object"
        if (isFunction(wrapped)) {
            wrapped.prototype = wrapped.prototype || {}
            Object.defineProperties(wrapped, {
                __posthog_wrapped__: {
                    enumerable: false,
                    value: true,
                },
                __posthog_layer__: {
                    enumerable: false,
                    value: layer,
                },
            })
        }

        source[name] = wrapped

        return () => {
            // If we're still on top, hand back whatever we currently delegate to
            // (lower layers may already have been removed, so this is not necessarily
            // the `original` we captured at install time).
            if (source[name] === wrapped) {
                source[name] = layer.next
                return
            }

            // Otherwise newer wrappers sit on top of us. Find the layer directly above us
            // and re-point it past us, removing our wrapper from the call path without
            // disturbing the newer wrappers. rrweb's own `patch` builds the identical
            // layer under a different marker and session replay's console plugin wraps
            // the same console methods this module does, so walk both markers — a walk
            // that recognised only its own would give up and leak the wrapper beneath.
            let current: any = source[name]
            let currentLayer = spliceableLayer(current)
            while (currentLayer) {
                if (currentLayer.next === wrapped) {
                    currentLayer.next = layer.next
                    return
                }
                current = currentLayer.next
                currentLayer = spliceableLayer(current)
            }

            // If we get here we're buried under a non-posthog wrapper that closed over
            // us directly, or we've already been removed / replaced wholesale. There's
            // nothing safe to do, so leave the chain untouched.
        }
    } catch {
        return noop
        // This can throw when multiple instrumentation layers try to wrap the same global object,
        // such as XMLHttpRequest, and redefine the same non-configurable wrapper marker.
    }
}
