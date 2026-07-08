import type { FlagProperty, FlagPropertyValue, PropertyGroup } from './types.js'

// Operators that should still run their switch case when the property value is null/undefined.
// `is_not` may legitimately compare against null; `is_set` only cares about key presence and
// must not be short-circuited by the null guard below.
const NULL_VALUES_ALLOWED_OPERATORS = ['is_not', 'is_set']

export class InconclusiveMatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, InconclusiveMatchError.prototype)
  }
}

export class RequiresServerEvaluation extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, RequiresServerEvaluation.prototype)
  }
}

function isValidRegex(regex: string): boolean {
  try {
    new RegExp(regex)
    return true
  } catch {
    return false
  }
}

type SemverTuple = [number, number, number]

function parseSemver(value: string): SemverTuple {
  const text = String(value).trim().replace(/^[vV]/, '')
  const baseVersion = text.split('-')[0].split('+')[0]

  if (!baseVersion || baseVersion.startsWith('.')) {
    throw new InconclusiveMatchError(`Invalid semver: ${value}`)
  }

  const parts = baseVersion.split('.')

  const parsePart = (part: string | undefined): number => {
    if (part === undefined || part === '') return 0
    if (!/^\d+$/.test(part)) {
      throw new InconclusiveMatchError(`Invalid semver: ${value}`)
    }
    return parseInt(part, 10)
  }

  return [parsePart(parts[0]), parsePart(parts[1]), parsePart(parts[2])]
}

function compareSemverTuples(a: SemverTuple, b: SemverTuple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  return 0
}

function computeTildeBounds(value: string): { lower: SemverTuple; upper: SemverTuple } {
  const parsed = parseSemver(value)
  return { lower: [parsed[0], parsed[1], parsed[2]], upper: [parsed[0], parsed[1] + 1, 0] }
}

function computeCaretBounds(value: string): { lower: SemverTuple; upper: SemverTuple } {
  const [major, minor, patch] = parseSemver(value)
  const lower: SemverTuple = [major, minor, patch]
  let upper: SemverTuple
  if (major > 0) upper = [major + 1, 0, 0]
  else if (minor > 0) upper = [0, minor + 1, 0]
  else upper = [0, 0, patch + 1]
  return { lower, upper }
}

function computeWildcardBounds(value: string): { lower: SemverTuple; upper: SemverTuple } {
  const text = String(value).trim().replace(/^[vV]/, '')
  const cleanedText = text.replace(/\.\*$/, '').replace(/\*$/, '')
  if (!cleanedText) throw new InconclusiveMatchError(`Invalid wildcard semver: ${value}`)

  const parts = cleanedText.split('.')
  const major = parseInt(parts[0], 10)
  if (isNaN(major)) throw new InconclusiveMatchError(`Invalid wildcard semver: ${value}`)

  if (parts.length === 1) {
    return { lower: [major, 0, 0], upper: [major + 1, 0, 0] }
  }
  const minor = parseInt(parts[1], 10)
  if (isNaN(minor)) throw new InconclusiveMatchError(`Invalid wildcard semver: ${value}`)
  return { lower: [major, minor, 0], upper: [major, minor + 1, 0] }
}

function convertToDateTime(value: FlagPropertyValue | Date): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!isNaN(date.valueOf())) return date
    throw new InconclusiveMatchError(`${value} is in an invalid date format`)
  }
  throw new InconclusiveMatchError(`The date provided ${value} must be a string, number, or date object`)
}

export function relativeDateParseForFeatureFlagMatching(value: string): Date | null {
  const regex = /^-?(?<number>[0-9]+)(?<interval>[a-z])$/
  const match = value.match(regex)
  const parsedDt = new Date(new Date().toISOString())

  if (!match || !match.groups) return null

  const number = parseInt(match.groups['number'])
  if (number >= 10000) return null

  const interval = match.groups['interval']
  if (interval == 'h') parsedDt.setUTCHours(parsedDt.getUTCHours() - number)
  else if (interval == 'd') parsedDt.setUTCDate(parsedDt.getUTCDate() - number)
  else if (interval == 'w') parsedDt.setUTCDate(parsedDt.getUTCDate() - number * 7)
  else if (interval == 'm') parsedDt.setUTCMonth(parsedDt.getUTCMonth() - number)
  else if (interval == 'y') parsedDt.setUTCFullYear(parsedDt.getUTCFullYear() - number)
  else return null

  return parsedDt
}

