import type { Properties } from './types'

import { isObject } from '@posthog/core'

export const transformEnabledFeatureFlagsToEventProperties = (
    value: Properties | undefined,
    context: { isFeatureFlagCacheStale: () => boolean }
): Properties => {
    if (!isObject(value) || context.isFeatureFlagCacheStale()) {
        return {}
    }

    const eventProperties: Properties = {}
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) {
        eventProperties[`$feature/${keys[i]}`] = value[keys[i]]
    }
    return eventProperties
}
