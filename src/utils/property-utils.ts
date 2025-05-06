import { jsonStringify } from '../request'
import type { Properties, PropertyMatchType } from '../types'
import { isMatchingRegex } from './regex-utils'

export function getPersonPropertiesHash(
    distinct_id: string,
    userPropertiesToSet?: Properties,
    userPropertiesToSetOnce?: Properties
): string {
    return jsonStringify({ distinct_id, userPropertiesToSet, userPropertiesToSetOnce })
}

export const propertyComparisons: Record<PropertyMatchType, (targets: string[], values: string[]) => boolean> = {
    exact: (targets, values) => values.some((value) => targets.some((target) => value === target)),
    is_not: (targets, values) => values.every((value) => targets.every((target) => value !== target)),
    regex: (targets, values) => values.some((value) => targets.some((target) => isMatchingRegex(value, target))),
    not_regex: (targets, values) => values.every((value) => targets.every((target) => !isMatchingRegex(value, target))),
    icontains: (targets, values) =>
        values.some((value) => targets.some((target) => value.toLowerCase().includes(target.toLowerCase()))),
    not_icontains: (targets, values) =>
        values.every((value) => targets.every((target) => !value.toLowerCase().includes(target.toLowerCase()))),
}
