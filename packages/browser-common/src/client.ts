import type { Logger } from '@posthog/core'

import type { KeyValueStore } from './persistence'
import type { ExtensionToken } from './token'

/** A minimal response from {@link Client.sendRequest}. */
export interface ApiResponse {
    /** The HTTP status code returned by the transport, or a client-defined best-effort status for sendBeacon sends. */
    statusCode: number
    /** The response body parsed as JSON when available. */
    json?: unknown
    /** The response body as text when available. */
    text?: string
    /** The transport error when the request failed before receiving an HTTP response. */
    error?: unknown
}

/** Configured host used to resolve a relative request path. */
export type RequestTarget = 'api' | 'flags' | 'assets'

/** Browser transport requested for a send. */
export type RequestTransport = 'XHR' | 'fetch' | 'sendBeacon'

/** Options for sending a request through {@link Client.sendRequest}. */
export interface SendRequestInit {
    /** Configured host to send through; defaults to the regular API host. */
    target?: RequestTarget
    /** HTTP method to use; the host transport's default applies when omitted. */
    method?: 'GET' | 'POST'
    /** JSON-serialized by the client. */
    body?: unknown
    /** Query string parameters appended to the request URL. */
    query?: Record<string, string>
    /** Additional headers merged with the host SDK's configured request headers. */
    headers?: Record<string, string>
    /** Browser transport to prefer. `sendBeacon` returns a best-effort response immediately. */
    transport?: RequestTransport
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
    /** Public project token used to authenticate endpoint-specific requests. */
    readonly projectToken: string

    /**
     * Sends a request through the host SDK's transport. The extension owns the
     * endpoint-specific path, method, authentication shape, body, and headers.
     */
    sendRequest(path: string, init?: SendRequestInit): Promise<ApiResponse>

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
