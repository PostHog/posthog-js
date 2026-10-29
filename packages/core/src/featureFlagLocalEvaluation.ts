import { parsePayload } from './featureFlagUtils'
import type { FeatureFlagValue, JsonType } from './types'

export type FeatureFlagPropertyValue = JsonType

export type FeatureFlagProperty = {
  key: string
  value: FeatureFlagPropertyValue
  operator?: string
}

export type FeatureFlagSemverParsingPolicy = 'strict' | 'legacy-permissive'

export type MatchFeatureFlagPropertyOptions = {
  warnFunction?: (message: string) => void
  semverParsingPolicy?: FeatureFlagSemverParsingPolicy
  /** Only version 2 enables explicit equality; absent/other versions use service legacy matching. */
  propertyMatchingVersion?: number
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

// String operators match null as the string "null", like the flags service.
const NULL_VALUES_ALLOWED_OPERATORS = [
  'exact',
  'is_not',
  'icontains',
  'not_icontains',
  'starts_with',
  'not_starts_with',
  'ends_with',
  'not_ends_with',
  'regex',
  'not_regex',
]

// This value is intentionally larger than Number.MAX_SAFE_INTEGER. Changing its rounding changes
// existing rollout and variant assignments.
// oxlint-disable-next-line no-loss-of-precision
const LONG_SCALE = 0xfffffffffffffff

/**
 * Why local evaluation could not resolve a flag. `experience_continuity` and
 * `unsupported_definition` come from the flag's definition, `missing_context` from the
 * evaluation call, and `unresolved_dependency` from a flag the definition depends on.
 */
export type UnresolvedFlagReason =
  | 'experience_continuity'
  | 'unsupported_definition'
  | 'missing_context'
  | 'unresolved_dependency'

export class InconclusiveMatchError extends Error {
  readonly reason: UnresolvedFlagReason

  constructor(message: string, reason: UnresolvedFlagReason = 'unsupported_definition') {
    super(message)
    this.name = this.constructor.name
    this.reason = reason
    Object.setPrototypeOf(this, InconclusiveMatchError.prototype)
  }
}

// Values read from the evaluation call rather than the flag definition: failing to use one
// is a missing-context cause, not an unsupported definition.
function readContextValue<T>(read: () => T): T {
  try {
    return read()
  } catch (e) {
    if (e instanceof InconclusiveMatchError) {
      throw new InconclusiveMatchError(e.message, 'missing_context')
    }
    throw e
  }
}

function isTruthyOrFalsyPropertyValue(value: unknown): boolean {
  if (typeof value === 'boolean') return true
  if (typeof value === 'string') {
    const lowercaseValue = value.toLowerCase()
    return lowercaseValue === 'true' || lowercaseValue === 'false'
  }
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index++) {
    if (!isTruthyOrFalsyPropertyValue(index in value ? value[index] : null)) return false
  }
  return true
}

function isTruthyPropertyValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index++) {
    if (!isTruthyPropertyValue(index in value ? value[index] : null)) return false
  }
  return true
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new InconclusiveMatchError('Cannot stringify an unpaired surrogate like the flags service')
      }
      index++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new InconclusiveMatchError('Cannot stringify an unpaired surrogate like the flags service')
    }
  }
}

function assertJsonRepresentable(value: unknown, seen: Set<object> = new Set()): void {
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') {
    assertUnicodeScalarString(value)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InconclusiveMatchError(`Cannot represent non-finite number ${value} like the flags service`)
    }
    return
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new InconclusiveMatchError('Cannot represent a circular array during local evaluation')
    seen.add(value)
    try {
      for (let index = 0; index < value.length; index++) {
        if (index in value) assertJsonRepresentable(value[index], seen)
      }
    } finally {
      seen.delete(value)
    }
    return
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InconclusiveMatchError('Cannot represent a non-JSON object like the flags service')
    }
    if (seen.has(value)) throw new InconclusiveMatchError('Cannot represent a circular object during local evaluation')
    seen.add(value)
    try {
      for (const key of Object.keys(value)) {
        assertUnicodeScalarString(key)
        assertJsonRepresentable((value as Record<string, unknown>)[key], seen)
      }
    } finally {
      seen.delete(value)
    }
    return
  }
  throw new InconclusiveMatchError(`Cannot represent ${typeof value} like the flags service`)
}

