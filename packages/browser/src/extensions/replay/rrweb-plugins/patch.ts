// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

// import { patch } from 'rrweb/typings/utils'
// copied from https://github.com/rrweb-io/rrweb/blob/8aea5b00a4dfe5a6f59bd2ae72bb624f45e51e81/packages/rrweb/src/utils.ts#L129
import { isFunction } from '@posthog/core'

export function patch(
    source: { [key: string]: any },
    name: string,
    replacement: (...args: unknown[]) => unknown
): () => void {
    try {
        if (!(name in source)) {
            return () => {
                //
            }
        }

        const original = source[name] as () => unknown
        const wrapped = replacement(original)

        // Make sure it's a function first, as we need to attach an empty prototype for `defineProperties` to work
        // otherwise it'll throw "TypeError: Object.defineProperties called on non-object"
        if (isFunction(wrapped)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            wrapped.prototype = wrapped.prototype || {}
            Object.defineProperties(wrapped, {
                __posthog_wrapped__: {
                    enumerable: false,
                    value: true,
                },
            })
        }

        source[name] = wrapped

        return () => {
            if (source[name] === wrapped) {
                source[name] = original
            }
        }
    } catch {
        return () => {
            //
        }
        // This can throw when multiple instrumentation layers try to wrap the same global object,
        // such as XMLHttpRequest, and redefine the same non-configurable wrapper marker.
    }
}
