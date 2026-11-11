import { createAnalyticsExtension } from './analytics-buffer'
import type { IAnalyticsExtension } from './analytics-internal'
import type { AutomaticAnalyticsOptions } from './analytics-options'

export const analytics = (options: AutomaticAnalyticsOptions): IAnalyticsExtension =>
    createAnalyticsExtension(options, async () => {
        const { createAnalyticsDelivery } = await import('./delivery/analytics-delivery')
        return createAnalyticsDelivery
    })
