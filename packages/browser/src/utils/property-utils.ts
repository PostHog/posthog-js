import { isNull, isUndefined } from '@posthog/core'
import { jsonStringify } from '../request'
import { PropertyFilters, PropertyOperator } from '../posthog-surveys-types'
import type { Properties } from '../types'
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