function compareJsonObjectKeys(left: string, right: string): number {
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftUnit = left.charCodeAt(leftIndex)
    const rightUnit = right.charCodeAt(rightIndex)
    const leftIsHighSurrogate = leftUnit >= 0xd800 && leftUnit <= 0xdbff
    const rightIsHighSurrogate = rightUnit >= 0xd800 && rightUnit <= 0xdbff
    const leftNext = leftIsHighSurrogate ? left.charCodeAt(leftIndex + 1) : 0
    const rightNext = rightIsHighSurrogate ? right.charCodeAt(rightIndex + 1) : 0

    const leftCodePoint = leftIsHighSurrogate ? (leftUnit - 0xd800) * 0x400 + leftNext - 0xdc00 + 0x10000 : leftUnit
    const rightCodePoint = rightIsHighSurrogate
      ? (rightUnit - 0xd800) * 0x400 + rightNext - 0xdc00 + 0x10000
      : rightUnit
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint
    leftIndex += leftIsHighSurrogate ? 2 : 1
    rightIndex += rightIsHighSurrogate ? 2 : 1
  }
  return left.length - right.length
}

// JavaScript collapses JSON integers and integral floats into Number, including inside composites.
// These values fall back rather than choosing a spelling that can disagree with the flags service.
function serializeJsonValue(value: unknown, seen: Set<object> = new Set()): string {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    assertUnicodeScalarString(value)
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InconclusiveMatchError(`Cannot stringify non-finite number ${value} like the flags service`)
    }
    if (Number.isInteger(value)) {
      throw new InconclusiveMatchError(
        `Cannot distinguish integer ${value} from an integral JSON float during local evaluation`
      )
    }
    return String(value)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new InconclusiveMatchError('Cannot stringify a circular array during local evaluation')
    seen.add(value)
    try {
      const items: string[] = []
      for (let index = 0; index < value.length; index++) {
        items.push(index in value ? serializeJsonValue(value[index], seen) : 'null')
      }
      return `[${items.join(',')}]`
    } finally {
      seen.delete(value)
    }
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InconclusiveMatchError('Cannot stringify a non-JSON object like the flags service')
    }
    if (seen.has(value)) throw new InconclusiveMatchError('Cannot stringify a circular object during local evaluation')
    seen.add(value)
    try {
      const keys = Object.keys(value)
      keys.forEach(assertUnicodeScalarString)
      return `{${keys
        .sort(compareJsonObjectKeys)
        .map((key) => `${JSON.stringify(key)}:${serializeJsonValue((value as Record<string, unknown>)[key], seen)}`)
        .join(',')}}`
    } finally {
      seen.delete(value)
    }
  }
  throw new InconclusiveMatchError(`Cannot stringify ${typeof value} like the flags service`)
}

function exactMatchString(value: unknown): string {
  if (typeof value === 'string') {
    assertUnicodeScalarString(value)
    return value
  }
  return serializeJsonValue(value)
}

// Both engines treat escaped spaces and ASCII punctuation as literals, except Rust's \< and \> word boundaries.
const LITERAL_ESCAPED_PUNCTUATION = /[\x20-\x2f:;=?@\x5b-\x60\x7b-\x7e]/

