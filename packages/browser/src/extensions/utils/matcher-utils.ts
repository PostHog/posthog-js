import { detectDeviceType } from '@posthog/core'
import { navigator, userAgent, window } from '../../utils/globals'
import { propertyComparisons } from '../../utils/property-utils'
import { PropertyMatchType } from '../../types'

export function doesDeviceTypeMatch(deviceTypes?: string[], matchType?: PropertyMatchType): boolean {
    if (!deviceTypes || deviceTypes.length === 0) {
        return true
    }
    if (!userAgent) {
        return false
    }
    const deviceType = detectDeviceType(userAgent, {
        userAgentDataPlatform: navigator?.userAgentData?.platform,
        maxTouchPoints: navigator?.maxTouchPoints,
        screenWidth: window?.screen?.width,
        screenHeight: window?.screen?.height,
        devicePixelRatio: window?.devicePixelRatio,
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
