import type { Client, KeyValueStore } from '@posthog/browser-common'
import type { BrowserState } from '../../core/state/state'

import type { AnalyticsOptions } from './analytics-options'
import type { EventBuffer } from './admission/event-buffer'
import type { LaneDelivery } from './delivery/lane'
import type { RequestRuntime } from '../../platform/request'
import type { CaptureSummary } from '../../core/types'

export interface AnalyticsMessage {
    event: string
    uuid: string
    distinct_id: string
    timestamp: string
    properties: Record<string, unknown>
}

export const MAX_ANALYTICS_BYTES = 8 * 1024 * 1024
export const MAX_ANALYTICS_BATCH_EVENTS = 100

/** Browser capabilities supplied to capture delivery, independent of its queue. */
export interface CaptureHost {
    runtime: RequestRuntime
    canRetry(): boolean
    reportFailure(error: unknown): void
    reportWarning(message: string): void
    onAvailable(): void
}

export interface AnalyticsDeliveryContext extends CaptureHost {
    libraryVersion: string
    retryNow(): void
    pause(): void
    teardown(maxBytes: number): void
}

export interface AnalyticsDelivery extends LaneDelivery<AnalyticsMessage> {
    deliverImmediate(messages: readonly AnalyticsMessage[], canContinue?: () => boolean): Promise<CaptureSummary>
}

/** Delivery driver attached to the client's event buffer. A driver without an immediate path reports immediate capture as unavailable. */
export interface AnalyticsDriver {
    /** With `immediate`, one more drain is forced if an earlier batch fails before the events queued now are attempted. */
    flush(immediate?: boolean): Promise<void>
    deliverImmediate?: AnalyticsDelivery['deliverImmediate']
    deliverUnload(messages: readonly AnalyticsMessage[]): void
    dispose(): Promise<void>
}

export type AnalyticsDeliveryFactory = (
    buffer: EventBuffer<AnalyticsMessage>,
    client: Pick<Client, 'library' | 'onRemoteConfig'>,
    host: CaptureHost,
    options: Readonly<Required<Pick<AnalyticsOptions, 'flushAt' | 'flushInterval'>>>,
    beforeTeardown?: () => void
) => AnalyticsDriver

export interface AnalyticsTeardownSubscription {
    readonly deliveryAvailable: boolean
    dispose(): void
}

/** The client internals the capture pipeline reads. The client itself satisfies this. */
export interface AnalyticsCore extends Pick<Client, 'projectToken' | 'logger' | 'kv' | 'library' | 'onRemoteConfig'> {
    readonly canCapture: boolean
    readonly _state: Pick<
        BrowserState,
        | 'prepare'
        | 'distinctId'
        | 'deviceId'
        | 'groups'
        | 'activeSessionId'
        | 'isIdentified'
        | 'prepareSessionForEvent'
        | 'peekSession'
        | 'sessionAdmitted'
        | 'identify'
        | 'group'
        | 'reset'
        | 'resetGroups'
        | 'session'
        | 'generated'
        | 'bootstrapIdentity'
        | 'bootstrapSession'
        | 'adoptStoredIdentity'
    >
    readonly _sessionKv: KeyValueStore
    readonly _requestRuntime: RequestRuntime
    readonly _disposed: boolean
    readonly _immediateAuthority: object
    _canMutate(): boolean
    _canDeliver(): boolean
    _startInitialPageview(): void
}
