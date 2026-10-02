import { detectDeviceType } from '@posthog/core'

import { propertyComparisons } from '@posthog/core/surveys'
import type { PropertyMatchType } from '@posthog/core'

export function doesDeviceTypeMatch(deviceTypes?: string[], matchType?: PropertyMatchType): boolean {
    if (!deviceTypes || deviceTypes.length === 0) {
        return true
    }
    const win = typeof window !== 'undefined' ? window : undefined
    const global = typeof globalThis !== 'undefined' ? globalThis : win
    const navigator = global?.navigator
    const userAgent = navigator?.userAgent
    if (!userAgent) {
        return false
    }
    const deviceType = detectDeviceType(userAgent, {
        userAgentDataPlatform: (navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined)
            ?.userAgentData?.platform as string,
        maxTouchPoints: navigator?.maxTouchPoints as number,
        screenWidth: win?.screen?.width as number,
        screenHeight: win?.screen?.height as number,
        devicePixelRatio: win?.devicePixelRatio as number,
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
