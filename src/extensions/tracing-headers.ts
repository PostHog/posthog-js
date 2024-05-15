import { PostHog } from '../posthog-core'
import { patch } from './replay/rrweb-plugins/patch'
import { window } from '../utils/globals'
import { logger } from '../utils/logger'

export class TracingHeaders {
    private _restoreXHRPatch: (() => void) | undefined = undefined
    private _restoreFetchPatch: (() => void) | undefined = undefined

    constructor(private readonly instance: PostHog) {}

    public startIfEnabledOrStop() {
        if (this.instance.config.__add_tracing_headers) {
            this._patchXHR()
            this._patchFetch()
        } else {
            if (this._restoreXHRPatch) {
                this._restoreXHRPatch()
                this._restoreXHRPatch = undefined
            }
            if (this._restoreFetchPatch) {
                this._restoreFetchPatch()
                this._restoreFetchPatch = undefined
            }
        }
    }

    private _patchFetch() {
        if (!window) {
            logger.warn('[TRACING-HEADERS] window is not available, skipping fetch patching')
            return
        }
        if (!window.fetch) {
            logger.warn('[TRACING-HEADERS] window.fetch is not available, skipping fetch patching')
            return
        }
        if (this._restoreFetchPatch) {
            logger.warn('[TRACING-HEADERS] fetch patching is already enabled, skipping')
            return
        }

        const posthogInstanceSessionManager = this.instance.sessionManager
        if (!posthogInstanceSessionManager) {
            logger.warn('[TRACING-HEADERS] Session manager is not available, skipping fetch patching')
            return
        }

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this._restoreFetchPatch = patch(window, 'fetch', (originalFetch: typeof fetch) => {
            return async function (url: URL | RequestInfo, init?: RequestInit | undefined) {
                // check IE earlier than this, we only initialize if Request is present
                // eslint-disable-next-line compat/compat
                const req = new Request(url, init)
                const { sessionId, windowId } = posthogInstanceSessionManager.checkAndGetSessionAndWindowId(true)
                req.headers.set('X-POSTHOG-SESSION-ID', sessionId)
                req.headers.set('X-POSTHOG-WINDOW-ID', windowId)

                return originalFetch(req)
            }
        })
    }

    private _patchXHR() {
        if (!window) {
            logger.warn('[TRACING-HEADERS] window is not available, skipping XHR patching')
            return
        }
        if (!window.XMLHttpRequest) {
            logger.warn('[TRACING-HEADERS] window.XMLHttpRequest is not available, skipping XHR patching')
            return
        }
        if (this._restoreXHRPatch) {
            logger.warn('[TRACING-HEADERS] XHR patching is already enabled, skipping')
            return
        }

        const posthogInstanceSessionManager = this.instance.sessionManager
        if (!posthogInstanceSessionManager) {
            logger.warn('[TRACING-HEADERS] Session manager is not available, skipping XHR patching')
            return
        }

        this._restoreXHRPatch = patch(
            window.XMLHttpRequest.prototype,
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
                    const { sessionId, windowId } = posthogInstanceSessionManager.checkAndGetSessionAndWindowId(true)

                    // check IE earlier than this, we only initialize if Request is present
                    // eslint-disable-next-line compat/compat
                    const req = new Request(url)
                    req.headers.set('X-POSTHOG-SESSION-ID', sessionId)
                    req.headers.set('X-POSTHOG-WINDOW-ID', windowId)
                    return originalOpen.call(xhr, method, req.url, async, username, password)
                }
            }
        )
    }
}
