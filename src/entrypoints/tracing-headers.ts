import { SessionIdManager } from '../sessionid'
import { patch } from '../extensions/replay/rrweb-plugins/patch'
import { assignableWindow, window } from '../utils/globals'

const addTracingHeaders = (sessionManager: SessionIdManager, req: Request) => {
    const { sessionId, windowId } = sessionManager.checkAndGetSessionAndWindowId(true)
    req.headers.set('X-POSTHOG-SESSION-ID', sessionId)
    req.headers.set('X-POSTHOG-WINDOW-ID', windowId)
}

const patchFetch = (sessionManager: SessionIdManager): (() => void) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return patch(window, 'fetch', (originalFetch: typeof fetch) => {
        return async function (url: URL | RequestInfo, init?: RequestInit | undefined) {
            // check IE earlier than this, we only initialize if Request is present
            // eslint-disable-next-line compat/compat
            const req = new Request(url, init)

            addTracingHeaders(sessionManager, req)

            return originalFetch(req)
        }
    })
}

const patchXHR = (sessionManager: SessionIdManager): (() => void) => {
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

                addTracingHeaders(sessionManager, req)

                return originalOpen.call(xhr, method, req.url, async, username, password)
            }
        }
    )
}

if (assignableWindow) {
    assignableWindow.postHogTracingHeadersPatchFns = {
        _patchFetch: patchFetch,
        _patchXHR: patchXHR,
    }
}
