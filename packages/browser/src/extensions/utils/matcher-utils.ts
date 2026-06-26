import { detectDeviceType } from '@posthog/core'

import { navigator, userAgent, window } from '@posthog/browser-common/utils/globals'
import { propertyComparisons, type PropertyMatchType } from '@posthog/browser-common/utils/property-utils'
import { hasPeriodPassed } from '@posthog/browser-common/utils/matcher-utils'

export { hasPeriodPassed }

export function doesDeviceTypeMatch(deviceTypes?: string[], matchType?: PropertyMatchType): boolean {
    if (!deviceTypes || deviceTypes.length === 0) {
        return true
    }
    if (!userAgent) {
        return false
    }
    const deviceType = detectDeviceType(userAgent, {
        // eslint-disable-next-line compat/compat
        userAgentDataPlatform: navigator?.userAgentData?.platform,
        maxTouchPoints: navigator?.maxTouchPoints,
        screenWidth: window?.screen?.width,
        screenHeight: window?.screen?.height,
        devicePixelRatio: window?.devicePixelRatio,
    })
    return propertyComparisons[matchType ?? 'icontains'](deviceTypes, [deviceType])
}