export function matchProperty(
  property: FlagProperty,
  propertyValues: Record<string, any>,
  warnFunction?: (msg: string) => void
): boolean {
  const key = property.key
  const value = property.value
  const operator = property.operator || 'exact'

  if (!(key in propertyValues)) {
    // When the property is genuinely absent we can answer `is_not_set` locally — no need to
    // bail out as inconclusive and force the flag to return undefined.
    if (operator === 'is_not_set') return true
    throw new InconclusiveMatchError(`Property ${key} not found in propertyValues`)
  } else if (operator === 'is_not_set') {
    return false
  }

  const overrideValue = propertyValues[key]
  if (overrideValue == null && !NULL_VALUES_ALLOWED_OPERATORS.includes(operator)) {
    warnFunction?.(`Property ${key} cannot have a value of null/undefined with the ${operator} operator`)
    return false
  }

  function computeExactMatch(value: any, overrideValue: any): boolean {
    if (Array.isArray(value)) {
      return value.map((val) => String(val).toLowerCase()).includes(String(overrideValue).toLowerCase())
    }
    return String(value).toLowerCase() === String(overrideValue).toLowerCase()
  }

  function compare(lhs: any, rhs: any, op: string): boolean {
    if (op === 'gt') return lhs > rhs
    if (op === 'gte') return lhs >= rhs
    if (op === 'lt') return lhs < rhs
    if (op === 'lte') return lhs <= rhs
    throw new Error(`Invalid operator: ${op}`)
  }

  switch (operator) {
    case 'exact':
      return computeExactMatch(value, overrideValue)
    case 'is_not':
      return !computeExactMatch(value, overrideValue)
    case 'is_set':
      return key in propertyValues
    case 'icontains':
      return String(overrideValue).toLowerCase().includes(String(value).toLowerCase())
    case 'not_icontains':
      return !String(overrideValue).toLowerCase().includes(String(value).toLowerCase())
    case 'regex':
      return isValidRegex(String(value)) && String(overrideValue).match(String(value)) !== null
    case 'not_regex':
      return isValidRegex(String(value)) && String(overrideValue).match(String(value)) === null
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // Try a numeric comparison first; only fall back to lexicographic when one side genuinely
      // isn't a number. `parseFloat` returns NaN for non-numeric strings, so `Number.isFinite`
      // is the right guard — `NaN != null` would slip through and produce nonsense comparisons
      // like `NaN > 5`. Likewise, when a person property arrives as the string `"10"` we want
      // `"10" > "9"` to evaluate numerically (true), not lexicographically (false).
      const parsedValue = typeof value === 'number' ? value : parseFloat(String(value))
      const parsedOverride =
        typeof overrideValue === 'number'
          ? overrideValue
          : overrideValue != null
            ? parseFloat(String(overrideValue))
            : NaN
      if (Number.isFinite(parsedValue) && Number.isFinite(parsedOverride)) {
        return compare(parsedOverride, parsedValue, operator)
      }
      return compare(String(overrideValue), String(value), operator)
    }
    case 'is_date_after':
    case 'is_date_before': {
      if (typeof value === 'boolean') {
        throw new InconclusiveMatchError(`Date operations cannot be performed on boolean values`)
      }
      let parsedDate = relativeDateParseForFeatureFlagMatching(String(value))
      if (parsedDate == null) parsedDate = convertToDateTime(value)
      if (parsedDate == null) throw new InconclusiveMatchError(`Invalid date: ${value}`)
      const overrideDate = convertToDateTime(overrideValue)
      if (operator === 'is_date_before') return overrideDate < parsedDate
      return overrideDate > parsedDate
    }
    case 'semver_eq':
      return compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value))) === 0
    case 'semver_neq':
      return compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value))) !== 0
    case 'semver_gt':
      return compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value))) > 0
    case 'semver_gte':
      return compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value))) >= 0
    case 'semver_lt':
      return compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value))) < 0
    case 'semver_lte':
      return compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value))) <= 0
    case 'semver_tilde': {
      const overrideParsed = parseSemver(String(overrideValue))
      const { lower, upper } = computeTildeBounds(String(value))
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0
    }
    case 'semver_caret': {
      const overrideParsed = parseSemver(String(overrideValue))
      const { lower, upper } = computeCaretBounds(String(value))
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0
    }
    case 'semver_wildcard': {
      const overrideParsed = parseSemver(String(overrideValue))
      const { lower, upper } = computeWildcardBounds(String(value))
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0
    }
    default:
      throw new InconclusiveMatchError(`Unknown operator: ${operator}`)
  }
}

