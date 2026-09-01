import type { Properties } from '@posthog/types'

import type { PropertyFilters, PropertyOperator } from '../types'

export const isValidRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern)
  } catch {
    return false
  }
  return true
}

export const isMatchingRegex = (value: string, pattern: string): boolean => {
  if (!isValidRegex(pattern)) {
    return false
  }

  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

const toLowerCase = (value: string): string => value.toLowerCase()

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
      return !isNaN(numValue) && targets.some((target) => numValue > parseFloat(target))
    }),
  lt: (targets, values) =>
    values.some((value) => {
      const numValue = parseFloat(value)
      return !isNaN(numValue) && targets.some((target) => numValue < parseFloat(target))
    }),
}

/**
 * Matches every configured filter against event properties. Missing and null
 * properties never match, including for negative operators.
 */
export function matchPropertyFilters(
  propertyFilters: PropertyFilters | undefined,
  eventProperties: Properties | undefined
): boolean {
  if (!propertyFilters) {
    return true
  }

  return Object.entries(propertyFilters).every(([propertyName, filter]) => {
    const eventPropertyValue = eventProperties?.[propertyName]

    if (eventPropertyValue === undefined || eventPropertyValue === null) {
      return false
    }

    const comparisonFunction = propertyComparisons[filter.operator]
    if (!comparisonFunction) {
      return false
    }

    return comparisonFunction(filter.values, [String(eventPropertyValue)])
  })
}
