import type { Extension } from '@posthog/browser-common'

import { createAnalyticsExtension } from './analytics-buffer'
import { createAnalyticsDelivery } from './analytics-delivery'
import type { AnalyticsOptions } from './analytics-options'

export type { AnalyticsOptions } from './analytics-options'

/** Creates analytics with its buffer and Capture V1 delivery statically included. */
export const analytics = (options: AnalyticsOptions = {}): Extension =>
    createAnalyticsExtension(options, undefined, createAnalyticsDelivery)
