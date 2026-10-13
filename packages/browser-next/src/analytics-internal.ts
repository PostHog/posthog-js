import type { Client, Extension, ExtensionToken } from '@posthog/browser-common'

import type { AnalyticsOptions } from './analytics-options'
import type { EventBuffer } from './event-buffer'
import type { LaneDelivery } from './lane'
import type { RequestRuntime } from './request'
import type { CaptureSummary } from './types'

export interface AnalyticsMessage {
    event: string
    uuid: string
    distinct_id: string
    timestamp: string
    properties: Record<string, unknown>
}

export const MAX_ANALYTICS_BYTES = 8 * 1024 * 1024
export const MAX_ANALYTICS_BATCH_EVENTS = 100
export const Analytics = 'analytics' as ExtensionToken<AnalyticsExtension>

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

/** Loaded implementation, not a registered extension. */
export interface AnalyticsDriver {
    flush(): Promise<void>
    deliverImmediate: AnalyticsDelivery['deliverImmediate']
    dispose(): Promise<void>
}

export type AnalyticsDeliveryFactory = (
    buffer: EventBuffer<AnalyticsMessage>,
    client: Client,
    host: CaptureHost,
    options: Readonly<Required<AnalyticsOptions>>
) => AnalyticsDriver

/** The capture operations required by core, independent of extension setup or loading. */
export interface CaptureSink {
    enqueue(message: AnalyticsMessage, bytes: number): boolean
    discardQueued(message: AnalyticsMessage): void
    admitted(): void
    flush(reason?: 'flush' | 'shutdown'): Promise<void>
    deliverImmediate(message: AnalyticsMessage, canContinue: () => boolean): Promise<CaptureSummary>
    purge(): void
}

/** First-party analytics is both a configured extension and the client's capture sink. */
export interface AnalyticsExtension extends Extension, CaptureSink {
    flush: CaptureSink['flush']
    initialize(host: CaptureHost): void
    start(): Promise<void>
}

export const isAnalyticsExtension = (extension: Extension): extension is AnalyticsExtension =>
    extension.name === Analytics
