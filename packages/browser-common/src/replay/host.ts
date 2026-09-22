import type { Properties, SessionIdChangedCallback, SessionRecordingOptions } from '@posthog/types'
import type { Client, SessionContext } from '../client'
import type { Disposable } from '../disposable'
import type { Listener } from '../pubsub'

/** Live local replay settings. The recording object retains the host's callback identities. */
export interface ReplayOptions {
    recording: SessionRecordingOptions
    disabled: boolean
    consoleLogRecordingEnabled?: boolean
    networkTiming?: boolean
    apiHost: string
    capturePageview: boolean
    stripUrlHash: boolean
    maskPersonalData: boolean
    personalDataQueryParams?: string[]
}

/** A project-specific buffer slot in this tab, pinned when a recorder is created. */
export interface ReplayPendingBufferStore {
    /** Live persistence permission and storage availability. Disabled reads/writes are no-ops. */
    readonly enabled: boolean
    read(): unknown
    write(value: unknown): void
    remove(): void
}

/** Session and delivery operations not represented by ordinary analytics capture. */
export interface ReplayRecorderHost {
    /** False after the session owner has been removed or replaced. */
    readonly sessionActive: boolean
    /** Optional permission for synchronous final producer drainage after ordinary session authority closes. */
    canDrainOnStop?(): boolean
    readonly sessionTimeoutMs: number
    /** Defaults to recording activity, as do recorder construction and explicit start. */
    checkSession(options?: { timestamp?: number; updateActivity?: boolean }): SessionContext
    /** May synchronously replay the current ids without a change reason. */
    onSessionChange(callback: SessionIdChangedCallback): Disposable
    onForcedIdle(callback: () => void): Disposable | undefined
    readonly onFlags: Listener<Record<string, string | boolean>>
    readonly targetingUrl: string | undefined
    isIngestionEndpoint(url: string): boolean
    registerSessionProperties(properties: Properties): void
    /** Uses recording endpoint, no truncation, recordings batching and the capture pipeline. */
    captureSnapshot(endpoint: string, properties: Properties): void
    /** Called after the recorder's final pagehide drain, or beforeunload on browsers without pagehide. */
    onRecorderUnload?(): void
    createPendingBufferStore(): ReplayPendingBufferStore
    /** Pins the persistence writer without changing expiry or synchronizing cookie properties. */
    createFlushedSizeWriter(): (value: { sessionId: string; size: number }) => void
    /** Records the first timestamp using the host's existing unset-value policy. */
    recordFirstSnapshot(timestamp: number): void
    /** The host constructs its own diagnostic payload; replay only emits it. */
    emitConfigEvent(emit: (tag: string, payload: unknown) => boolean): void
}

/** The lazy recorder only consumes these existing Client capabilities. */
export type ReplayRecorderClient = Pick<Client, 'kv' | 'onEvent' | 'library' | 'logger'> & {
    readonly replay: ReplayRecorderHost
}

/** Eager loading and consent capabilities, implemented without importing recorder code. */
export interface ReplayHost {
    readonly sessionActive: boolean
    readonly isAllowed: boolean
    onSessionChange(callback: SessionIdChangedCallback): Disposable
    registerSessionProperties(properties: Properties): void
    requestConfigRefresh(): void
    /** Returns false when no loader or bundled recorder is available; otherwise completes through callback. */
    loadRecorder(script: string, callback: (error?: string | Event) => void): void | false
    createRecorder(
        documentWasEverVisible: boolean,
        forceAllowLocalhostNetworkCapture: boolean
    ): import('./recorder').LazyLoadedSessionRecordingInterface | undefined
}

/** Persistence, targeting and flags consumed by replay's trigger strategies. */
export type ReplayTriggerClient = Pick<Client, 'kv'> & {
    readonly replay: Pick<ReplayRecorderHost, 'targetingUrl' | 'onFlags' | 'registerSessionProperties'>
}