function getPortableRegexClasses(pattern: string): string[] | null {
  const classes: string[] = []
  let classStart = -1
  let previousToken = ''
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]
    if (character.charCodeAt(0) > 0x7f) return null
    if (character === '\\') {
      const escaped = pattern[++index]
      if (escaped === undefined) break
      if (escaped === 'x') {
        if (!/^[\da-f]{2}$/i.test(pattern.slice(index + 1, index + 3))) return null
        index += 2
      } else if (!'dDsSwWbBfnrtv'.includes(escaped) && !LITERAL_ESCAPED_PUNCTUATION.test(escaped)) {
        return null
      }
      // Word boundaries can exhaust the service's backtracking limit even for short ASCII values.
      if (classStart === -1 && 'bB'.includes(escaped)) return null
      previousToken = 'literal'
      continue
    }

    if (character === '[') {
      if (classStart !== -1) return null
      classStart = index
    } else if (character === ']' && classStart !== -1) {
      const contentStart = classStart + (pattern[classStart + 1] === '^' ? 2 : 1)
      if (index === contentStart) return null
      classes.push(pattern.slice(classStart, index + 1))
      classStart = -1
      previousToken = 'literal'
      continue
    } else if (classStart !== -1) {
      if (['&&', '--', '~~'].includes(pattern.slice(index, index + 2))) return null
      continue
    } else if (character === '(' && pattern[index + 1] === '?') {
      if (pattern[index + 2] !== ':') return null
      index += 2
    } else if (character === '{') {
      // Rust reads `{n}` with nothing before it as literal text. JavaScript rejects it.
      // The flags service rejects repetition counts above 4,294,967,295. JavaScript accepts them.
      const repetition = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(index))
      if (
        !repetition ||
        ['', '|', '('].includes(previousToken) ||
        repetition.slice(1).some((count) => Number(count) > 0xffffffff)
      ) {
        return null
      }
    } else if ('*+?}'.includes(character) && (pattern[index + 1] === '+' || pattern[index + 1] === '{')) {
      return null
    }
    // JavaScript rejects a repeated anchor such as `^?`. Rust accepts it.
    // Rust rejects a repeated empty group such as `(?:)*`. JavaScript accepts it.
    if ('*+?{'.includes(character) && ['^', '$', 'empty group'].includes(previousToken)) return null
    previousToken = character === ')' && ['(', 'empty group'].includes(previousToken) ? 'empty group' : character
  }
  return classes
}

// Adapters must preserve regex uncertainty across variant rules without changing missing-context fallback.
function regexRequiresServerEvaluation(message: string): InconclusiveMatchError {
  const error = new InconclusiveMatchError(message)
  Object.defineProperty(error, Symbol.for('posthog.requiresServerRegexEvaluation'), { value: true })
  return error
}

function matchFeatureFlagRegex(pattern: string, value: string): boolean | null {
  if (pattern === '') return true

  // Rust uses Unicode scalar semantics and additional syntax. Keep local matching to the shared ASCII subset.
  const characterClasses = getPortableRegexClasses(pattern)
  if (characterClasses === null) {
    throw regexRequiresServerEvaluation('Regex syntax requires server evaluation')
  }

  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw regexRequiresServerEvaluation('Regex compilation requires server evaluation')
  }
  for (const characterClass of characterClasses) {
    try {
      // Strict parsing rejects legacy JS ranges such as [\s-9], which the flags service does not accept.
      new RegExp(characterClass, 'u')
    } catch {
      throw regexRequiresServerEvaluation('Regex character class syntax requires server evaluation')
    }
  }
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (character.charCodeAt(0) > 0x7f || character === '\r') {
      throw regexRequiresServerEvaluation('Regex matching for Unicode or carriage returns requires server evaluation')
    }
  }
  try {
    return regex.test(value)
  } catch {
    throw regexRequiresServerEvaluation('Regex execution requires server evaluation')
  }
}

