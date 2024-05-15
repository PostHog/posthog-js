import { PostHog } from '../posthog-core'
import { patch } from './replay/rrweb-plugins/patch'
import { window } from '../utils/globals'
import { logger } from '../utils/logger'
import { SessionIdManager } from '../sessionid'

export class TracingHeaders {
    private _restoreXHRPatch: (() => void) | undefined = undefined
    private _restoreFetchPatch: (() => void) | undefined = undefined

    constructor(private readonly instance: PostHog) {}

    public startIfEnabledOrStop() {
        if (this.instance.config.__add_tracing_headers && this._canPatch()) {
            // we can assert this is present because we've checked previously
            this._patchXHR(this.instance.sessionManager!)
            this._patchFetch(this.instance.sessionManager!)
        } else {
            this._restoreXHRPatch?.()
            this._restoreFetchPatch?.()
            this._restoreXHRPatch = undefined
            this._restoreFetchPatch = undefined
        }
    }

    private _patchFetch(sessionManager: SessionIdManager) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this._restoreFetchPatch = patch(window, 'fetch', (originalFetch: typeof fetch) => {
            return async function (url: URL | RequestInfo, init?: RequestInit | undefined) {
                // check IE earlier than this, we only initialize if Request is present
                // eslint-disable-next-line compat/compat
                const req = new Request(url, init)

                TracingHeaders._addTracingHeaders(sessionManager, req)

                return originalFetch(req)
            }
        })
    }

    private _patchXHR(sessionManager: SessionIdManager) {
        this._restoreXHRPatch = patch(
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

                    TracingHeaders._addTracingHeaders(sessionManager, req)

                    return originalOpen.call(xhr, method, req.url, async, username, password)
                }
            }
        )
    }

    private static _addTracingHeaders(sessionManager: SessionIdManager, req: Request) {
        const { sessionId, windowId } = sessionManager.checkAndGetSessionAndWindowId(true)
        req.headers.set('X-POSTHOG-SESSION-ID', sessionId)
        req.headers.set('X-POSTHOG-WINDOW-ID', windowId)
    }

    private _canPatch() {
        const skipping = 'skipping fetch patching'
        const prefix = '[TRACING-HEADERS]'

        if (!window) {
            logger.warn(prefix + ' window is not available, ' + skipping)
            return false
        }
        if (!window.fetch) {
            logger.warn(prefix + ' window.fetch is not available, ' + skipping)
            return false
        }
        if (this._restoreFetchPatch || this._restoreXHRPatch) {
            logger.warn(prefix + ' already patched, ' + skipping)
            return false
        }

        if (!this.instance.sessionManager) {
            logger.warn(prefix + ' sessionManager is not available, ' + skipping)
            return false
        }

        return true
    }
}
