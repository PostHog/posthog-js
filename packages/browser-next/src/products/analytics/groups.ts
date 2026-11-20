import type { CaptureOptions } from '@posthog/browser-common'
import type { IPostHog } from '../../core/types'
import { analyticsOf, isNonEmptyString } from './analytics-core'

const isValidGroupKey = (value: unknown): value is string | number => isNonEmptyString(value) || Number.isFinite(value)

/** Associates future events with a group and, when person processing is enabled, records its properties. */
export const group = (posthog: IPostHog, type: string, key: string, properties?: Record<string, unknown>): void => {
    const analytics = analyticsOf(posthog)
    if (
        !analytics ||
        !isNonEmptyString(type) ||
        !isNonEmptyString(key) ||
        analytics._personProfiles === 'never' ||
        !analytics._canMutate()
    ) {
        return
    }
    const changed = analytics._core._state.group(type, key)
    if (!changed && !properties) return
    analytics._groupPublisher.publish({ type, key, changed, properties })
    if (!analytics._hasPersonProcessing()) return
    analytics.capture('$groupidentify', {
        $group_type: type,
        $group_key: key,
        ...(properties ? { $group_set: properties } : {}),
    })
}

/** Sends a group-profile update without changing group membership. */
export const groupIdentify = (
    posthog: IPostHog,
    type: string,
    key: string | number,
    properties: Record<string, unknown> = {},
    options: CaptureOptions = {}
): void => {
    const analytics = analyticsOf(posthog)
    if (!analytics?._canMutate() || !analytics._core.canCapture) return
    if (!isNonEmptyString(type) || !isValidGroupKey(key)) {
        posthog.logger.warn('Group identify requires a non-empty type and a string or finite numeric key')
        return
    }
    if (!analytics._core._state.prepare() || !analytics._requirePersonProcessing()) return
    analytics.capture('$groupidentify', { $group_type: type, $group_key: key, $group_set: properties }, options)
}

/** Clears group memberships, retaining identity, sessions and registered properties. */
export const resetGroups = (posthog: IPostHog): void => {
    const analytics = analyticsOf(posthog)
    if (!analytics?._canMutate()) return
    analytics._core._state.resetGroups()
    analytics._groupsResetPublisher.publish(undefined)
}
