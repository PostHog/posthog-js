import { detectDeviceType, isUndefined } from '@posthog/core'

import { navigator, userAgent, window } from './globals'
import { propertyComparisons, type PropertyMatchType } from './property-utils'

export function doesDeviceTypeMatch(deviceTypes?: string[], matchType?: PropertyMatchType): boolean {
    if (!deviceTypes || deviceTypes.length === 0) {
        return true
    }
    if (!userAgent) {
        return false
    }
    const hints: {
        userAgentDataPlatform?: string
        maxTouchPoints?: number
        screenWidth?: number
        screenHeight?: number
        devicePixelRatio?: number
    } = {}
    const userAgentDataPlatform = (navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined)
        ?.userAgentData?.platform
    if (!isUndefined(userAgentDataPlatform)) {
        hints.userAgentDataPlatform = userAgentDataPlatform
    }
    if (!isUndefined(navigator?.maxTouchPoints)) {
        hints.maxTouchPoints = navigator.maxTouchPoints
    }
    if (!isUndefined(window?.screen?.width)) {
        hints.screenWidth = window.screen.width
    }
    if (!isUndefined(window?.screen?.height)) {
        hints.screenHeight = window.screen.height
    }
    if (!isUndefined(window?.devicePixelRatio)) {
        hints.devicePixelRatio = window.devicePixelRatio
    }
    const deviceType = detectDeviceType(userAgent, hints)
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
