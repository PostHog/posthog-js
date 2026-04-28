import { isArray, isNull, isUndefined } from '@posthog/core'
import { jsonStringify } from '../request'
import { PropertyFilters, PropertyOperator } from '../posthog-surveys-types'
import type { Properties, SessionRecordingTriggerPropertyFilter } from '../types'
import { isMatchingRegex } from './regex-utils'

export function getPersonPropertiesHash(
    distinct_id: string,
    userPropertiesToSet?: Properties,
    userPropertiesToSetOnce?: Properties
): string {
    return jsonStringify({ distinct_id, userPropertiesToSet, userPropertiesToSetOnce })
}

export const propertyComparisons: Record<PropertyOperator, (targets: string[], values: string[]) => boolean> = {
    exact: (targets, values) => values.some((value) => targets.some((target) => value === target)),
    is_not: (targets, values) => values.every((value) => targets.every((target) => value !== target)),
    regex: (targets, values) => values.some((value) => targets.some((target) => isMatchingRegex(value, target))),
    not_regex: (targets, values) => values.every((value) => targets.every((target) => !isMatchingRegex(value, target))),
    icontains: (targets, values) =>
        values.map(toLowerCase).some((value) => targets.map(toLowerCase).some((target) => value.includes(target))),
    not_icontains: (targets, values) =>
        values.map(toLowerCase).every((value) => targets.map(toLowerCase).every((target) => !value.includes(target))),
    gt: (targets, values) =>
        values.some((value) => {
            const numValue = parseFloat(value)
            return !isNaN(numValue) && targets.some((t) => numValue > parseFloat(t))
        }),
    lt: (targets, values) =>
        values.some((value) => {
            const numValue = parseFloat(value)
            return !isNaN(numValue) && targets.some((t) => numValue < parseFloat(t))
        }),
}

const toLowerCase = (v: string): string => v.toLowerCase()

// Operators whose semantics mean "property is not X". When the property being
// filtered on is missing or null, these match — absence of the property
// satisfies a "not equal to X" check. This aligns with how PostHog's feature
// flag matchers (posthog/queries/base.py, rust/feature-flags) treat missing
// properties for negative operators.
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

export function matchPropertyFilters(
    propertyFilters: PropertyFilters | undefined,
    eventProperties: Properties | undefined
): boolean {
    // if there are no property filters, it means we're only matching on event name
    if (!propertyFilters) {
        return true
    }

    return Object.entries(propertyFilters).every(([propertyName, filter]) => {
        const eventPropertyValue = eventProperties?.[propertyName]

        if (isUndefined(eventPropertyValue) || isNull(eventPropertyValue)) {
            return false
        }

        // convert event property to string array for comparison
        const eventValues = [String(eventPropertyValue)]

        const comparisonFunction = propertyComparisons[filter.operator]
        if (!comparisonFunction) {
            return false
        }

        return comparisonFunction(filter.values, eventValues)
    })
}
