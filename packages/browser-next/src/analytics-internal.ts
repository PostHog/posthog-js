import type { Client, CapturedEventInfo, ExtensionToken, Listener } from '@posthog/browser-common'
import type { BrowserExtension, GroupInfo, IdentifyInfo } from './browser-client'
import type { IAnalytics } from './analytics-api'
import type { BrowserState } from './state'
import type { NewSessionInfo } from './types'

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
export const Analytics = 'analytics' as ExtensionToken<IAnalyticsExtension>

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

/** Core-owned state and notifications consumed by analytics operation policy. */
export interface AnalyticsCaptureHost {
    readonly projectToken: string
    readonly logger: Client['logger']
    readonly state: Pick<
        BrowserState,
        | 'prepare'
        | 'distinctId'
        | 'deviceId'
        | 'groups'
        | 'isIdentified'
        | 'prepareSessionForEvent'
        | 'sessionAdmitted'
        | 'identify'
        | 'group'
        | 'reset'
        | 'resetGroups'
    >
    readonly onEvent: Listener<CapturedEventInfo>
    canCapture(): boolean
    canMutate(): boolean
    isDisposed(): boolean
    authority(): object
    publishEvent(event: CapturedEventInfo): void
    publishNewSession(session: NewSessionInfo): void
    publishIdentify(info: IdentifyInfo): void
    publishGroup(info: GroupInfo): void
    publishReset(value: void): void
    publishGroupsReset(): void
}

/** First-party analytics is one configured owner of operations, buffering and delivery. */
export interface IAnalyticsExtension extends IAnalytics {
    flush(reason?: 'flush' | 'shutdown'): Promise<void>
    purge(): void
    bindCaptureHost(host: AnalyticsCaptureHost): void
    captureInitialPageview(): boolean
    initialize(host: CaptureHost): void
    start(): Promise<void>
    onBeforeTeardown?(callback: () => void): AnalyticsTeardownSubscription
}

export const isAnalyticsExtension = (extension: BrowserExtension): extension is IAnalyticsExtension =>
    extension.name === Analytics
