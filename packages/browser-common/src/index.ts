/**
 * Public surface for browser extensions shared across PostHog JavaScript SDK
 * clients.
 */
export type { Extension } from './extension'
export { CoreExtension } from './core-extension'
export type {
    DeepReadonly,
    SessionContext,
    NewSessionReason,
    NewSessionInfo,
    CapturedEventInfo,
    CaptureOptions,
} from './core-extension'
export * from './types'
export { createDisposable, type Disposable } from './disposable'
export type { ExtensionToken } from './token'
export type { Listener } from './pubsub'
export { Publisher } from './pubsub'
export type { Client, ApiResponse, ApiRequestInit } from './client'
export type { KeyValueStore } from './persistence'
