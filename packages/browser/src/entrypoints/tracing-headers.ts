import { SessionIdManager } from '../sessionid'
import { patch } from '../extensions/replay/rrweb-plugins/patch'
import { assignableWindow, window } from '../utils/globals'
import { COOKIELESS_SENTINEL_VALUE } from '../constants'
import { isArray } from '@posthog/core'

const SESSION_ID_HEADER = 'X-POSTHOG-SESSION-ID'
const WINDOW_ID_HEADER = 'X-POSTHOG-WINDOW-ID'
const DISTINCT_ID_HEADER = 'X-POSTHOG-DISTINCT-ID'
const TRACING_HEADERS = [SESSION_ID_HEADER, WINDOW_ID_HEADER, DISTINCT_ID_HEADER]

const addTracingHeaders = (
    hostnames: string[],
    distinctId: string,
    sessionManager: SessionIdManager | undefined,
    url: string,
    headers: Headers
) => {
    let reqHostname: string
    try {
        // we don't need to support IE11 here
        // eslint-disable-next-line compat/compat
        reqHostname = new URL(url).hostname
    } catch {
        // If the URL is invalid, we skip adding tracing headers
        return
    }
    if (isArray(hostnames) && !hostnames.includes(reqHostname)) {
        // Skip if the hostname is not in the list (also skip if hostnames is not an array,
        // because in the earliest version of this __add_tracing_headers was a bool)
        return
    }

    if (sessionManager) {
        const { sessionId, windowId } = sessionManager.checkAndGetSessionAndWindowId(true)
        headers.set(SESSION_ID_HEADER, sessionId)
        headers.set(WINDOW_ID_HEADER, windowId)
    }
    if (distinctId !== COOKIELESS_SENTINEL_VALUE) {
        headers.set(DISTINCT_ID_HEADER, distinctId)
    }
}

const patchFetch = (hostnames: string[], distinctId: string, sessionManager?: SessionIdManager): (() => void) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return patch(window, 'fetch', (originalFetch: typeof fetch) => {
        return async function (url: URL | RequestInfo, init?: RequestInit | undefined) {
            // check IE earlier than this, we only initialize if Request is present
            // eslint-disable-next-line compat/compat
            const req = new Request(url, init)

            // Use the Request object for URL parsing only. For fetch(url, init), do not pass this internally-created
            // Request downstream: it exposes request.body as a ReadableStream, and wrappers that forward that body can
            // trigger Safari's "ReadableStream uploading is not supported" error.
            if (url instanceof Request) {
                addTracingHeaders(hostnames, distinctId, sessionManager, req.url, req.headers)
                return originalFetch(req)
            }

            const headers = new Headers(init?.headers)
            addTracingHeaders(hostnames, distinctId, sessionManager, req.url, headers)

            return originalFetch(url, { ...(init || {}), headers })
        }
    })
}

const patchXHR = (hostnames: string[], distinctId: string, sessionManager?: SessionIdManager): (() => void) => {
    return patch(
        // we can assert this is present because we've checked previously
        window!.XMLHttpRequest.prototype,
        'open',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        (originalOpen: typeof XMLHttpRequest.prototype.open) => {
            return function (
                method: string,
                url: string | URL,
                async = true,
                username?: string | null,
                password?: string | null
            ) {
                // because this function is returned in its actual context `this` _is_ an XMLHttpRequest
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const xhr = this as XMLHttpRequest

                // check IE earlier than this, we only initialize if Request is present
                // eslint-disable-next-line compat/compat
                const req = new Request(url)
                const headers = new Headers()

                addTracingHeaders(hostnames, distinctId, sessionManager, req.url, headers)

                const result = originalOpen.call(xhr, method, req.url, async, username, password)

                TRACING_HEADERS.forEach((header) => {
                    const value = headers.get(header)
                    if (value) {
                        xhr.setRequestHeader(header, value)
                    }
                })

                return result
            }
        }
    )
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
const patchFns = {
    _patchFetch: patchFetch,
    _patchXHR: patchXHR,
}
assignableWindow.__PosthogExtensions__.tracingHeadersPatchFns = patchFns

// we used to put tracingHeadersPatchFns on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put it directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.postHogTracingHeadersPatchFns = patchFns

export default patchFns
