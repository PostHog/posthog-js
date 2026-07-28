/**
 * Public surface for browser extensions shared across PostHog JavaScript SDK
 * clients.
 */
export type { Extension } from './extension'
export * from './types'
export { createDisposable, type Disposable } from './disposable'
export type { Listener } from './pubsub'
export { Publisher } from './pubsub'
export type {
    Client,
    DeepReadonly,
    SessionContext,
    CapturedEventInfo,
    CaptureOptions,
    ApiResponse,
    RequestTarget,
    RequestTransport,
    SendRequestInit,
} from './client'
export type { KeyValueStore } from './persistence'
