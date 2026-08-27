import { parsePayload } from './featureFlagUtils'
import type { FeatureFlagValue, JsonType } from './types'

export type FeatureFlagPropertyValue = string | number | (string | number)[] | boolean

export type FeatureFlagProperty = {
  key: string
  value: FeatureFlagPropertyValue
  operator?: string
}

export type FeatureFlagSemverParsingPolicy = 'strict' | 'legacy-permissive'

export type MatchFeatureFlagPropertyOptions = {
  warnFunction?: (message: string) => void
  semverParsingPolicy?: FeatureFlagSemverParsingPolicy
}

export type FeatureFlagVariant = {
  key: string
  rollout_percentage: number
}

export type FeatureFlagVariantLookupEntry = {
  valueMin: number
  valueMax: number
  key: string
}

const NULL_VALUES_ALLOWED_OPERATORS = ['is_not', 'is_set']

// This value is intentionally larger than Number.MAX_SAFE_INTEGER. Changing its rounding changes
// existing rollout and variant assignments.
// eslint-disable-next-line no-loss-of-precision
const LONG_SCALE = 0xfffffffffffffff

export class InconclusiveMatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, InconclusiveMatchError.prototype)
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

function parseSemverNumericIdentifier(
  part: string,
  raw: string,
  parsingPolicy: FeatureFlagSemverParsingPolicy
): number {
  if (!/^\d+$/.test(part) || (parsingPolicy === 'strict' && part.length > 1 && part[0] === '0')) {
    throw new InconclusiveMatchError(`Invalid semver: ${raw}`)
  }
  return parseInt(part, 10)
}

