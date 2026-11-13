import type { AnalyticsDeliveryFactory, IAnalyticsExtension } from './analytics-internal'
import type { AutomaticAnalyticsOptions } from './analytics-options'
import { Analytics } from './analytics-extension'

/** Creates one analytics instance, with delivery supplied statically or loaded later. */
export const createAnalyticsExtension = (
    options: AutomaticAnalyticsOptions = {},
    load?: () => Promise<AnalyticsDeliveryFactory>,
    deliveryFactory?: AnalyticsDeliveryFactory
): IAnalyticsExtension => new Analytics(options, load, deliveryFactory)
