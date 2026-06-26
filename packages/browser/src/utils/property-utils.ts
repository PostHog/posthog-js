import { jsonStringify } from '../request'
import type { Properties } from '../types'

export {
    propertyComparisons,
    matchTriggerPropertyFilters,
    matchPropertyFilters,
} from '@posthog/browser-common/utils/property-utils'
export type {
    PropertyMatchType,
    PropertyOperator,
    PropertyFilters,
    SessionRecordingTriggerPropertyFilter,
} from '@posthog/browser-common/utils/property-utils'

export function getPersonPropertiesHash(
    distinct_id: string,
    userPropertiesToSet?: Properties,
    userPropertiesToSetOnce?: Properties
): string {
    return jsonStringify({ distinct_id, userPropertiesToSet, userPropertiesToSetOnce })
}
