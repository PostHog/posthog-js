import type { Extension } from '@posthog/browser-common'

import type { LaneDelivery } from './lane'
import type { RequestRuntime } from './request'

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
    reportFailure(error: unknown): void
}

export const createAnalyticsDelivery = '__posthog_browser_create_analytics_delivery__' as const

export interface InternalAnalyticsExtension extends Extension {
    [createAnalyticsDelivery](context: AnalyticsDeliveryContext): LaneDelivery<AnalyticsMessage>
}

export const isAnalyticsExtension = (extension: Extension): extension is InternalAnalyticsExtension =>
    createAnalyticsDelivery in extension
