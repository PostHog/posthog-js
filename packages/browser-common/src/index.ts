/**
 * Public surface for browser extensions shared across PostHog JavaScript SDK
 * clients.
 */
export type { Extension } from './extension'
export type { Disposable } from './disposable'
export type { ExtensionToken } from './token'
export type { Listener } from './pubsub'
export { Publisher } from './pubsub'
export type {
    Client,
    SessionContext,
    NewSessionReason,
    NewSessionInfo,
    CapturedEventInfo,
    CaptureOptions,
    ApiResponse,
    ApiRequestInit,
    RemoteConfig,
} from './client'
export type { KeyValueStore } from './persistence'