export function matchCohort(
  property: FlagProperty,
  propertyValues: Record<string, any>,
  cohortProperties: Record<string, PropertyGroup>,
  debugMode: boolean = false
): boolean {
  const cohortId = String(property.value)
  if (!(cohortId in cohortProperties)) {
    throw new RequiresServerEvaluation(
      `cohort ${cohortId} not found in local cohorts - likely a static cohort that requires server evaluation`
    )
  }
  return matchPropertyGroup(cohortProperties[cohortId], propertyValues, cohortProperties, debugMode)
}

export function matchPropertyGroup(
  propertyGroup: PropertyGroup,
  propertyValues: Record<string, any>,
  cohortProperties: Record<string, PropertyGroup>,
  debugMode: boolean = false
): boolean {
  if (!propertyGroup) return true

  const propertyGroupType = propertyGroup.type
  const properties = propertyGroup.values

  if (!properties || properties.length === 0) return true

  let errorMatchingLocally = false

  if ('values' in properties[0]) {
    for (const prop of properties as PropertyGroup[]) {
      try {
        const matches = matchPropertyGroup(prop, propertyValues, cohortProperties, debugMode)
        if (propertyGroupType === 'AND') {
          if (!matches) return false
        } else {
          if (matches) return true
        }
      } catch (err) {
        if (err instanceof RequiresServerEvaluation) throw err
        if (err instanceof InconclusiveMatchError) {
          if (debugMode) console.debug(`Failed to compute property ${prop} locally: ${err}`)
          errorMatchingLocally = true
        } else {
          throw err
        }
      }
    }

    if (errorMatchingLocally) {
      throw new InconclusiveMatchError("Can't match cohort without a given cohort property value")
    }
    return propertyGroupType === 'AND'
  } else {
    for (const prop of properties as FlagProperty[]) {
      try {
        let matches: boolean
        if (prop.type === 'cohort') {
          matches = matchCohort(prop, propertyValues, cohortProperties, debugMode)
        } else if (prop.type === 'flag') {
          if (debugMode) {
            console.warn(
              `[FEATURE FLAGS] Flag dependency filters are not supported in local evaluation. ` +
                `Skipping condition with dependency on flag '${prop.key || 'unknown'}'`
            )
          }
          // Mark the group as inconclusive so we don't silently grant cohort membership in an AND
          // group whose missing flag dependency would have evaluated to false (or deny it in an OR
          // group whose flag dependency would have matched). Falls through to the
          // InconclusiveMatchError throw at the end of the loop.
          errorMatchingLocally = true
          continue
        } else {
          matches = matchProperty(prop, propertyValues)
        }

        const negation = prop.negation || false
        if (propertyGroupType === 'AND') {
          if (!matches && !negation) return false
          if (matches && negation) return false
        } else {
          if (matches && !negation) return true
          if (!matches && negation) return true
        }
      } catch (err) {
        if (err instanceof RequiresServerEvaluation) throw err
        if (err instanceof InconclusiveMatchError) {
          if (debugMode) console.debug(`Failed to compute property ${prop} locally: ${err}`)
          errorMatchingLocally = true
        } else {
          throw err
        }
      }
    }

    if (errorMatchingLocally) {
      throw new InconclusiveMatchError("can't match cohort without a given cohort property value")
    }
    return propertyGroupType === 'AND'
  }
}