export function parseFeatureFlagSemver(
  value: string,
  parsingPolicy: FeatureFlagSemverParsingPolicy = 'strict'
): SemverTuple {
  const text = String(value).trim().replace(/^[vV]/, '')
  const baseVersion = text.split('-')[0].split('+')[0]

  if (!baseVersion || baseVersion.startsWith('.')) {
    throw new InconclusiveMatchError(`Invalid semver: ${value}`)
  }

  const parts = baseVersion.split('.')
  const parsePart = (part: string | undefined): number => {
    if (part === undefined || part === '') return 0
    return parseSemverNumericIdentifier(part, value, parsingPolicy)
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

function computeTildeBounds(
  value: string,
  parsingPolicy: FeatureFlagSemverParsingPolicy
): { lower: SemverTuple; upper: SemverTuple } {
  const parsed = parseFeatureFlagSemver(value, parsingPolicy)
  return { lower: [parsed[0], parsed[1], parsed[2]], upper: [parsed[0], parsed[1] + 1, 0] }
}

function computeCaretBounds(
  value: string,
  parsingPolicy: FeatureFlagSemverParsingPolicy
): { lower: SemverTuple; upper: SemverTuple } {
  const [major, minor, patch] = parseFeatureFlagSemver(value, parsingPolicy)
  const lower: SemverTuple = [major, minor, patch]
  let upper: SemverTuple
  if (major > 0) upper = [major + 1, 0, 0]
  else if (minor > 0) upper = [0, minor + 1, 0]
  else upper = [0, 0, patch + 1]
  return { lower, upper }
}

function computeWildcardBounds(
  value: string,
  parsingPolicy: FeatureFlagSemverParsingPolicy
): { lower: SemverTuple; upper: SemverTuple } {
  const text = String(value).trim().replace(/^[vV]/, '')
  const cleanedText = text.replace(/\.\*$/, '').replace(/\*$/, '')
  if (!cleanedText) throw new InconclusiveMatchError(`Invalid wildcard semver: ${value}`)

  const parts = cleanedText.split('.')
  const parseWildcardPart = (part: string): number => {
    if (parsingPolicy === 'legacy-permissive') {
      const parsed = parseInt(part, 10)
      if (!isNaN(parsed)) return parsed
    } else {
      try {
        return parseSemverNumericIdentifier(part, value, parsingPolicy)
      } catch {
        // Normalize wildcard parsing failures to the historical wildcard-specific error.
      }
    }
    throw new InconclusiveMatchError(`Invalid wildcard semver: ${value}`)
  }

  const major = parseWildcardPart(parts[0])
  if (parts.length === 1) {
    return { lower: [major, 0, 0], upper: [major + 1, 0, 0] }
  }
  const minor = parseWildcardPart(parts[1])
  return { lower: [major, minor, 0], upper: [major, minor + 1, 0] }
}

function convertToDateTime(value: FeatureFlagPropertyValue | Date): Date {
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
  if (interval === 'h') parsedDt.setUTCHours(parsedDt.getUTCHours() - number)
  else if (interval === 'd') parsedDt.setUTCDate(parsedDt.getUTCDate() - number)
  else if (interval === 'w') parsedDt.setUTCDate(parsedDt.getUTCDate() - number * 7)
  else if (interval === 'm') parsedDt.setUTCMonth(parsedDt.getUTCMonth() - number)
  else if (interval === 'y') parsedDt.setUTCFullYear(parsedDt.getUTCFullYear() - number)
  else return null

  return parsedDt
}

export function matchFeatureFlagProperty(
  property: FeatureFlagProperty,
  propertyValues: Record<string, any>,
  options: MatchFeatureFlagPropertyOptions = {}
): boolean {
  const key = property.key
  const value = property.value
  const operator = property.operator || 'exact'
  const parsingPolicy = options.semverParsingPolicy ?? 'strict'

  const hasProperty = Object.prototype.hasOwnProperty.call(propertyValues, key)
  if (!hasProperty) {
    throw new InconclusiveMatchError(`Property ${key} not found in propertyValues`)
  } else if (operator === 'is_not_set') {
    return false
  }

  const overrideValue = propertyValues[key]
  if (overrideValue == null && !NULL_VALUES_ALLOWED_OPERATORS.includes(operator)) {
    options.warnFunction?.(`Property ${key} cannot have a value of null/undefined with the ${operator} operator`)
    return false
  }

  const computeExactMatch = (target: any, actual: any): boolean => {
    if (Array.isArray(target)) {
      return target.map((item) => String(item).toLowerCase()).includes(String(actual).toLowerCase())
    }
    return String(target).toLowerCase() === String(actual).toLowerCase()
  }

  const compare = (lhs: any, rhs: any, comparisonOperator: string): boolean => {
    if (comparisonOperator === 'gt') return lhs > rhs
    if (comparisonOperator === 'gte') return lhs >= rhs
    if (comparisonOperator === 'lt') return lhs < rhs
    if (comparisonOperator === 'lte') return lhs <= rhs
    throw new Error(`Invalid operator: ${comparisonOperator}`)
  }

  switch (operator) {
    case 'exact':
      return computeExactMatch(value, overrideValue)
    case 'is_not':
      return !computeExactMatch(value, overrideValue)
    case 'is_set':
      return true
    case 'icontains':
      return String(overrideValue).toLowerCase().includes(String(value).toLowerCase())
    case 'not_icontains':
      return !String(overrideValue).toLowerCase().includes(String(value).toLowerCase())
    case 'starts_with':
      return String(overrideValue).toLowerCase().startsWith(String(value).toLowerCase())
    case 'not_starts_with':
      return !String(overrideValue).toLowerCase().startsWith(String(value).toLowerCase())
    case 'ends_with':
      return String(overrideValue).toLowerCase().endsWith(String(value).toLowerCase())
    case 'not_ends_with':
      return !String(overrideValue).toLowerCase().endsWith(String(value).toLowerCase())
    case 'regex':
      return isValidRegex(String(value)) && String(overrideValue).match(String(value)) !== null
    case 'not_regex':
      return isValidRegex(String(value)) && String(overrideValue).match(String(value)) === null
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
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
        throw new InconclusiveMatchError('Date operations cannot be performed on boolean values')
      }
      let parsedDate = relativeDateParseForFeatureFlagMatching(String(value))
      if (parsedDate == null) parsedDate = convertToDateTime(value)
      const overrideDate = convertToDateTime(overrideValue)
      return operator === 'is_date_before' ? overrideDate < parsedDate : overrideDate > parsedDate
    }
    case 'semver_eq':
      return (
        compareSemverTuples(
          parseFeatureFlagSemver(String(overrideValue), parsingPolicy),
          parseFeatureFlagSemver(String(value), parsingPolicy)
        ) === 0
      )
    case 'semver_neq':
      return (
        compareSemverTuples(
          parseFeatureFlagSemver(String(overrideValue), parsingPolicy),
          parseFeatureFlagSemver(String(value), parsingPolicy)
        ) !== 0
      )
    case 'semver_gt':
      return (
        compareSemverTuples(
          parseFeatureFlagSemver(String(overrideValue), parsingPolicy),
          parseFeatureFlagSemver(String(value), parsingPolicy)
        ) > 0
      )
    case 'semver_gte':
      return (
        compareSemverTuples(
          parseFeatureFlagSemver(String(overrideValue), parsingPolicy),
          parseFeatureFlagSemver(String(value), parsingPolicy)
        ) >= 0
      )
    case 'semver_lt':
      return (
        compareSemverTuples(
          parseFeatureFlagSemver(String(overrideValue), parsingPolicy),
          parseFeatureFlagSemver(String(value), parsingPolicy)
        ) < 0
      )
    case 'semver_lte':
      return (
        compareSemverTuples(
          parseFeatureFlagSemver(String(overrideValue), parsingPolicy),
          parseFeatureFlagSemver(String(value), parsingPolicy)
        ) <= 0
      )
    case 'semver_tilde': {
      const overrideParsed = parseFeatureFlagSemver(String(overrideValue), parsingPolicy)
      const { lower, upper } = computeTildeBounds(String(value), parsingPolicy)
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0
    }
    case 'semver_caret': {
      const overrideParsed = parseFeatureFlagSemver(String(overrideValue), parsingPolicy)
      const { lower, upper } = computeCaretBounds(String(value), parsingPolicy)
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0
    }
    case 'semver_wildcard': {
      const overrideParsed = parseFeatureFlagSemver(String(overrideValue), parsingPolicy)
      const { lower, upper } = computeWildcardBounds(String(value), parsingPolicy)
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0
    }
    default:
      throw new InconclusiveMatchError(`Unknown operator: ${operator}`)
  }
}

