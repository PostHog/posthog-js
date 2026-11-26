import type { Properties } from '@posthog/types'

import type { Logger, PropertyFilters, PropertyOperator } from '../types'
import { createLogger } from '../utils/logger'

export const isValidRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern)
  } catch {
    return false
  }
  return true
}

const isRepeatingQuantifierAt = (pattern: string, index: number): boolean => {
  const character = pattern[index]
  if (character === '*' || character === '+') {
    return true
  }
  if (character !== '{') {
    return false
  }
  const repetition = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(index))
  if (!repetition) {
    return false
  }
  const max = repetition[2] ? repetition[3] : repetition[1]
  return max === '' || Number(max) > 1
}

/**
 * Detects a repeated group that itself contains repetition, such as `(a+)+` or `(?:x*y)*`.
 * JavaScript's backtracking engine can take exponential time on these, which would stall the
 * synchronous capture path. Overlapping alternation such as `(a|a)*` is not detected.
 */
export const hasNestedQuantifier = (pattern: string): boolean => {
  const groupContainsRepetition: boolean[] = [false]
  let previousWasRepeatingGroup = false

  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]
    const closedRepeatingGroup = previousWasRepeatingGroup
    previousWasRepeatingGroup = false

    if (character === '\\') {
      index++
    } else if (character === '[') {
      for (index++; index < pattern.length && pattern[index] !== ']'; index++) {
        if (pattern[index] === '\\') {
          index++
        }
      }
    } else if (character === '(') {
      groupContainsRepetition.push(false)
      if (pattern[index + 1] === '?') {
        index++
      }
    } else if (character === ')') {
      const containsRepetition = groupContainsRepetition.length > 1 && !!groupContainsRepetition.pop()
      groupContainsRepetition[groupContainsRepetition.length - 1] ||= containsRepetition
      previousWasRepeatingGroup = containsRepetition
    } else if (isRepeatingQuantifierAt(pattern, index)) {
      if (closedRepeatingGroup) {
        return true
      }
      groupContainsRepetition[groupContainsRepetition.length - 1] = true
    }
  }
  return false
}

const MAX_COMPILED_PATTERNS = 100
// null marks a pattern that failed to compile or was rejected as unsafe.
const compiledPatterns = new Map<string, RegExp | null>()
let regexLogger: Logger | undefined

const compilePattern = (pattern: string): RegExp | null => {
  const cached = compiledPatterns.get(pattern)
  if (cached !== undefined) {
    return cached
  }

  let regex: RegExp | null = null
  try {
    regex = new RegExp(pattern)
  } catch {
    // An invalid pattern never matches.
  }
  if (regex && hasNestedQuantifier(pattern)) {
    regex = null
    regexLogger ??= createLogger('[PostHog]')
    regexLogger.warn(
      `Ignoring regex "${pattern}": a repeated group containing repetition can stall matching, so it never matches.`
    )
  }

  // Map.prototype.keys is unavailable in IE11, so drop the whole cache instead of the oldest entry.
  if (compiledPatterns.size >= MAX_COMPILED_PATTERNS) {
    compiledPatterns.clear()
  }
  compiledPatterns.set(pattern, regex)
  return regex
}

export const isMatchingRegex = (value: string, pattern: string): boolean => {
  const regex = compilePattern(pattern)
  if (!regex) {
    return false
  }

  try {
    return regex.test(value)
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

    return comparisonFunction(filter.values.map(String), [String(eventPropertyValue)])
  })
}
