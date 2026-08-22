import { isArray, isNull, isUndefined } from '@posthog/core'
import type { PropertyOperator } from '@posthog/core'
import { propertyComparisons } from '@posthog/core/surveys'
import type { Properties } from '@posthog/types'

import { jsonStringify } from './request-utils'

export type { PropertyFilters, PropertyMatchType, PropertyOperator } from '@posthog/core'
export { matchPropertyFilters, propertyComparisons } from '@posthog/core/surveys'

export interface SessionRecordingTriggerPropertyFilter {
    key: string
    value?: string | number | boolean | (string | number | boolean)[] | null
    operator?: PropertyOperator | null
    type?: string | null
}

export function getPersonPropertiesHash(
    distinct_id: string,
    userPropertiesToSet?: Properties,
    userPropertiesToSetOnce?: Properties
): string {
    return jsonStringify({ distinct_id, userPropertiesToSet, userPropertiesToSetOnce })
}

// Operators whose semantics mean "property is not X". When the property being
// filtered on is missing or null, these match — absence of the property
// satisfies a "not equal to X" check. This intentionally differs from the
// shared map-level matcher used by survey event filters.
const NEGATIVE_OPERATORS: ReadonlySet<string> = new Set(['is_not', 'not_icontains', 'not_regex'])

/**
 * Evaluate trigger property filters (WHERE clauses) against event and person properties.
 * All filters must match (implicit AND). Returns true if no filters are present.
 */
export function matchTriggerPropertyFilters(
    filters: SessionRecordingTriggerPropertyFilter[] | undefined,
    eventProperties: Properties | undefined,
    personProperties: Properties | undefined
): boolean {
    if (!filters || filters.length === 0) {
        return true
    }

    return filters.every((filter) => {
        const source = filter.type === 'person' ? personProperties : eventProperties
        const propertyValue = source?.[filter.key]
        const operator = filter.operator || 'exact'

        // Missing or null property: for negative operators, absence counts as a
        // match (nothing can't equal EU, so "is_not EU" is satisfied). For
        // positive operators, we can't confirm a match without a value.
        if (isUndefined(propertyValue) || isNull(propertyValue)) {
            return NEGATIVE_OPERATORS.has(operator)
        }

        const comparisonFunction = propertyComparisons[operator as PropertyOperator]
        if (!comparisonFunction) {
            return false
        }

        if (isUndefined(filter.value) || isNull(filter.value)) {
            return false
        }

        // Normalize filter value and property value to string arrays for comparison
        const targetValues = isArray(filter.value) ? filter.value.map(String) : [String(filter.value)]
        const actualValues = isArray(propertyValue) ? propertyValue.map(String) : [String(propertyValue)]

        return comparisonFunction(targetValues, actualValues)
    })
}
