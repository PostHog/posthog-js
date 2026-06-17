import type { Disposable } from './disposable'
import type { KeyValueStore } from './persistence'
import type { Logger } from './logger'
import type { Listener } from './pubsub'
import type { ExtensionToken } from './token'

/** The current session, stamped on events to tie them to a session and a browser tab. */
export interface SessionContext {
    /** The stable session identifier attached to events captured during this session. */
    sessionId: string
    /** The logical browser tab/window identifier attached alongside the session id. */
    windowId: string
    /** When the session started, as a Unix timestamp in milliseconds. */
    sessionStartTimestamp: number
}

/** Why a new session started (a `reset` also starts a new session). */
export type NewSessionReason = 'initial' | 'reset' | 'idleTimeout' | 'maxLength' | 'crossTabAdoption'

/** Details emitted when the client starts or adopts a new session. */
export interface NewSessionInfo extends SessionContext {
    /** The condition that caused this session to begin. */
    reason: NewSessionReason
}

/** A captured event, as observed by `onEvent`. */
export interface CapturedEventInfo {
    /** The event name supplied to {@link Client.capture}. */
    event: string
    /** The final event properties after client defaults and dynamic properties are applied. */
    properties: Record<string, unknown>
}

/** Per-call capture overrides, mirroring the client's public capture options. */
export interface CaptureOptions {
    /** Override the event timestamp sent to PostHog. */
    timestamp?: Date
    /** Override the event UUID used for de-duplication. */
    uuid?: string
    /** Person properties to set, emitted as `$set`. */
    set?: Record<string, unknown>
    /** Person properties to set if unset, emitted as `$set_once`. */
    setOnce?: Record<string, unknown>
}

/** A minimal response from {@link Client.apiRequest}. */
export interface ApiResponse {
    /** Whether the request completed with a 2xx status, or was queued for best-effort unload transport. */
    ok: boolean
    /** The HTTP status code returned by the transport, or a client-defined best-effort status for unload sends. */
    status: number
    /** Parse the response body as JSON; may be unavailable for best-effort unload requests. */
    json(): Promise<unknown>
    /** Read the response body as text; may be unavailable for best-effort unload requests. */
    text(): Promise<string>
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
     * `keepalive`, or sync XHR. The response is best-effort: `.json()` may be
     * unusable (e.g. `sendBeacon` only reports "queued"), so callers must not
     * depend on it.
     */
    unload?: boolean
    /** Abort the request if it does not complete within this many milliseconds. */
    timeoutMs?: number
}

/**
 * Server-provided configuration, as returned by the remote config response
 * (sampling rates, suppression rules, feature enablement, quotas, …). A loose
 * record by design — each extension reads only the keys it owns.
 */
export type RemoteConfig = Record<string, unknown>

/**
 * The host SDK's capability surface as seen by an extension — the client an
 * extension is handed in `setup`. Each SDK (v1, v2) provides it as a client
 * adapter over its own internals.
 *
 * Synchronous members are always-ready in-memory reads (identity, session);
 * asynchronous members do I/O or wait for something to become ready
 * (`capture`, `apiRequest`, `kv`, `getRemoteConfig`).
 */
export interface Client {
    /** The id events are currently attributed to — the anonymous id, or the identified user's id after `identify`. */
    readonly distinctId: string
    /** The anonymous device id; used before `identify` and carried on identify events as `$anon_distinct_id`. */
    readonly anonymousId: string
    /** Active group memberships (group type → group key), attached to events as `$groups`. */
    readonly groups: Record<string, string>
    /** The current session, created on first read if needed; reading does not extend or rotate it. */
    readonly session: SessionContext

    /** Records an analytics event through the client's normal pipeline. */
    capture(event: string, properties?: Record<string, unknown> | null, options?: CaptureOptions): Promise<void>

    /**
     * Registers a producer of properties merged into every captured event.
     * Returns a {@link Disposable} that removes it; an extension disposes it in
     * its own `dispose`. May be called more than once. The producer runs inline
     * during event build, so it must be cheap and synchronous; it may return
     * different properties each time (e.g. the current URL), and is recomputed
     * per event rather than stored.
     */
    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable

    /**
     * Sends a request to a PostHog endpoint; the client owns auth, headers, and
     * transport (fetch / XHR / keepalive). `path` is relative to the configured
     * API host, e.g. `/s/`, `/flags/`, `/api/surveys/`.
     */
    apiRequest(path: string, init?: ApiRequestInit): Promise<ApiResponse>

    /**
     * Resolves with the client's remote config once available, or `undefined`
     * if the fetch failed (never rejects, never hangs).
     * Re-readable: each call resolves with the current config, awaiting the
     * first fetch if none has landed. `await` it in `setup` to block until
     * config is known, or `.then()` it to reconfigure once it arrives; later
     * changes arrive via `onRemoteConfig`.
     */
    getRemoteConfig(): Promise<RemoteConfig | undefined>

    /** Fires when server-provided config arrives or changes. */
    readonly onRemoteConfig: Listener<RemoteConfig>
    /** Fires for every captured event — hot path, keep handlers cheap and synchronous. */
    readonly onEvent: Listener<CapturedEventInfo>
    /** Fires when a new session starts, including on reset (discriminate via `reason`). */
    readonly onNewSession: Listener<NewSessionInfo>

    /**
     * Resolves another enrolled extension by a capability token it provides, or
     * `undefined` if nothing enrolled provides it (not installed, or not loaded
     * yet). Lets one extension use another without importing its implementation.
     */
    getExtension<T>(token: ExtensionToken<T>): T | undefined

    /** Async key-value storage scoped to this client instance and extension. */
    readonly kv: KeyValueStore

    /** Logger that follows the host client's debug/noise policy. */
    readonly logger: Logger
}
