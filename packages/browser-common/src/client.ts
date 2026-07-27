import type { Logger } from '@posthog/core'

import type { KeyValueStore } from './persistence'
import type { ExtensionToken } from './token'

/** A minimal response from {@link Client.apiRequest}. */
export interface ApiResponse {
    /** The HTTP status code returned by the transport, or a client-defined best-effort status for unload sends. */
    statusCode: number
    /** The response body parsed as JSON when available. */
    json?: unknown
    /** The response body as text when available. */
    text?: string
    /** The transport error when the request failed before receiving an HTTP response. */
    error?: unknown
}

/** Options for sending a request through {@link Client.apiRequest}. */
export interface ApiRequestInit {
    /** HTTP method to use; defaults to the client's normal request method for the endpoint. */
    method?: 'GET' | 'POST'
    /** JSON-serialized by the client. */
    body?: unknown
    /** Query string parameters appended to the request URL. */
    query?: Record<string, string>
    /**
     * Mark this as a teardown send (pagehide / shutdown): the client picks the
     * most reliable fire-and-forget transport available — `sendBeacon`, fetch
     * `keepalive`, or sync XHR. The response is best-effort: `json` may be
     * unavailable (e.g. `sendBeacon` only reports "queued"), so callers must not
     * depend on it.
     */
    unload?: boolean
    /** Abort the request if it does not complete within this many milliseconds. */
    timeoutMs?: number
}

/**
 * The host SDK's capability surface as seen by an extension — the client an
 * extension is handed in `setup`. A conforming host provides it as an adapter
 * over its own internals.
 *
 * Host services that may do I/O are awaitable; a host can complete them
 * synchronously when its underlying implementation supports that. Core
 * analytics behavior is provided separately by the core extension.
 */
export interface Client {
    /**
     * Sends a request to a PostHog endpoint; the client owns auth, headers, and
     * transport (fetch / XHR / keepalive). `path` is relative to the configured
     * API host, e.g. `/s/`, `/flags/`, `/api/surveys/`.
     */
    apiRequest(path: string, init?: ApiRequestInit): Promise<ApiResponse>

    /**
     * Resolves another registered extension by a capability token it provides, or
     * `undefined` if nothing registered provides it (not installed, or not loaded
     * yet). Lets one extension use another without importing its implementation.
     */
    getExtension<T>(token: ExtensionToken<T>): T | undefined

    /** Awaitable key-value storage backed by the host client's persistence. */
    readonly kv: KeyValueStore

    /** Logger that follows the host client's debug/noise policy. */
    readonly logger: Logger
}
