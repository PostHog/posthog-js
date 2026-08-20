import type { Logger } from '@posthog/core'
import type { Properties } from '@posthog/types'

import type { Compression } from './types/compression'
import type { Disposable } from './disposable'
import type { Extension } from './extension'
import type { KeyValueStore } from './persistence'
import type { ExtensionToken } from './token'
import type { Listener } from './pubsub'
import type { RemoteConfigResult } from './types/remote-config'

/** Recursively marks object properties as readonly while preserving callable values. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T

/** The current session, stamped on events to tie them to a session and a browser tab. */
export interface SessionContext {
    /** The stable session identifier attached to events captured during this session. */
    readonly sessionId: string
    /** The logical browser tab/window identifier attached alongside the session id. */
    readonly windowId: string
    /** When the session started, as a Unix timestamp in milliseconds. */
    readonly sessionStartTimestamp: number
}

/** A captured event, as observed by `onEvent`. */
export interface CapturedEventInfo {
    /** The finalized captured event name. */
    readonly event: string
    /** The final event properties after client defaults and dynamic properties are applied. */
    readonly properties: DeepReadonly<Record<string, unknown>>
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
    /** Compression used by the browser transport. */
    compression?: Compression | 'best-available'
    /** Where POST requests add `sent_at`. For GET, `query` adds the cache-busting `_` parameter and `body` has no effect. */
    sentAt?: 'body' | 'query'
}

/**
 * The host SDK surface handed to an extension in `setup`. A conforming host
 * provides it as an adapter over its own analytics, transport, persistence,
 * event, and remote-config internals.
 */
export interface Client {
    /** The id events are currently attributed to. */
    readonly distinctId: string
    /** The anonymous device id carried across identify calls. */
    readonly anonymousId: string
    /** The actual persisted device id, absent in cookieless contexts. */
    readonly deviceId: string | undefined
    /** Live host SDK metadata. */
    readonly library: { readonly name: string; readonly version: string }
    /** Initial person properties used for feature evaluation. */
    readonly initialPersonProperties: DeepReadonly<Record<string, unknown>>
    /** Active group memberships attached to events as `$groups`. */
    readonly groups: DeepReadonly<Record<string, string>>
    /** The current session, created on first read if needed. */
    readonly session: SessionContext

    /** Records an analytics event through the client's normal pipeline. */
    capture(event: string, properties?: Properties | null, options?: CaptureOptions): Promise<void>

    /** Registers a synchronous producer of properties merged into every captured event. */
    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable

    /** Returns the extension registered under a typed stable name, or `undefined` when it is not installed. */
    getExtension<T extends Extension>(token: ExtensionToken<T>): T | undefined
    /** Returns the extension registered under a stable name, or `undefined` when it is not installed. */
    getExtension<T extends Extension = Extension>(name: string): T | undefined

    /** Fires for every captured event through a deeply readonly view. */
    readonly onEvent: Listener<CapturedEventInfo>

    /** Replays the latest remote-config outcome on subscription and fires for subsequent outcomes. */
    readonly onRemoteConfig: Listener<DeepReadonly<RemoteConfigResult>>

    /** Public project token used to authenticate endpoint-specific requests. */
    readonly projectToken: string

    /** Sends a request through the host SDK's transport. */
    sendRequest(path: string, init?: SendRequestInit): Promise<ApiResponse>

    /** Initializable, synchronously buffered key-value storage backed by the host client's persistence. */
    readonly kv: KeyValueStore

    /** Logger that follows the host client's debug/noise policy. */
    readonly logger: Logger
}
