import { detectDeviceType } from '@posthog/core'
import { userAgent } from '../../utils/globals'
import { propertyComparisons } from '../../utils/property-utils'
import { PropertyMatchType } from '../../types'

export function doesDeviceTypeMatch(deviceTypes?: string[], matchType?: PropertyMatchType): boolean {
    if (!deviceTypes || deviceTypes.length === 0) {
        return true
    }
    if (!userAgent) {
        return false
    }
    const deviceType = detectDeviceType(userAgent)
    return propertyComparisons[matchType ?? 'icontains'](deviceTypes, [deviceType])
}