// The flags service deliberately folds only ASCII for substring, prefix, and suffix operators.
function asciiLowercase(value: unknown): string {
  return String(value).replace(/[A-Z]/g, (character) => character.toLowerCase())
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

function parseDateFilter(value: FeatureFlagPropertyValue): Date {
  if (typeof value === 'boolean') {
    throw new InconclusiveMatchError('Date operations cannot be performed on boolean values')
  }
  return relativeDateParseForFeatureFlagMatching(String(value)) ?? convertToDateTime(value)
}

/**
 * Throws an unsupported_definition error when local evaluation cannot use the filter, whatever
 * the context holds: an unknown operator, or a filter value that the operator cannot parse.
 */
export function assertFeatureFlagFilterSupported(
  property: FeatureFlagProperty,
  options: Pick<MatchFeatureFlagPropertyOptions, 'semverParsingPolicy'> = {}
): void {
  const value = property.value
  const parsingPolicy = options.semverParsingPolicy ?? 'strict'
  switch (property.operator || 'exact') {
    case 'exact':
    case 'is_not':
      for (const item of Array.isArray(value) ? value : [value]) {
        exactMatchString(item)
      }
      return
    case 'is_set':
    case 'is_not_set':
    case 'icontains':
    case 'not_icontains':
    case 'starts_with':
    case 'not_starts_with':
    case 'ends_with':
    case 'not_ends_with':
    case 'regex':
    case 'not_regex':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return
    case 'is_date_after':
    case 'is_date_before':
      parseDateFilter(value)
      return
    case 'semver_eq':
    case 'semver_neq':
    case 'semver_gt':
    case 'semver_gte':
    case 'semver_lt':
    case 'semver_lte':
      parseFeatureFlagSemver(String(value), parsingPolicy)
      return
    case 'semver_tilde':
      computeTildeBounds(String(value), parsingPolicy)
      return
    case 'semver_caret':
      computeCaretBounds(String(value), parsingPolicy)
      return
    case 'semver_wildcard':
      computeWildcardBounds(String(value), parsingPolicy)
      return
    default:
      throw new InconclusiveMatchError(`Unknown operator: ${property.operator}`)
  }
}

export function matchFeatureFlagProperty(
  property: FeatureFlagProperty,
  propertyValues: Record<string, any>,
  options: MatchFeatureFlagPropertyOptions = {}
): boolean {
  try {
    return matchPropertyValue(property, propertyValues, options)
  } catch (e) {
    // An unusable filter outranks missing context, so check the filter before blaming the context.
    if (e instanceof InconclusiveMatchError && e.reason === 'missing_context') {
      assertFeatureFlagFilterSupported(property, options)
    }
    throw e
  }
}

function matchPropertyValue(
  property: FeatureFlagProperty,
  propertyValues: Record<string, any>,
  options: MatchFeatureFlagPropertyOptions
): boolean {
  const key = property.key
  const value = property.value
  const operator = property.operator || 'exact'
  const parsingPolicy = options.semverParsingPolicy ?? 'strict'

  const hasProperty = Object.prototype.hasOwnProperty.call(propertyValues, key)
  if (!hasProperty) {
    throw new InconclusiveMatchError(`Property ${key} not found in propertyValues`, 'missing_context')
  } else if (operator === 'is_not_set') {
    return false
  } else if (operator === 'is_set') {
    return true
  }

  const overrideValue = propertyValues[key]
  if (overrideValue === undefined) {
    options.warnFunction?.(`Property ${key} cannot have a value of undefined with the ${operator} operator`)
    // Undefined is omitted from JSON; partial local context cannot establish a remote value.
    throw new InconclusiveMatchError(`Property ${key} is undefined in propertyValues`)
  }
  if (overrideValue === null && !NULL_VALUES_ALLOWED_OPERATORS.includes(operator)) {
    options.warnFunction?.(`Property ${key} cannot have a value of null with the ${operator} operator`)
    return false
  }

  const computeExactMatch = (target: unknown, actual: unknown): boolean => {
    if (
      (options.propertyMatchingVersion !== 2 && isTruthyOrFalsyPropertyValue(target)) ||
      (Array.isArray(target) && target.length === 0)
    ) {
      readContextValue(() => assertJsonRepresentable(actual))
      return isTruthyPropertyValue(target) === isTruthyPropertyValue(actual)
    }
    // Neither integer nor integral-float spelling can equal a boolean-like filter. This
    // mismatch is conclusive without weakening the numeric ambiguity fallback below.
    if (options.propertyMatchingVersion === 2 && typeof actual === 'number' && isTruthyOrFalsyPropertyValue(target)) {
      readContextValue(() => assertJsonRepresentable(actual))
      return false
    }
    if (Array.isArray(target)) {
      const actualString = readContextValue(() => exactMatchString(actual)).toLowerCase()
      return target.some((item) => exactMatchString(item).toLowerCase() === actualString)
    }
    const targetString = exactMatchString(target).toLowerCase()
    return targetString === readContextValue(() => exactMatchString(actual)).toLowerCase()
  }

  const compare = (lhs: any, rhs: any, comparisonOperator: string): boolean => {
    if (comparisonOperator === 'gt') return lhs > rhs
    if (comparisonOperator === 'gte') return lhs >= rhs
    if (comparisonOperator === 'lt') return lhs < rhs
    if (comparisonOperator === 'lte') return lhs <= rhs
    throw new Error(`Invalid operator: ${comparisonOperator}`)
  }

  // Lazy, because only the semver operators may parse either side.
  const parseContextSemver = (): SemverTuple =>
    readContextValue(() => parseFeatureFlagSemver(String(overrideValue), parsingPolicy))
  // Parses the filter before the context, so a bad filter reports unsupported_definition even
  // when the context value is bad too.
  const compareContextSemverToFilter = (): number => {
    const filterParsed = parseFeatureFlagSemver(String(value), parsingPolicy)
    return compareSemverTuples(parseContextSemver(), filterParsed)
  }
  const isContextSemverWithin = ({ lower, upper }: { lower: SemverTuple; upper: SemverTuple }): boolean => {
    const overrideParsed = parseContextSemver()
    return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0
  }

  switch (operator) {
    case 'exact':
      return computeExactMatch(value, overrideValue)
    case 'is_not':
      return !computeExactMatch(value, overrideValue)
    case 'is_set':
      return true
    case 'icontains':
      return asciiLowercase(overrideValue).includes(asciiLowercase(value))
    case 'not_icontains':
      return !asciiLowercase(overrideValue).includes(asciiLowercase(value))
    case 'starts_with':
      return asciiLowercase(overrideValue).startsWith(asciiLowercase(value))
    case 'not_starts_with':
      return !asciiLowercase(overrideValue).startsWith(asciiLowercase(value))
    case 'ends_with':
      return asciiLowercase(overrideValue).endsWith(asciiLowercase(value))
    case 'not_ends_with':
      return !asciiLowercase(overrideValue).endsWith(asciiLowercase(value))
    case 'regex':
    case 'not_regex': {
      const matched = matchFeatureFlagRegex(String(value), String(overrideValue))
      if (matched === null) return false
      return operator === 'regex' ? matched : !matched
    }
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
      const parsedDate = parseDateFilter(value)
      const overrideDate = readContextValue(() => convertToDateTime(overrideValue))
      return operator === 'is_date_before' ? overrideDate < parsedDate : overrideDate > parsedDate
    }
    case 'semver_eq':
      return compareContextSemverToFilter() === 0
    case 'semver_neq':
      return compareContextSemverToFilter() !== 0
    case 'semver_gt':
      return compareContextSemverToFilter() > 0
    case 'semver_gte':
      return compareContextSemverToFilter() >= 0
    case 'semver_lt':
      return compareContextSemverToFilter() < 0
    case 'semver_lte':
      return compareContextSemverToFilter() <= 0
    case 'semver_tilde':
      return isContextSemverWithin(computeTildeBounds(String(value), parsingPolicy))
    case 'semver_caret':
      return isContextSemverWithin(computeCaretBounds(String(value), parsingPolicy))
    case 'semver_wildcard':
      return isContextSemverWithin(computeWildcardBounds(String(value), parsingPolicy))
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

export async function getFeatureFlagHash(
  key: string,
  bucketingValue: string,
  salt: string = '',
  separator: string = '.'
): Promise<number> {
  const hashString = await hashSHA1(`${key}${separator}${bucketingValue}${salt}`)
  return parseInt(hashString.slice(0, 15), 16) / LONG_SCALE
}

/**
 * The `holdout-<id>` variant this bucketing value is held out into, or undefined.
 *
 * The separator is the whole point: the server hashes `holdout-<value>`, while flag rollout
 * hashing joins with a dot. Taking the default separator here would still look uniform and
 * deterministic while holding out a different set of people than the server does.
 */
export async function getHoldoutVariant(
  holdout: { id: number; exclusion_percentage: number } | null | undefined,
  bucketingValue: string
): Promise<string | undefined> {
  // Loose null checks on purpose: the payload can carry an explicit null for either field, and
  // a null id would otherwise reach the template below and produce the variant `holdout-null`.
  if (holdout == null || holdout.id == null || holdout.exclusion_percentage == null) {
    return undefined
  }

  // A non-numeric percentage would clamp to NaN, and `hash > NaN` is false for every hash, which
  // holds out everyone. The server deserializes this field as a float, so it rejects the value
  // instead; treat it as no holdout rather than the most damaging reading.
  const rawPercentage = Number(holdout.exclusion_percentage)
  if (!Number.isFinite(rawPercentage)) {
    return undefined
  }

  // Clamped because the server clamps rather than rejects. The 100 short-circuit mirrors the
  // server's is_in_rollout and skips a digest that cannot change the answer.
  const percentage = Math.min(Math.max(rawPercentage, 0), 100)
  if (percentage !== 100) {
    const hash = await getFeatureFlagHash('holdout', bucketingValue, '', '-')
    if (hash > percentage / 100) {
      return undefined
    }
  }

  return `holdout-${holdout.id}`
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
