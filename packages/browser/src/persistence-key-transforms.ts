import type { Properties } from './types'

import { isObject } from '@posthog/core'

export const transformEnabledFeatureFlagsToEventProperties = (value: Properties | undefined): Properties => {
    if (!isObject(value)) {
        return {}
    }

    const eventProperties: Properties = {}
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) {
        eventProperties[`$feature/${keys[i]}`] = value[keys[i]]
    }
    return eventProperties
}
