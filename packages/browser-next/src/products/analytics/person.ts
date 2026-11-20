import type { IPostHog } from '../../core/types'
import { analyticsOf, isValidDistinctId } from './analytics-core'
import { personPropertyNames, snapshotPersonProperties } from './properties/person-processing'

/** Enables person processing for the current identity without identifying it. */
export const createPersonProfile = (posthog: IPostHog): void => {
    const analytics = analyticsOf(posthog)
    if (!analytics?._canMutate() || analytics._hasPersonProcessing()) return
    const properties = snapshotPersonProperties(analytics._core._state.distinctId, {}, {})
    if (properties) analytics._setPersonProperties(properties)
}

/** Sets person properties for the current identity. */
export const setPersonProperties = (
    posthog: IPostHog,
    set?: Record<string, unknown>,
    setOnce?: Record<string, unknown>
): void => {
    const analytics = analyticsOf(posthog)
    if (!analytics?._canMutate()) return
    const properties = snapshotPersonProperties(analytics._core._state.distinctId, set, setOnce)
    if (!properties) {
        posthog.logger.warn('Person properties must be JSON-serializable objects')
        return
    }
    if (Object.keys(properties.set).length || Object.keys(properties.setOnce).length) {
        analytics._setPersonProperties(properties)
    }
}

/** Removes person properties from the current identity. */
export const unsetPersonProperties = (posthog: IPostHog, names: string | readonly string[]): void => {
    const analytics = analyticsOf(posthog)
    if (!analytics?._canMutate()) return
    const properties = personPropertyNames(names)
    if (!properties.length || !analytics._requirePersonProcessing()) return
    // Local flag removal invalidates repeats even when the analytics event is rejected.
    analytics._lastPersonProperties = undefined
    analytics._changePropertiesPublisher.publish({ unset: properties })
    analytics._capture('$set', { $unset: properties }, {}, false, { signature: undefined })
}

/** Marks the current person as an internal or test user. */
export const setInternalOrTestUser = (posthog: IPostHog): void =>
    setPersonProperties(posthog, { $internal_or_test_user: true })

/** Links another distinct ID to the current person without changing the current identity. */
export const alias = (posthog: IPostHog, aliasId: string): void => {
    const analytics = analyticsOf(posthog)
    if (!analytics || !isValidDistinctId(aliasId) || !posthog.canCapture || !analytics._canMutate()) return
    if (analytics._requirePersonProcessing()) analytics._capture('$create_alias', { alias: aliasId })
}
