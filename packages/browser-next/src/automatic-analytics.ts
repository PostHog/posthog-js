import { createAnalyticsExtension } from './analytics-buffer'
import type { AnalyticsExtension } from './analytics-internal'
import type { AutomaticAnalyticsOptions } from './analytics-options'

export const analytics = (options: AutomaticAnalyticsOptions): AnalyticsExtension =>
    createAnalyticsExtension(options, async () => {
        const { createAnalyticsDelivery } = await import('./analytics-delivery')
        return createAnalyticsDelivery
    })
