import type { IAnalytics } from './analytics-api'

import { createAnalyticsExtension } from './analytics-buffer'
import { createAnalyticsDelivery } from './delivery/analytics-delivery'
import type { AnalyticsOptions } from './analytics-options'

export type { IAnalytics } from './analytics-api'
export type { AnalyticsOptions, PersonProfileMode } from './analytics-options'

/** Creates analytics with its buffer and Capture V1 delivery statically included. */
export const analytics = (options: AnalyticsOptions = {}): IAnalytics =>
    createAnalyticsExtension(options, undefined, createAnalyticsDelivery)
