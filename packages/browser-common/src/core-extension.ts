import type { JsonRecord, Properties } from '@posthog/types'

import type { Disposable } from './disposable'
import type { Extension } from './extension'
import type { Listener } from './pubsub'
import type { ExtensionToken } from './token'

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

/** Why a new session started (a `reset` also starts a new session). */
export type NewSessionReason = 'initial' | 'reset' | 'idleTimeout' | 'maxLength' | 'crossTabAdoption'

/** Details emitted when the client starts or adopts a new session. */
export interface NewSessionInfo extends SessionContext {
    /** The condition that caused this session to begin. */
    readonly reason: NewSessionReason
}

/** A captured event, as observed by `onEvent`. */
export interface CapturedEventInfo {
    /** The finalized captured event name. */
    readonly event: string
    /** The final event properties after client defaults and dynamic properties are applied. */
    readonly properties: DeepReadonly<JsonRecord>
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

/**
 * Server-provided configuration shared across core and product extensions. A
 * loose record by design — each extension reads only the keys it owns.
 */
export type RemoteConfig = DeepReadonly<JsonRecord>

/**
 * The host SDK's core analytics behavior, exposed as an extension so shared
 * extensions can depend on the event pipeline without depending on a concrete
 * PostHog client implementation.
 */
export interface CoreExtension extends Extension {
    /** The id events are currently attributed to. */
    readonly distinctId: string
    /** The anonymous device id carried across identify calls. */
    readonly anonymousId: string
    /** Active group memberships attached to events as `$groups`. */
    readonly groups: DeepReadonly<Record<string, string>>
    /** The current session, created on first read if needed. */
    readonly session: SessionContext

    /** Records an analytics event through the client's normal pipeline. */
    capture(event: string, properties?: Properties | null, options?: CaptureOptions): Promise<void>

    /**
     * Registers a producer of properties merged into every captured event.
     * The producer runs inline while the event is built and must be synchronous.
     */
    registerDynamicEventProperties(producer: () => Record<string, unknown>): Disposable

    /** Fires for every captured event through a deeply readonly view. */
    readonly onEvent: Listener<CapturedEventInfo>
    /** Fires when a new session starts, including on reset. */
    readonly onNewSession: Listener<NewSessionInfo>

    /**
     * Resolves with the current remote config, awaiting the first outcome when
     * necessary. A failed outcome resolves to `undefined`; later successful
     * changes are published through `onRemoteConfig`.
     */
    getRemoteConfig(): Promise<RemoteConfig | undefined>
    /** Fires through a deeply readonly view when server-provided config arrives or changes successfully. */
    readonly onRemoteConfig: Listener<RemoteConfig>
}

/** Capability token used to resolve the host SDK's core analytics extension. */
export const CoreExtension = 'posthog.core' as ExtensionToken<CoreExtension>