export async function hashSHA1(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('SubtleCrypto API not available')

  const hashBuffer = await subtle.digest('SHA-1', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function getFeatureFlagHash(key: string, bucketingValue: string, salt: string = ''): Promise<number> {
  const hashString = await hashSHA1(`${key}.${bucketingValue}${salt}`)
  return parseInt(hashString.slice(0, 15), 16) / LONG_SCALE
}

export function getFeatureFlagVariantLookupTable(
  variants: readonly FeatureFlagVariant[]
): FeatureFlagVariantLookupEntry[] {
  const table: FeatureFlagVariantLookupEntry[] = []
  let valueMin = 0
  for (const variant of variants) {
    const valueMax = valueMin + variant.rollout_percentage / 100.0
    table.push({ valueMin, valueMax, key: variant.key })
    valueMin = valueMax
  }
  return table
}

export async function getFeatureFlagVariant(
  key: string,
  bucketingValue: string,
  variants: readonly FeatureFlagVariant[]
): Promise<string | undefined> {
  const hashValue = await getFeatureFlagHash(key, bucketingValue, 'variant')
  return getFeatureFlagVariantLookupTable(variants).find(
    (variant) => hashValue >= variant.valueMin && hashValue < variant.valueMax
  )?.key
}

export function resolveFeatureFlagPayload(
  payloads: Readonly<Record<string, JsonType | undefined>> | null | undefined,
  flagValue: FeatureFlagValue | null | undefined
): JsonType | null {
  if (flagValue === false || flagValue === null || flagValue === undefined || !payloads) return null

  const payloadKey = typeof flagValue === 'boolean' ? flagValue.toString() : flagValue
  const payload = payloads[payloadKey] || null
  return payload == null ? null : (parsePayload(payload) as JsonType)
}
