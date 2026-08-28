import type { Extension } from '@posthog/browser-common'

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

export interface AnalyticsDeliveryContext {
    runtime: RequestRuntime
    libraryVersion: string
    canRetry(): boolean
    retryNow(): void
    pause(): void
    teardown(maxBytes: number): void
    reportFailure(error: unknown): void
    reportWarning(message: string): void
}

export const createAnalyticsDelivery = '__posthog_browser_create_analytics_delivery__' as const

export interface AnalyticsDelivery extends LaneDelivery<AnalyticsMessage> {
    deliverImmediate(messages: readonly AnalyticsMessage[], canContinue?: () => boolean): Promise<CaptureSummary>
}

export interface InternalAnalyticsExtension extends Extension {
    [createAnalyticsDelivery](context: AnalyticsDeliveryContext): AnalyticsDelivery
}

export const isAnalyticsExtension = (extension: Extension): extension is InternalAnalyticsExtension =>
    createAnalyticsDelivery in extension
