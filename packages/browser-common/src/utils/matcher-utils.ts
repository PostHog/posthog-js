import { detectDeviceType } from '@posthog/core'

import { navigator, userAgent, window } from './globals'
import { propertyComparisons, type PropertyMatchType } from './property-utils'

export function doesDeviceTypeMatch(deviceTypes?: string[], matchType?: PropertyMatchType): boolean {
    if (!deviceTypes || deviceTypes.length === 0) {
        return true
    }
    if (!userAgent) {
        return false
    }
    const deviceType = detectDeviceType(userAgent, {
        userAgentDataPlatform: (navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined)
            ?.userAgentData?.platform as string,
        maxTouchPoints: navigator?.maxTouchPoints as number,
        screenWidth: window?.screen?.width as number,
        screenHeight: window?.screen?.height as number,
        devicePixelRatio: window?.devicePixelRatio as number,
    })
    return propertyComparisons[matchType ?? 'icontains'](deviceTypes, [deviceType])
}

export function hasPeriodPassed(periodDays?: number, lastSeenDate?: string | Date | null): boolean {
    if (!periodDays || !lastSeenDate) {
        return true
    }

    const date = typeof lastSeenDate === 'string' ? new Date(lastSeenDate) : lastSeenDate

    const now = new Date()
    const diffMs = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffMs / (1000 * 3600 * 24))
    return diffDays > periodDays
}
