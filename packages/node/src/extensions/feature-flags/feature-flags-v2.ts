import { hashSHA1, InconclusiveMatchError, matchFeatureFlagProperty } from '@posthog/core'
import type { FeatureFlagDetail, FeatureFlagValue, JsonType, UnresolvedFlagReason } from '@posthog/core'

import { parsedFlagRecordOf, readFlagRecords } from '../../flags-response'
import type { FlagRecordValue, ParsedFlagRecord } from '../../flags-response'
import type { PostHogFeatureFlag } from '../../types'

/**
 * Local evaluation of feature flags whose `filters.version` is 2.
 *
 * The poller calls {@link evaluateConfigV2Definition} for every loaded definition whose config
 * version is not 1. Nothing in this module is exported from the package.
 *
 * A config version 2 flag holds an ordered list of rules. The first rule whose targeting matches
 * decides the result, unless its rollout misses and the rule says to continue. The flags service
 * is the reference for every result this module returns, and the evaluator matches
 * posthog-python's local evaluator.
 *
 * {@link parseConfigV2} reads a `filters` document. The parser is closed: an unknown config
 * version, rule type, property type, operator or field rejects the whole document, so a document
 * is never partly evaluated. {@link evaluateConfigV2} returns exactly one of:
 *
 * - `evaluated`: the value, its reason code and the rule that produced it.
 * - `inconclusive`: a rule's targeting needs something the evaluator does not have, such as a
 *   person property the caller did not pass. Evaluation stops there. It does not skip the rule to
 *   try a later one, because an earlier rule that matches is terminal.
 * - `unsupported`: the parser rejected the document.
 * - `error`: a property value or a regular expression is invalid.
 *
 * None of them is a guess. A caller that cannot use the result must fall back to the flags
 * service, not to `false` or to the flag default. {@link evaluateConfigV2Definition} does that for
 * the poller: it turns a result into the record a `/flags?v=4` response gives, and anything else
 * into the unresolved reason of the poller's fallback.
 *
 * Regular expressions use the matcher of the version 1 evaluator, which runs a pattern locally
 * only in the subset where JavaScript and the flags service agree. Text comparisons read a value
 * as the JSON text the flags service compares. JavaScript reads the JSON numbers `7` and `7.0` as
 * one number, but the flags service compares their text, so an integral number in a filter that
 * compares text is undecided here. A number the caller passes is sent as JSON, so it is read as
 * an integer when it is one. Where JavaScript cannot reproduce the flags service, such as a date
 * in a form only the service reads, the result is inconclusive.
 */

const CONFIG_VERSION = 2
const ASSIGNMENT_ALGORITHM = 'sha1_60_v1'
// The 60-bit hash range. As a binary64 literal it rounds to 2^60, as the flags service's does.
// oxlint-disable-next-line no-loss-of-precision
const HASH_SCALE = 0xfffffffffffffff
// An identifier is cut to this many Unicode scalar values before it is hashed.
const MAX_IDENTIFIER_LENGTH = 200

const MAX_RULES = 100
const MAX_PREDICATES = 100
const MIN_VARIANTS = 2
const MAX_VARIANTS = 20
const MAX_SEED_LENGTH = 400
const MAX_OBJECT_DEPTH = 20
// The reference's JSON reader gives up on deeper nesting.
const MAX_JSON_DEPTH = 127
const MAX_U64 = BigInt('18446744073709551615')

const CONFIG_FIELDS = new Set(['version', 'return_type', 'default_value', 'rules', 'aggregation_group_type_index'])
const RULE_FIELDS = ['id', 'rule_type', 'targeting', 'description', 'metadata']
const ROLLOUT_FIELDS = ['rollout_percentage', 'on_rollout_miss', 'assignment_algorithm', 'seed', 'assign_by']
const FIELDS_BY_RULE_TYPE: Readonly<Record<string, ReadonlySet<string>>> = {
  targeted_release: new Set([...RULE_FIELDS, 'value']),
  percentage_rollout: new Set([...RULE_FIELDS, ...ROLLOUT_FIELDS, 'value']),
  experiment: new Set([...RULE_FIELDS, ...ROLLOUT_FIELDS, 'paused', 'variants', 'holdout']),
}
const VARIANT_FIELDS = new Set(['key', 'weight', 'value'])
const HOLDOUT_FIELDS = new Set(['seed', 'exclusion_percentage'])
const TARGETING_FIELDS = new Set(['properties'])
const PROPERTY_FIELDS = new Set([
  'key',
  'type',
  'value',
  'operator',
  'negation',
  'group_type_index',
  'cohort_name',
  'group_key_names',
  'label',
])
// Property types the configuration format defines but this evaluator does not read.
const UNSUPPORTED_PROPERTY_TYPES = new Set(['cohort', 'group', 'flag'])

const EXACT_OPERATORS = new Set(['exact', 'is_not'])
const PRESENCE_OPERATORS = new Set(['is_set', 'is_not_set'])
const TEXT_OPERATORS = new Set([
  'icontains',
  'not_icontains',
  'starts_with',
  'not_starts_with',
  'ends_with',
  'not_ends_with',
])
const MULTI_TEXT_OPERATORS = new Set(['icontains_multi', 'not_icontains_multi'])
const REGEX_OPERATORS = new Set(['regex', 'not_regex'])
const NUMBER_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte'])
const SEMVER_COMPARISON_OPERATORS = new Set([
  'semver_eq',
  'semver_neq',
  'semver_gt',
  'semver_gte',
  'semver_lt',
  'semver_lte',
])
const SEMVER_RANGE_OPERATORS = new Set(['semver_tilde', 'semver_caret', 'semver_wildcard'])
const DATE_OPERATORS = new Set(['is_date_exact', 'is_date_after', 'is_date_before'])
const OPERATORS: ReadonlySet<string> = new Set([
  ...EXACT_OPERATORS,
  ...PRESENCE_OPERATORS,
  ...TEXT_OPERATORS,
  ...MULTI_TEXT_OPERATORS,
  ...REGEX_OPERATORS,
  ...NUMBER_OPERATORS,
  ...SEMVER_COMPARISON_OPERATORS,
  ...SEMVER_RANGE_OPERATORS,
  ...DATE_OPERATORS,
])
// The operators that match a person who does not have the property.
const OPERATORS_MATCHING_ABSENCE: ReadonlySet<string> = new Set([
  'is_not',
  'not_icontains',
  'not_starts_with',
  'not_ends_with',
  'not_icontains_multi',
  'not_regex',
])

// --- Results -------------------------------------------------------------------------------

/**
 * The flag has a result. `value` is the typed flag value, or `null` when the flag has no value and
 * the caller's default applies. An object value is the configuration's own object, so it must not
 * be changed. The rule fields name the rule that ended the evaluation, and are absent when no rule
 * did. They are the fields a `/flags?v=4` record carries in `reason` and `metadata`.
 */
export type ConfigV2Evaluated = {
  readonly outcome: 'evaluated'
  readonly value: FlagRecordValue
  readonly reason: string
  readonly ruleId?: string
  readonly ruleType?: string
  readonly ruleIndex?: number
  readonly variantKey?: string
}

/** A rule that evaluation reached could not be decided. */
export type ConfigV2Inconclusive = {
  readonly outcome: 'inconclusive'
  readonly reason: UnresolvedFlagReason
  readonly detail: string
}

/**
 * The parser rejected the document. `kind` is `malformed` for a document that breaks the
 * configuration format, and `unsupported` for a format this evaluator does not read. `field` names
 * what was rejected.
 */
export type ConfigV2Unsupported = {
  readonly outcome: 'unsupported'
  readonly kind: 'malformed' | 'unsupported'
  readonly field: string
}

/** Evaluation reached an invalid value. */
export type ConfigV2EvaluationError = {
  readonly outcome: 'error'
  readonly kind: 'invalid_property' | 'invalid_regex'
  readonly detail: string
}

export type ConfigV2Outcome = ConfigV2Evaluated | ConfigV2Inconclusive | ConfigV2Unsupported | ConfigV2EvaluationError

/** Ends an evaluation with an outcome that is not a value. */
class Halt extends Error {
  constructor(readonly result: ConfigV2Inconclusive | ConfigV2EvaluationError) {
    super(result.detail)
  }
}

function unusableContext(detail: string): Halt {
  return new Halt({ outcome: 'inconclusive', reason: 'missing_context', detail })
}

function invalidProperty(detail: string): Halt {
  return new Halt({ outcome: 'error', kind: 'invalid_property', detail })
}

// --- Configuration -------------------------------------------------------------------------

type Operand = number | VersionKey | Requirement | DateValue | null

/**
 * One property filter of a rule. `value` is the filter value as stored. `operand` is what a
 * number, semver or date operator compares with, read from `value` once by the parser.
 */
type Predicate = {
  readonly key: string
  readonly operator: string
  readonly value: unknown
  readonly negation: boolean
  readonly operand: Operand
}

type Rollout = {
  readonly percentage: number
  readonly returnDefaultOnMiss: boolean
  readonly seed: string
}

type Variant = {
  readonly key: string
  readonly weight: number
  readonly value: FlagRecordValue
}

type Holdout = {
  readonly seed: string
  readonly exclusionPercentage: number
}

type Rule =
  | {
      readonly ruleType: 'targeted_release'
      readonly id: string
      readonly targeting: readonly Predicate[]
      readonly value: FlagRecordValue
    }
  | {
      readonly ruleType: 'percentage_rollout'
      readonly id: string
      readonly targeting: readonly Predicate[]
      readonly value: FlagRecordValue
      readonly rollout: Rollout
    }
  | {
      readonly ruleType: 'experiment'
      readonly id: string
      readonly targeting: readonly Predicate[]
      readonly paused: boolean
      readonly rollout: Rollout
      readonly variants: readonly Variant[]
      readonly holdout: Holdout | undefined
    }

/**
 * A parsed `filters` document. `defaultValue` is `null` for a null default. `comparesDates` says
 * whether a rule has a date filter, so that evaluating the document can need the current time.
 */
export type ConfigV2 = {
  readonly defaultValue: FlagRecordValue
  readonly rules: readonly Rule[]
  readonly comparesDates: boolean
}

/**
 * What a flag is evaluated for.
 *
 * - `identifier`: the person's resolved targeting key, as a string.
 * - `properties`: the person properties, or `null` when there are none to read. A key whose value
 *   is `undefined`, a function or a symbol is absent, as it is from the JSON a remote request
 *   sends.
 * - `propertiesComplete`: whether `properties` holds every property of the person. A complete map
 *   shows that a property is absent. A partial map does not, so a filter on a key it lacks is
 *   inconclusive.
 * - `explicitExactMatching`: the project's setting for the `exact` and `is_not` operators. When
 *   false, a filter value that looks like a boolean matches by truthiness.
 * - `timeZone`: the project's timezone, as an IANA name. Dates without a UTC offset and relative
 *   dates are read in it. Absent, a filter that needs it is inconclusive.
 * - `now`: the time relative dates count back from. Absent, the current time, read once per
 *   evaluation.
 */
export type ConfigV2Context = {
  readonly identifier: string
  readonly properties: Readonly<Record<string, unknown>> | null
  readonly propertiesComplete: boolean
  readonly explicitExactMatching: boolean
  readonly timeZone?: string
  readonly now?: Date
}

/** Draws the hash of one use: `rollout`, `variant` or `holdout`. */
export type ConfigV2Draw = (use: HashUse, seed: string, subject: string) => number | Promise<number>
export type HashUse = 'rollout' | 'variant' | 'holdout'

// --- Parser ----------------------------------------------------------------------------------

class Rejected extends Error {
  constructor(
    readonly kind: 'malformed' | 'unsupported',
    readonly field: string
  ) {
    super(field)
  }
}

const malformed = (field: string): Rejected => new Rejected('malformed', field)
const unsupported = (field: string): Rejected => new Rejected('unsupported', field)

/**
 * Reads the `filters` document of a flag as config version 2.
 *
 * The document is the decoded JSON. Three things the reference rejects in the JSON text cannot be
 * seen here: a repeated object key, a nonzero number that rounds to zero, and a percentage written
 * with more than two decimals that rounds to a two-decimal value. The parser never changes the
 * document.
 */
export function parseConfigV2(filters: unknown): ConfigV2 | ConfigV2Unsupported {
  try {
    return readConfig(filters)
  } catch (error) {
    if (error instanceof Rejected) {
      return { outcome: 'unsupported', kind: error.kind, field: error.field }
    }
    throw error
  }
}

/** Whether a parse result is a rejected document. */
export function isConfigV2Unsupported(config: ConfigV2 | ConfigV2Unsupported): config is ConfigV2Unsupported {
  return 'outcome' in config
}

const hasOwn = (target: object, field: string): boolean => Object.prototype.hasOwnProperty.call(target, field)

function readConfig(filters: unknown): ConfigV2 {
  const document = object(filters, 'filters')
  const version = optional(document, 'version')
  if (!isNumber(version) || version !== CONFIG_VERSION) {
    throw unsupported('version')
  }
  checkJson(document)
  checkClosed(document, CONFIG_FIELDS, 'filters')
  const returnType = string(document, 'return_type')
  if (!hasOwn(VALUE_CHECKS, returnType)) {
    throw malformed('return_type')
  }
  if (hasOwn(document, 'aggregation_group_type_index')) {
    const group = document.aggregation_group_type_index
    if (!isNumber(group) || !Number.isInteger(group)) {
      throw malformed('aggregation_group_type_index')
    }
    throw unsupported('aggregation_group_type_index')
  }
  const defaultValue = required(document, 'default_value')
  if (defaultValue !== null && !VALUE_CHECKS[returnType](defaultValue)) {
    throw malformed('default_value')
  }
  const rules = array(document, 'rules', MAX_RULES).map((rule) => readRule(rule, returnType))
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
    throw malformed('rule.id')
  }
  const comparesDates = rules.some((rule) => rule.targeting.some((predicate) => DATE_OPERATORS.has(predicate.operator)))
  return { defaultValue: defaultValue as FlagRecordValue, rules, comparesDates }
}

/** Rejects values that the reference's JSON reader does not produce. */
function checkJson(document: unknown): void {
  const pending: [unknown, number][] = [[document, 1]]
  while (pending.length > 0) {
    const [value, depth] = pending.pop()!
    if (Array.isArray(value) || isJsonObject(value)) {
      if (depth > MAX_JSON_DEPTH) {
        throw malformed('filters')
      }
      if (Array.isArray(value)) {
        // A hole reads as undefined, which is not a JSON value.
        for (let index = 0; index < value.length; index++) {
          pending.push([value[index], depth + 1])
        }
      } else {
        for (const key of Object.keys(value)) {
          if (!isText(key)) {
            throw malformed('filters')
          }
          pending.push([value[key], depth + 1])
        }
      }
    } else if (!isJsonScalar(value)) {
      throw malformed('filters')
    }
  }
}

function isJsonScalar(value: unknown): boolean {
  if (value === null || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'string') {
    return isText(value)
  }
  return typeof value === 'number' && Number.isFinite(value)
}

/** Whether a string holds only Unicode scalar values, so no lone surrogate. */
function isText(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false
      }
      index++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

/** An object as JSON reads it: not an array, a class instance or a `Date`. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value)

function object(value: unknown, field: string): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw malformed(field)
  }
  return value
}

function required(mapping: Record<string, unknown>, field: string): unknown {
  if (!hasOwn(mapping, field)) {
    throw malformed(field)
  }
  return mapping[field]
}

function optional(mapping: Record<string, unknown>, field: string): unknown {
  return hasOwn(mapping, field) ? mapping[field] : undefined
}

function string(mapping: Record<string, unknown>, field: string): string {
  const value = required(mapping, field)
  if (typeof value !== 'string') {
    throw malformed(field)
  }
  return value
}

function array(mapping: Record<string, unknown>, field: string, limit: number): unknown[] {
  const value = required(mapping, field)
  if (!Array.isArray(value) || value.length > limit) {
    throw malformed(field)
  }
  return value
}

function checkClosed(mapping: Record<string, unknown>, fields: ReadonlySet<string>, field: string): void {
  if (Object.keys(mapping).some((key) => !fields.has(key))) {
    throw malformed(field)
  }
}

const isSafeNumber = (value: unknown): boolean => isNumber(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER

const isObjectValue = (value: unknown): boolean => isJsonObject(value) && isNestedValue(value, 1)

/** Depth counts objects and arrays, with the returned object at level 1. */
function isNestedValue(value: unknown, depth: number): boolean {
  const items = Array.isArray(value) ? value : isJsonObject(value) ? Object.values(value) : undefined
  if (items !== undefined) {
    return depth <= MAX_OBJECT_DEPTH && items.every((item) => isNestedValue(item, depth + 1))
  }
  return !isNumber(value) || isSafeNumber(value)
}

// Whether a value is a non-null value of the flag's return type.
const VALUE_CHECKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  boolean: (value) => typeof value === 'boolean',
  string: (value) => typeof value === 'string' && value !== '',
  number: isSafeNumber,
  object: isObjectValue,
}

const RULE_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const VARIANT_KEY_PATTERN = /^[A-Za-z0-9_-]+$/

function readRule(value: unknown, returnType: string): Rule {
  const rule = object(value, 'rule')
  const ruleType = string(rule, 'rule_type')
  if (!hasOwn(FIELDS_BY_RULE_TYPE, ruleType)) {
    throw malformed('rule_type')
  }
  checkClosed(rule, FIELDS_BY_RULE_TYPE[ruleType], 'rule')
  let id = string(rule, 'id')
  if (!RULE_ID_PATTERN.test(id)) {
    throw malformed('rule.id')
  }
  id = id.toLowerCase()
  if (hasOwn(rule, 'description') && typeof rule.description !== 'string') {
    throw malformed('description')
  }
  if (hasOwn(rule, 'metadata') && !isJsonObject(rule.metadata)) {
    throw malformed('metadata')
  }
  const targeting = readTargeting(required(rule, 'targeting'))
  if (ruleType === 'targeted_release') {
    return { ruleType, id, targeting, value: typedValue(rule, returnType) }
  }
  if (ruleType === 'percentage_rollout') {
    const rollout = readRollout(rule)
    return { ruleType, id, targeting, value: typedValue(rule, returnType), rollout }
  }
  const paused = required(rule, 'paused')
  if (typeof paused !== 'boolean') {
    throw malformed('paused')
  }
  const rollout = readRollout(rule)
  const variants = readVariants(rule, returnType)
  const holdout = hasOwn(rule, 'holdout') ? readHoldout(rule.holdout) : undefined
  return { ruleType: 'experiment', id, targeting, paused, rollout, variants, holdout }
}

function typedValue(mapping: Record<string, unknown>, returnType: string): FlagRecordValue {
  const value = required(mapping, 'value')
  if (!VALUE_CHECKS[returnType](value)) {
    throw malformed('value')
  }
  return value as FlagRecordValue
}

function readRollout(rule: Record<string, unknown>): Rollout {
  if (string(rule, 'assignment_algorithm') !== ASSIGNMENT_ALGORITHM) {
    throw malformed('assignment_algorithm')
  }
  if (hasOwn(rule, 'assign_by') && rule.assign_by !== 'person') {
    throw malformed('assign_by')
  }
  const onRolloutMiss = string(rule, 'on_rollout_miss')
  if (onRolloutMiss !== 'continue' && onRolloutMiss !== 'return_default') {
    throw malformed('on_rollout_miss')
  }
  return {
    percentage: percentage(rule, 'rollout_percentage'),
    returnDefaultOnMiss: onRolloutMiss === 'return_default',
    seed: seed(rule),
  }
}

function percentage(mapping: Record<string, unknown>, field: string): number {
  const value = required(mapping, field)
  // A percentage has at most two decimals.
  if (!isNumber(value) || !(value >= 0 && value <= 100) || Number(value.toFixed(2)) !== value) {
    throw malformed(field)
  }
  return value
}

function seed(mapping: Record<string, unknown>): string {
  const value = string(mapping, 'seed')
  const length = codePointLength(value)
  if (length < 1 || length > MAX_SEED_LENGTH) {
    throw malformed('seed')
  }
  return value
}

function readVariants(rule: Record<string, unknown>, returnType: string): Variant[] {
  const items = array(rule, 'variants', MAX_VARIANTS)
  if (items.length < MIN_VARIANTS) {
    throw malformed('variants')
  }
  const variants = items.map((item) => readVariant(item, returnType))
  if (new Set(variants.map((variant) => variant.key)).size !== variants.length) {
    throw malformed('variant.key')
  }
  // Weights have two decimals, so whole hundredths add up exactly.
  if (variants.reduce((sum, variant) => sum + Math.floor(variant.weight * 100 + 0.5), 0) !== 10_000) {
    throw malformed('variants')
  }
  return variants
}

function readVariant(value: unknown, returnType: string): Variant {
  const variant = object(value, 'variant')
  checkClosed(variant, VARIANT_FIELDS, 'variant')
  const key = string(variant, 'key')
  if (!VARIANT_KEY_PATTERN.test(key)) {
    throw malformed('variant.key')
  }
  return { key, weight: percentage(variant, 'weight'), value: typedValue(variant, returnType) }
}

function readHoldout(value: unknown): Holdout {
  const holdout = object(value, 'holdout')
  checkClosed(holdout, HOLDOUT_FIELDS, 'holdout')
  return { seed: seed(holdout), exclusionPercentage: percentage(holdout, 'exclusion_percentage') }
}

function readTargeting(value: unknown): Predicate[] {
  const targeting = object(value, 'targeting')
  checkClosed(targeting, TARGETING_FIELDS, 'targeting')
  return array(targeting, 'properties', MAX_PREDICATES).map(readPredicate)
}

function readPredicate(value: unknown): Predicate {
  const prop = object(value, 'property')
  checkClosed(prop, PROPERTY_FIELDS, 'property')
  const propertyType = string(prop, 'type')
  if (UNSUPPORTED_PROPERTY_TYPES.has(propertyType)) {
    throw unsupported('property.type')
  }
  if (propertyType !== 'person') {
    throw malformed('property.type')
  }
  const key = string(prop, 'key')
  if (key === '') {
    throw malformed('property.key')
  }
  let operator = optional(prop, 'operator') ?? null
  if (operator === null) {
    operator = 'exact'
  } else if (typeof operator !== 'string' || !OPERATORS.has(operator)) {
    throw malformed('property.operator')
  }
  const negation = optional(prop, 'negation') ?? null
  if (negation !== null && typeof negation !== 'boolean') {
    throw malformed('property.negation')
  }
  checkUnreadFields(prop)
  const filterValue = optional(prop, 'value') ?? null
  return {
    key,
    operator: operator as string,
    value: filterValue,
    negation: negation === true,
    operand: readOperand(operator as string, filterValue),
  }
}

/** Checks the fields a person filter may carry but evaluation does not read. */
function checkUnreadFields(prop: Record<string, unknown>): void {
  if ((optional(prop, 'group_type_index') ?? null) !== null) {
    throw malformed('property.group_type_index')
  }
  for (const field of ['cohort_name', 'label']) {
    const value = optional(prop, field) ?? null
    if (value !== null && typeof value !== 'string') {
      throw malformed('property.presentation')
    }
  }
  const names = optional(prop, 'group_key_names') ?? null
  if (names !== null && !(isJsonObject(names) && Object.values(names).every((name) => typeof name === 'string'))) {
    throw malformed('property.group_key_names')
  }
}

/** Checks a filter value against its operator, and reads what the operator compares with. */
function readOperand(operator: string, value: unknown): Operand {
  if (NUMBER_OPERATORS.has(operator)) {
    if (typeof value === 'string' || isNumber(value)) {
      // A string that is not a number is an evaluation error, not a parse error.
      return toNumber(value)
    }
  } else if (SEMVER_COMPARISON_OPERATORS.has(operator) || SEMVER_RANGE_OPERATORS.has(operator)) {
    if (typeof value === 'string') {
      return readSemverFilter(operator, value)
    }
  } else if (DATE_OPERATORS.has(operator)) {
    if (typeof value === 'string') {
      return readDateFilter(value)
    }
  } else if (MULTI_TEXT_OPERATORS.has(operator)) {
    if (Array.isArray(value)) {
      return null
    }
  } else if (REGEX_OPERATORS.has(operator) || TEXT_OPERATORS.has(operator)) {
    if (typeof value === 'string') {
      return null
    }
  } else {
    return null
  }
  throw malformed('property.value')
}

// --- Evaluation ------------------------------------------------------------------------------

/**
 * Evaluates a parsed flag for one person. `active` is the flag's own `active` field. An inactive
 * flag has no value, with the reason `flag_disabled`, whatever its document holds.
 */
export function evaluateConfigV2(
  config: ConfigV2 | ConfigV2Unsupported,
  context: ConfigV2Context,
  options: { active?: boolean } = {}
): Promise<ConfigV2Outcome> {
  return evaluateConfigV2WithHash(config, context, drawHash, options)
}

/**
 * Test seam: `draw(use, seed, subject)` replaces every hash an evaluation draws.
 *
 * @internal
 */
export async function evaluateConfigV2WithHash(
  config: ConfigV2 | ConfigV2Unsupported,
  context: ConfigV2Context,
  draw: ConfigV2Draw,
  { active = true }: { active?: boolean } = {}
): Promise<ConfigV2Outcome> {
  if (!active) {
    return { outcome: 'evaluated', value: null, reason: 'flag_disabled' }
  }
  if (isConfigV2Unsupported(config)) {
    return config
  }
  if (context.now === undefined && config.comparesDates) {
    // Every relative date of one evaluation counts back from the same time.
    context = { ...context, now: new Date() }
  }
  const draws = new Draws(truncateIdentifier(context.identifier), draw)
  try {
    for (let index = 0; index < config.rules.length; index++) {
      const rule = config.rules[index]
      if (!rule.targeting.every((predicate) => matches(predicate, context))) {
        continue
      }
      const result = await applyRule(rule, index, config.defaultValue, draws)
      if (result !== undefined) {
        return result
      }
      // The rollout missed and the rule says to continue.
    }
  } catch (error) {
    if (error instanceof Halt) {
      return error.result
    }
    if (error instanceof InconclusiveMatchError) {
      // The version 1 regular expression matcher leaves the pattern or the value to the server.
      return { outcome: 'inconclusive', reason: error.reason, detail: error.message }
    }
    throw error
  }
  return { outcome: 'evaluated', value: config.defaultValue, reason: 'no_rule_match' }
}

/** The result of a rule whose targeting matched, or `undefined` to try the next rule. */
async function applyRule(
  rule: Rule,
  index: number,
  defaultValue: FlagRecordValue,
  draws: Draws
): Promise<ConfigV2Evaluated | undefined> {
  const result = (reason: string, value: FlagRecordValue, variantKey?: string): ConfigV2Evaluated => ({
    outcome: 'evaluated',
    value,
    reason,
    ruleId: rule.id,
    ruleType: rule.ruleType,
    ruleIndex: index,
    ...(variantKey !== undefined ? { variantKey } : {}),
  })

  if (rule.ruleType === 'targeted_release') {
    return result('targeting_match', rule.value)
  }
  if (rule.ruleType === 'experiment') {
    // A paused rule and a holdout are terminal whatever the rule says about a miss.
    if (rule.paused) {
      return result('experiment_paused', defaultValue)
    }
    const holdout = rule.holdout
    if (holdout !== undefined && (await draws.includes('holdout', holdout.seed, holdout.exclusionPercentage))) {
      return result('holdout', defaultValue)
    }
  }
  const rollout = rule.rollout
  if (await draws.includes('rollout', rollout.seed, rollout.percentage)) {
    if (rule.ruleType === 'percentage_rollout') {
      return result('targeting_match', rule.value)
    }
    const variant = selectVariant(await draws.draw('variant', rollout.seed), rule.variants)
    return result('experiment_split', variant.value, variant.key)
  }
  if (rollout.returnDefaultOnMiss) {
    return result('rollout_miss', defaultValue)
  }
  return undefined
}

// --- Hashing -------------------------------------------------------------------------------

/** The `sha1_60_v1` hash: the first 60 bits of a SHA-1 digest, scaled to 0..1. */
export async function hash01(prefix: string, identifier: string, salt: string): Promise<number> {
  const digest = await hashSHA1(prefix + identifier + salt)
  // Both operands are binary64 before the one division.
  return parseInt(digest.slice(0, 15), 16) / HASH_SCALE
}

function drawHash(use: HashUse, seed: string, subject: string): Promise<number> {
  if (!isText(subject)) {
    // UTF-8 has no encoding for a lone surrogate, so the flags service never hashes one.
    throw unusableContext('The identifier is not valid Unicode, so it cannot be hashed')
  }
  if (use === 'holdout') {
    // No ".": the seed is the whole prefix.
    return hash01(seed, subject, '')
  }
  return hash01(`${seed}.`, subject, use === 'variant' ? 'variant' : '')
}

/** 100 percent includes without hashing. Below it, the comparison is inclusive. */
export async function inRollout(percentage: number, draw: () => number | Promise<number>): Promise<boolean> {
  return percentage === 100 || (await draw()) <= percentage / 100
}

/** Boundaries add left to right. Past the last one, the last variant wins. */
export function selectVariant<T extends { readonly weight: number }>(hash: number, variants: readonly T[]): T {
  let boundary = 0
  for (const variant of variants) {
    boundary += variant.weight / 100
    if (hash < boundary) {
      return variant
    }
  }
  return variants[variants.length - 1]
}

/** Cuts an identifier to its first 200 Unicode scalar values, as the flags service does. */
export function truncateIdentifier(identifier: string): string {
  return codePointLength(identifier) <= MAX_IDENTIFIER_LENGTH
    ? identifier
    : Array.from(identifier).slice(0, MAX_IDENTIFIER_LENGTH).join('')
}

function codePointLength(value: string): number {
  let length = 0
  for (const _ of value) {
    length++
  }
  return length
}

/** The hashes one evaluation draws for its subject. */
class Draws {
  constructor(
    private readonly subject: string,
    private readonly drawHash: ConfigV2Draw
  ) {}

  draw(use: HashUse, seed: string): number | Promise<number> {
    return this.drawHash(use, seed, this.subject)
  }

  // An empty subject never enters a rollout or a holdout, so it is never hashed.
  async includes(use: HashUse, seed: string, percentage: number): Promise<boolean> {
    return this.subject !== '' && (await inRollout(percentage, () => this.draw(use, seed)))
  }
}

// --- Property matching ---------------------------------------------------------------------

/** Whether a predicate holds for the person, after its negation. */
function matches(predicate: Predicate, context: ConfigV2Context): boolean {
  const properties = context.properties
  if (properties === null || properties === undefined) {
    throw unusableContext('No person properties were passed')
  }
  const present = hasOwn(properties, predicate.key) && isKeptByJson(properties[predicate.key])
  if (!present && !context.propertiesComplete) {
    throw unusableContext(`The person property '${predicate.key}' was not passed`)
  }
  // An invalid pattern is an error even when the person lacks the property, and negation does
  // not turn it into a match.
  if (REGEX_OPERATORS.has(predicate.operator) && !isValidPattern(predicate.value as string)) {
    throw new Halt({
      outcome: 'error',
      kind: 'invalid_regex',
      detail: `The pattern for '${predicate.key}' is not valid`,
    })
  }
  const matched = matchOperator(predicate, present, present ? properties[predicate.key] : undefined, context)
  return matched !== predicate.negation
}

/** Whether JSON keeps an object member with this value. It leaves out `undefined`, functions and symbols. */
function isKeptByJson(value: unknown): boolean {
  return value !== undefined && typeof value !== 'function' && typeof value !== 'symbol'
}

function matchOperator(predicate: Predicate, present: boolean, value: unknown, context: ConfigV2Context): boolean {
  const operator = predicate.operator
  if (PRESENCE_OPERATORS.has(operator)) {
    return operator === 'is_set' ? present : !present
  }
  if (predicate.value === null) {
    return false
  }
  if (!present) {
    return OPERATORS_MATCHING_ABSENCE.has(operator)
  }
  if (EXACT_OPERATORS.has(operator)) {
    const matched = matchExact(predicate.value, value, context.explicitExactMatching)
    return operator === 'exact' ? matched : !matched
  }
  if (TEXT_OPERATORS.has(operator)) {
    return matchText(operator, predicate.value as string, value)
  }
  if (MULTI_TEXT_OPERATORS.has(operator)) {
    return matchAnySubstring(predicate, value)
  }
  if (REGEX_OPERATORS.has(operator)) {
    const found = matchPattern(predicate.value as string, jsonText(value, 'missing_context'))
    return operator === 'regex' ? found : !found
  }
  if (NUMBER_OPERATORS.has(operator)) {
    return matchNumber(predicate, value)
  }
  if (DATE_OPERATORS.has(operator)) {
    return matchDate(predicate, value, context)
  }
  return matchSemver(predicate, value)
}

function matchExact(filterValue: unknown, value: unknown, explicitExactMatching: boolean): boolean {
  const valueText = jsonText(value, 'missing_context').toLowerCase()
  // An empty filter keeps recursive truthiness in both matching modes.
  if (Array.isArray(filterValue) && filterValue.length === 0) {
    return isTruthy(value)
  }
  if (!explicitExactMatching && isTruthyOrFalsy(filterValue)) {
    return isTruthy(filterValue) === isTruthy(value)
  }
  if (Array.isArray(filterValue)) {
    return filterValue
      .map((candidate) => jsonText(candidate, 'unsupported_definition').toLowerCase())
      .includes(valueText)
  }
  return jsonText(filterValue, 'unsupported_definition').toLowerCase() === valueText
}

function isTruthyOrFalsy(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    return lower === 'true' || lower === 'false'
  }
  return Array.isArray(value) && value.every(isTruthyOrFalsy)
}

function isTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true'
  }
  return Array.isArray(value) && value.every(isTruthy)
}

function matchText(operator: string, filterValue: string, value: unknown): boolean {
  const valueText = asciiLower(jsonText(value, 'missing_context'))
  const filterText = asciiLower(filterValue)
  let matched: boolean
  if (operator === 'icontains' || operator === 'not_icontains') {
    matched = valueText.includes(filterText)
  } else if (operator === 'starts_with' || operator === 'not_starts_with') {
    matched = valueText.startsWith(filterText)
  } else {
    matched = valueText.endsWith(filterText)
  }
  return operator.startsWith('not_') ? !matched : matched
}

function matchAnySubstring(predicate: Predicate, value: unknown): boolean {
  const valueText = asciiLower(jsonText(value, 'missing_context'))
  let found = false
  for (const item of predicate.value as unknown[]) {
    if (valueText.includes(asciiLower(jsonText(item, 'unsupported_definition')))) {
      found = true
      break
    }
  }
  return predicate.operator === 'icontains_multi' ? found : !found
}

/** The flags service folds only ASCII letters for these operators. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase())
}

/**
 * Whether a pattern is valid. Throws `InconclusiveMatchError` for a pattern the version 1 matcher
 * leaves to the server, because JavaScript would read it differently.
 */
function isValidPattern(pattern: string): boolean {
  if (pattern === '') {
    return true
  }
  // The version 1 matcher throws here for a pattern outside the portable subset.
  matchPattern(pattern, '')
  try {
    new RegExp(pattern)
    return true
  } catch (error) {
    if (error instanceof SyntaxError) {
      return false
    }
    throw new InconclusiveMatchError('Regex compilation requires server evaluation', 'unsupported_definition')
  }
}

function matchPattern(pattern: string, text: string): boolean {
  return matchFeatureFlagProperty({ key: 'value', value: pattern, operator: 'regex' }, { value: text })
}

function matchNumber(predicate: Predicate, value: unknown): boolean {
  const number = toNumber(value)
  if (number === null) {
    throw invalidProperty(`The person property '${predicate.key}' is not a number`)
  }
  const operand = predicate.operand as number | null
  if (operand === null) {
    throw invalidProperty(`The filter value for '${predicate.key}' is not a number`)
  }
  switch (predicate.operator) {
    case 'gt':
      return number > operand
    case 'gte':
      return number >= operand
    case 'lt':
      return number < operand
    default:
      return number <= operand
  }
}

// The decimal numbers the reference reads from a string. JavaScript's `Number` also takes
// surrounding whitespace, hexadecimal and an empty string. Digits after the integer part follow a
// point, so a run of digits splits one way only and a failed match takes linear time.
const NUMBER_PATTERN = /^[+-]?(?:inf|infinity|nan|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?)$/i

function parseNumberText(text: string): number {
  const unsigned = text.replace(/^[+-]/, '').toLowerCase()
  if (unsigned === 'nan') {
    return NaN
  }
  if (unsigned === 'inf' || unsigned === 'infinity') {
    return text.startsWith('-') ? -Infinity : Infinity
  }
  return Number(text)
}

/** Reads a JSON number or a numeric string as binary64, or `null` for anything else. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'string') {
    return NUMBER_PATTERN.test(value) ? parseNumberText(value) : null
  }
  if (typeof value !== 'number') {
    if (value === null || typeof value === 'boolean' || Array.isArray(value) || isJsonObject(value)) {
      return null
    }
    throw unusableContext(`A property value of type ${describeType(value)} is not a JSON value`)
  }
  if (!Number.isFinite(value)) {
    throw unusableContext('A property value is not a finite number')
  }
  return value
}

function describeType(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return typeof value
  }
  return Object.getPrototypeOf(value)?.constructor?.name ?? 'object'
}

// --- JSON text -----------------------------------------------------------------------------

/**
 * A value as the JSON text the flags service compares. `reason` names the owner of the value:
 * `unsupported_definition` for a filter value, `missing_context` for a value the call passed.
 *
 * A string is its own text. Objects list their keys in code point order. An integral number from a
 * filter is undecided, because the JSON text may have been `7` or `7.0`. A number the call passed
 * is sent to the flags service as JSON, which writes an integral number as an integer.
 */
export function jsonText(value: unknown, reason: UnresolvedFlagReason): string {
  if (typeof value === 'string') {
    if (!isText(value)) {
      throw new InconclusiveMatchError('A string with a lone surrogate is not JSON text', reason)
    }
    return value
  }
  return jsonValueText(value, reason, 1)
}

/** Depth counts arrays and objects, with the outermost at level 1, as in `checkJson`. */
function jsonValueText(value: unknown, reason: UnresolvedFlagReason, depth: number): string {
  if ((Array.isArray(value) || isJsonObject(value)) && depth > MAX_JSON_DEPTH) {
    throw new InconclusiveMatchError('A value is nested too deeply to compare', reason)
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'string') {
    if (!isText(value)) {
      throw new InconclusiveMatchError('A string with a lone surrogate is not JSON text', reason)
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    return numberText(value, reason)
  }
  if (Array.isArray(value)) {
    const items: string[] = []
    for (let index = 0; index < value.length; index++) {
      items.push(jsonValueText(value[index], reason, depth + 1))
    }
    return `[${items.join(',')}]`
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort(compareCodePoints)
    return `{${keys
      .map((key) => `${jsonValueText(key, reason, depth + 1)}:${jsonValueText(value[key], reason, depth + 1)}`)
      .join(',')}}`
  }
  throw new InconclusiveMatchError(`A property value of type ${describeType(value)} is not a JSON value`, reason)
}

function numberText(value: number, reason: UnresolvedFlagReason): string {
  if (!Number.isFinite(value)) {
    throw new InconclusiveMatchError('A number that is not finite is not JSON text', reason)
  }
  if (Number.isInteger(value)) {
    if (reason !== 'missing_context' || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new InconclusiveMatchError(
        `The JSON text of ${value} may be an integer or a decimal, which the flags service compares differently`,
        reason
      )
    }
    return String(value)
  }
  return floatText(value)
}

/**
 * The text the flags service writes for a binary64 that is not an integer: the shortest digits
 * that read back as the same number, in decimal notation from 1e-5 up to 1e16, and otherwise with
 * an exponent, such as `1e-7`.
 */
function floatText(value: number): string {
  const [mantissa, exponentText] = Math.abs(value).toExponential().split('e')
  const digits = mantissa.replace('.', '')
  // The number is 0.digits * 10^point.
  const point = Number(exponentText) + 1
  let text: string
  if (point > 0 && point <= 16) {
    text =
      digits.length <= point
        ? `${digits}${'0'.repeat(point - digits.length)}.0`
        : `${digits.slice(0, point)}.${digits.slice(point)}`
  } else if (point > -5 && point <= 0) {
    text = `0.${'0'.repeat(-point)}${digits}`
  } else {
    const fraction = digits.length > 1 ? `.${digits.slice(1)}` : ''
    const exponent = point - 1
    text = `${digits[0]}${fraction}e${exponent >= 0 ? '+' : ''}${exponent}`
  }
  return value < 0 ? `-${text}` : text
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left)
  const rightPoints = Array.from(right)
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    const difference = leftPoints[index].codePointAt(0)! - rightPoints[index].codePointAt(0)!
    if (difference !== 0) {
      return difference
    }
  }
  return leftPoints.length - rightPoints.length
}

// --- Semantic versions -----------------------------------------------------------------------
//
// The reference compares versions with full semantic version ordering, so a pre-release sorts
// below its release, and a range matches a pre-release only when the range names one for the same
// version.

// What the reference trims from a version string: the Unicode White_Space characters.
const WHITESPACE = new Set(
  [
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
    0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  ].map((code) => String.fromCharCode(code))
)
const INTEGER = '(?:0|[1-9][0-9]*)'
const PRE_RELEASE_PART = `(?:${INTEGER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`
const PRE_RELEASE = `${PRE_RELEASE_PART}(?:\\.${PRE_RELEASE_PART})*`
const BUILD = '[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*'
const VERSION_PATTERN = new RegExp(
  `^(${INTEGER})\\.(${INTEGER})\\.(${INTEGER})(?:-(${PRE_RELEASE}))?(?:\\+(${BUILD}))?$`
)
// A version requirement: a version that may end early, or in wildcard components.
const REQUIREMENT_PATTERN = new RegExp(
  `^(?<major>${INTEGER})` +
    `(?:(?<anyMinor>\\.[xX*](?:\\.[xX*])?)` +
    `|\\.(?<minor>${INTEGER})` +
    `(?:(?<anyPatch>\\.[xX*])` +
    `|\\.(?<patch>${INTEGER})(?:-(?<pre>${PRE_RELEASE}))?(?:\\+${BUILD})?)?)?$`
)
const UNSIGNED_INTEGER_PATTERN = /^\+?([0-9]+)$/

type Version = {
  readonly major: bigint
  readonly minor: bigint
  readonly patch: bigint
  readonly pre: string
  readonly build: string
}

// A sort key: numbers, bigints, strings and nested keys, compared in order.
type SortKey = readonly (number | bigint | string | SortKey)[]
type VersionKey = { readonly kind: 'version'; readonly key: SortKey }

/** A version range. `minor` and `patch` are `null` where any number matches. */
type Requirement = {
  readonly kind: 'tilde' | 'caret' | 'wildcard'
  readonly major: bigint
  readonly minor: bigint | null
  readonly patch: bigint | null
  readonly pre: string
}

function compareKeys(left: SortKey, right: SortKey): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const a = left[index]
    const b = right[index]
    const difference =
      Array.isArray(a) && Array.isArray(b)
        ? compareKeys(a, b)
        : (a as number) < (b as number)
          ? -1
          : (a as number) > (b as number)
            ? 1
            : 0
    if (difference !== 0) {
      return difference
    }
  }
  return left.length - right.length
}

function isU64(digits: string): boolean {
  const significant = digits.replace(/^0+/, '')
  return significant.length <= 20 && BigInt(significant || '0') <= MAX_U64
}

function stripWhitespace(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && WHITESPACE.has(text[start])) {
    start++
  }
  while (end > start && WHITESPACE.has(text[end - 1])) {
    end--
  }
  return text.slice(start, end)
}

/**
 * Reads a version the way the reference does, or `null` when it is not one. One leading `v` is
 * dropped, a missing minor or patch number is zero, and leading zeros of the three numbers are
 * ignored.
 */
function parseVersion(text: string): Version | null {
  const match = VERSION_PATTERN.exec(canonicalVersion(trimVersion(text)))
  if (match === null || ![match[1], match[2], match[3]].every(isU64)) {
    return null
  }
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    pre: match[4] ?? '',
    build: match[5] ?? '',
  }
}

function trimVersion(text: string): string {
  return stripWhitespace(text.startsWith('v') ? text.slice(1) : text)
}

function canonicalVersion(version: string): string {
  const suffix = version.search(/[-+]/)
  const core = suffix === -1 ? version : version.slice(0, suffix)
  const parts = core.split('.').map(stripLeadingZeros)
  while (parts.length < 3) {
    parts.push('0')
  }
  return parts.join('.') + version.slice(core.length)
}

function stripLeadingZeros(part: string): string {
  if (!/^[0-9]+$/.test(part)) {
    return part
  }
  return part.replace(/^0+/, '') || '0'
}

/** Orders pre-releases: a release is above each of its pre-releases. */
function preReleaseKey(pre: string): SortKey {
  if (pre === '') {
    return [1]
  }
  // A numeric part is below a text part, and numeric parts compare as numbers.
  return [0, pre.split('.').map((part) => (/^[0-9]+$/.test(part) ? [0, part.length, part] : [1, part]))]
}

function buildKey(build: string): SortKey {
  return build.split('.').map((part) => {
    if (part === '' || /^[0-9]+$/.test(part)) {
      const digits = part.replace(/^0+/, '')
      return [0, digits.length, digits, part.length]
    }
    return [1, part]
  })
}

function versionKey(version: Version): SortKey {
  return [version.major, version.minor, version.patch, preReleaseKey(version.pre), buildKey(version.build)]
}

/**
 * Reads a semver filter value, or rejects the document.
 *
 * The result is the sort key of the version to compare with, or the range to match. It is `null`
 * for a wildcard that the configuration format admits but that is not a range, such as `1.2.3.*`.
 * Evaluation reports that as an invalid property.
 *
 * The format requires plain numbers before any pre-release suffix, so it does not admit everything
 * {@link parseVersion} reads, such as a leading `v`.
 */
function readSemverFilter(operator: string, text: string): VersionKey | Requirement | null {
  const admitted = operator === 'semver_wildcard' ? trimWildcards(text) : text
  const parsed = parseVersion(admitted)
  const numbers = admitted.split('-')[0].split('.').slice(0, 3)
  if (parsed === null || !numbers.every(isPlainNumber)) {
    throw malformed('property.value')
  }
  if (SEMVER_COMPARISON_OPERATORS.has(operator)) {
    return { kind: 'version', key: versionKey(parsed) }
  }
  const version = trimVersion(text)
  if (operator === 'semver_wildcard') {
    // The reference writes "*" as "x", which is a letter inside a pre-release.
    const parts = version.split('.').map(stripLeadingZeros)
    return parseRequirement(parts.join('.').replace(/\*/g, 'x'), null)
  }
  return parseRequirement(canonicalVersion(version), operator === 'semver_tilde' ? 'tilde' : 'caret')
}

/** Drops the trailing points and `*`. A loop, because the pattern `/[.*]+$/` is quadratic on a long run. */
function trimWildcards(text: string): string {
  let end = text.length
  while (end > 0 && (text[end - 1] === '.' || text[end - 1] === '*')) {
    end--
  }
  return text.slice(0, end)
}

function isPlainNumber(text: string): boolean {
  const number = UNSIGNED_INTEGER_PATTERN.exec(stripWhitespace(text))
  return number !== null && isU64(number[1])
}

function parseRequirement(text: string, kind: Requirement['kind'] | null): Requirement | null {
  const groups = REQUIREMENT_PATTERN.exec(text)?.groups
  if (groups === undefined) {
    return null
  }
  const { major, minor, patch } = groups
  if (![major, minor, patch].every((number) => !number || isU64(number))) {
    return null
  }
  // Without a wildcard the reference reads a bare version as a caret range.
  const resolvedKind = kind ?? (groups.anyMinor || groups.anyPatch ? 'wildcard' : 'caret')
  return {
    kind: resolvedKind,
    major: BigInt(major),
    minor: minor ? BigInt(minor) : null,
    patch: patch ? BigInt(patch) : null,
    pre: groups.pre ?? '',
  }
}

function matchSemver(predicate: Predicate, value: unknown): boolean {
  const version = parseVersion(jsonText(value, 'missing_context'))
  if (version === null) {
    return false
  }
  const operand = predicate.operand as VersionKey | Requirement | null
  if (operand !== null && operand.kind === 'version') {
    const order = compareKeys(versionKey(version), operand.key)
    switch (predicate.operator) {
      case 'semver_eq':
        return order === 0
      case 'semver_neq':
        return order !== 0
      case 'semver_gt':
        return order > 0
      case 'semver_gte':
        return order >= 0
      case 'semver_lt':
        return order < 0
      default:
        return order <= 0
    }
  }
  if (operand === null) {
    throw invalidProperty(`The filter value for '${predicate.key}' is not a version range`)
  }
  return satisfies(version, operand)
}

function satisfies(version: Version, requirement: Requirement): boolean {
  if (!inRange(version, requirement)) {
    return false
  }
  // A pre-release matches only a range that names a pre-release of the same version.
  return (
    version.pre === '' ||
    (requirement.pre !== '' &&
      version.major === requirement.major &&
      version.minor === requirement.minor &&
      version.patch === requirement.patch)
  )
}

function inRange(version: Version, requirement: Requirement): boolean {
  const { kind, major, minor, patch, pre } = requirement
  if (version.major !== major) {
    return false
  }
  if (kind === 'wildcard') {
    return (
      (minor === null || minor === version.minor) && (patch === null || patch === version.patch) && version.pre === pre
    )
  }
  const reached = compareKeys(preReleaseKey(version.pre), preReleaseKey(pre)) >= 0
  if (kind === 'tilde') {
    if (minor !== null && version.minor !== minor) {
      return false
    }
    if (patch !== null && version.patch !== patch) {
      return version.patch > patch
    }
    return reached
  }
  // A caret range keeps the leftmost number that is not zero.
  if (minor === null) {
    return true
  }
  if (patch === null) {
    return major > BigInt(0) ? version.minor >= minor : version.minor === minor
  }
  if (major > BigInt(0)) {
    if (version.minor !== minor) {
      return version.minor > minor
    }
    if (version.patch !== patch) {
      return version.patch > patch
    }
  } else if (minor > BigInt(0)) {
    if (version.minor !== minor) {
      return false
    }
    if (version.patch !== patch) {
      return version.patch > patch
    }
  } else if (version.minor !== minor || version.patch !== patch) {
    return false
  }
  return reached
}

// --- Dates -----------------------------------------------------------------------------------
//
// An instant is [seconds since the Unix epoch, nanoseconds]. The reference compares with
// nanosecond precision, which `Date` does not have.

type Instant = readonly [number, number]

/** A wall clock without a timezone, with whole seconds. Months count from 1. */
type WallClock = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

/** A date such as `-7d`: seven days before now. The sign changes nothing. */
type RelativeDate = { readonly kind: 'relative'; readonly number: number; readonly interval: string }

type AbsoluteDate = {
  readonly kind: 'absolute'
  readonly wallClock: WallClock
  readonly nanoseconds: number
  /** Seconds east of UTC; `null` means the project's timezone. */
  readonly offset: number | null
}

type DateValue = RelativeDate | AbsoluteDate

// Epoch seconds that fall in the years 1 to 9999.
const MIN_EPOCH_SECONDS = -62_135_596_800
const MAX_EPOCH_SECONDS = 253_402_300_799
const SECONDS_PER_DAY = 86_400
const RELATIVE_DATE_PATTERN = /^-?([0-9]+)([hdwmy])$/
const HOURS_PER_INTERVAL: Readonly<Record<string, number>> = { h: 1, d: 24, w: 168 }
const DATE_PATTERN =
  /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})(?:(?<separator>[T ])(?<hour>[0-9]{2}):(?<minute>[0-9]{2})(?::(?<second>[0-9]{2})(?:\.(?<fraction>[0-9]{1,9}))?)?(?<offset>Z|[+-][0-9]{2}:[0-9]{2})?)?$/

/**
 * Reads a date in one of the forms this evaluator resolves exactly: a relative date, an RFC 3339
 * timestamp, a bare `YYYY-MM-DD` date, and a date and time without an offset. The reference reads
 * more forms on a best-effort basis, so `null` does not mean the reference cannot read the text.
 */
function parseDate(text: string): DateValue | null {
  const relative = RELATIVE_DATE_PATTERN.exec(text)
  if (relative !== null) {
    const digits = relative[1].replace(/^0+/, '')
    if (digits.length > 4) {
      // 10,000 and above is not a relative date.
      return null
    }
    return { kind: 'relative', number: Number(digits || '0'), interval: relative[2] }
  }
  const groups = DATE_PATTERN.exec(text)?.groups
  if (groups === undefined) {
    return null
  }
  const offset = parseOffset(groups.offset)
  if (groups.offset !== undefined && (offset === null || groups.separator !== 'T' || groups.second === undefined)) {
    // A timestamp with an offset is RFC 3339 or nothing.
    return null
  }
  const wallClock: WallClock = {
    year: Number(groups.year),
    month: Number(groups.month),
    day: Number(groups.day),
    hour: Number(groups.hour ?? 0),
    minute: Number(groups.minute ?? 0),
    second: Number(groups.second ?? 0),
  }
  if (!isValidWallClock(wallClock)) {
    return null
  }
  const fraction = groups.fraction ?? ''
  return { kind: 'absolute', wallClock, nanoseconds: Number(fraction.padEnd(9, '0')), offset }
}

function parseOffset(text: string | undefined): number | null {
  if (text === undefined) {
    return null
  }
  if (text === 'Z') {
    return 0
  }
  const hours = Number(text.slice(1, 3))
  const minutes = Number(text.slice(4, 6))
  if (hours > 23 || minutes > 59) {
    return null
  }
  const seconds = hours * 3600 + minutes * 60
  return text[0] === '-' ? -seconds : seconds
}

function isValidWallClock({ year, month, day, hour, minute, second }: WallClock): boolean {
  return (
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  )
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/**
 * Reads a date filter value, or rejects the document. The configuration format does not admit a
 * date and time joined by `T` without an offset, although the reference would evaluate one.
 */
function readDateFilter(text: string): DateValue {
  const date = parseDate(text)
  if (date === null || (date.kind === 'absolute' && date.offset === null && text.includes('T'))) {
    throw unsupported('property.value')
  }
  return date
}

function matchDate(predicate: Predicate, value: unknown, context: ConfigV2Context): boolean {
  const subject = propertyInstant(value, context)
  if (subject === null) {
    return false
  }
  const target = resolveDate(predicate.operand as DateValue, context)
  if (target === null) {
    return false
  }
  const order = subject[0] !== target[0] ? subject[0] - target[0] : subject[1] - target[1]
  switch (predicate.operator) {
    case 'is_date_exact':
      return order === 0
    case 'is_date_after':
      return order > 0
    default:
      return order < 0
  }
}

/** The instant a person property holds, or `null` when it holds no date. */
function propertyInstant(value: unknown, context: ConfigV2Context): Instant | null {
  if (value === null || typeof value === 'boolean' || Array.isArray(value) || isJsonObject(value)) {
    return null
  }
  if (typeof value === 'number') {
    return epochInstant(value)
  }
  if (typeof value !== 'string') {
    throw unusableContext(`A property value of type ${describeType(value)} is not a JSON value`)
  }
  // A number, also as a string, is Unix epoch seconds.
  if (NUMBER_PATTERN.test(value)) {
    return epochInstant(parseNumberText(value))
  }
  const date = parseDate(value)
  if (date !== null) {
    return resolveDate(date, context)
  }
  if (!/[0-9]/.test(value)) {
    return null
  }
  throw unusableContext('The date property is in a form that needs the flags service to read')
}

/** Unix epoch seconds as an instant. */
function epochInstant(value: number): Instant {
  if (!Number.isFinite(value)) {
    throw unusableContext('A date property is not a finite number')
  }
  const seconds = Math.floor(value)
  // The reference drops the fraction of a negative number.
  const nanoseconds = Math.max(0, roundHalfUp((value % 1) * 1e9))
  if (seconds < MIN_EPOCH_SECONDS || seconds > MAX_EPOCH_SECONDS || nanoseconds >= 1_000_000_000) {
    throw unusableContext('A date property is outside the supported range')
  }
  return [seconds, nanoseconds]
}

function roundHalfUp(value: number): number {
  const whole = Math.floor(value)
  return value - whole >= 0.5 ? whole + 1 : whole
}

/**
 * The instant of a date, or `null` when its wall clock does not exist. A wall clock that a
 * spring-forward transition skips has no instant. One that a fall-back transition repeats means
 * its earlier instant.
 */
function resolveDate(date: DateValue, context: ConfigV2Context): Instant | null {
  if (date.kind === 'relative') {
    const [wallClock, milliseconds] = relativeWallClock(date, context)
    return localInstant(wallClock, milliseconds * 1_000_000, context)
  }
  if (date.offset === null) {
    return localInstant(date.wallClock, date.nanoseconds, context)
  }
  return [wallClockSeconds(date.wallClock) - date.offset, date.nanoseconds]
}

function timeZoneOf(context: ConfigV2Context): string {
  if (context.timeZone === undefined) {
    throw unusableContext("The project's timezone is not known")
  }
  return context.timeZone
}

/**
 * Counts back from now on the wall clock of the project's timezone, and returns the wall clock
 * and its milliseconds. A day is a calendar day there, not 24 hours. Months and years go back one
 * at a time, and each step clamps the day to the end of its month.
 */
function relativeWallClock(date: RelativeDate, context: ConfigV2Context): [WallClock, number] {
  const now = context.now ?? new Date()
  const nowMilliseconds = now.getTime()
  if (!Number.isFinite(nowMilliseconds)) {
    throw unusableContext('The current time is not a valid date')
  }
  const milliseconds = ((nowMilliseconds % 1000) + 1000) % 1000
  const nowSeconds = (nowMilliseconds - milliseconds) / 1000
  const timeZone = timeZoneOf(context)
  const local = fromWallClockSeconds(nowSeconds + offsetAt(nowSeconds, timeZone))
  let moved: WallClock | null
  if (date.interval === 'm') {
    moved = subtractMonths(local, date.number)
  } else if (date.interval === 'y') {
    moved = subtractYears(local, date.number)
  } else {
    const hours = date.number * HOURS_PER_INTERVAL[date.interval]
    moved = fromWallClockSeconds(wallClockSeconds(local) - hours * 3600)
    if (moved.year < 1) {
      moved = null
    }
  }
  if (moved === null) {
    throw unusableContext('A relative date is outside the supported range')
  }
  return [moved, milliseconds]
}

function subtractMonths(wallClock: WallClock, months: number): WallClock | null {
  const currentIndex = wallClock.year * 12 + wallClock.month - 1
  const monthIndex = currentIndex - months
  const year = Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1
  if (year < 1 || year > 9999) {
    return null
  }
  let day = wallClock.day
  for (let index = currentIndex - 1; index >= monthIndex; index--) {
    if (day <= 28) {
      // Every month has at least 28 days, so nothing clamps further.
      break
    }
    day = Math.min(day, daysInMonth(Math.floor(index / 12), (index % 12) + 1))
  }
  return { ...wallClock, year, month, day }
}

function subtractYears(wallClock: WallClock, years: number): WallClock | null {
  const year = wallClock.year - years
  if (year < 1 || year > 9999) {
    return null
  }
  // The year before a leap year is never a leap year, so February 29 clamps on the first step and
  // stays on the 28th.
  const day = years > 0 && wallClock.month === 2 && wallClock.day === 29 ? 28 : wallClock.day
  return { ...wallClock, year, day }
}

function localInstant(wallClock: WallClock, nanoseconds: number, context: ConfigV2Context): Instant | null {
  const timeZone = timeZoneOf(context)
  const local = wallClockSeconds(wallClock)
  // At most one transition lies within a day of any wall clock, so the offsets a day before and
  // a day after are the only offsets it can have.
  const candidates = [offsetAt(local - SECONDS_PER_DAY, timeZone), offsetAt(local + SECONDS_PER_DAY, timeZone)]
    .map((offset) => local - offset)
    .filter((instant) => instant + offsetAt(instant, timeZone) === local)
  if (candidates.length === 0) {
    // A spring-forward transition skips this wall clock.
    return null
  }
  return [Math.min(...candidates), nanoseconds]
}

/** Seconds since the epoch of a wall clock read as UTC. */
function wallClockSeconds({ year, month, day, hour, minute, second }: WallClock): number {
  return daysFromCivil(year, month, day) * SECONDS_PER_DAY + hour * 3600 + minute * 60 + second
}

function fromWallClockSeconds(seconds: number): WallClock {
  const days = Math.floor(seconds / SECONDS_PER_DAY)
  const rest = seconds - days * SECONDS_PER_DAY
  const [year, month, day] = civilFromDays(days)
  return { year, month, day, hour: Math.floor(rest / 3600), minute: Math.floor((rest % 3600) / 60), second: rest % 60 }
}

// Days between 1970-01-01 and a date of the proleptic Gregorian calendar, which `Date.UTC` cannot
// give for the years 0 to 99.
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yearOfEra = y - era * 400
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const dayOfEra = z - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365
  )
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day]
}

const timeZoneFormats = new Map<string, Intl.DateTimeFormat>()

/** The UTC offset of a timezone at an instant, in seconds east of UTC. */
function offsetAt(seconds: number, timeZone: string): number {
  if (timeZone === 'UTC') {
    return 0
  }
  let format = timeZoneFormats.get(timeZone)
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone,
        calendar: 'gregory',
        era: 'short',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hourCycle: 'h23',
      })
    } catch {
      throw unusableContext(`The timezone '${timeZone}' is not known`)
    }
    timeZoneFormats.set(timeZone, format)
  }
  const parts: Record<string, string> = {}
  for (const part of format.formatToParts(new Date(seconds * 1000))) {
    parts[part.type] = part.value
  }
  const year = parts.era === 'BC' || parts.era === 'B' ? 1 - Number(parts.year) : Number(parts.year)
  const local = wallClockSeconds({
    year,
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  })
  return local - seconds
}

// --- Local evaluation in the poller -------------------------------------------------------
//
// The poller evaluates a loaded definition here when its config version is not 1. The definitions
// request does not select config version 2 flags yet, so none arrives from the API; one can still
// come from a definition cache that a newer release shares.

/** The reason description of a locally evaluated record, as for a version 1 flag. */
const LOCAL_REASON_DESCRIPTION = 'Evaluated locally'

/**
 * Whether a flag definition is config version 1, the format the version 1 evaluator reads. It is
 * when `filters.version` is absent or the number 1. Any other value, also one that is not a number,
 * belongs to the config version 2 evaluator, which accepts only version 2.
 */
export function isConfigVersion1(flag: unknown): boolean {
  const filters = isJsonObject(flag) ? flag.filters : undefined
  if (!isJsonObject(filters) || filters.version === undefined) {
    return true
  }
  return filters.version === 1
}

/** A loaded definition and its `filters`, parsed once when definitions load. */
export type ParsedConfigV2Definition = {
  readonly definition: PostHogFeatureFlag
  readonly config: ConfigV2 | ConfigV2Unsupported
}

/** The result of a config version 2 definition: the record a `/flags?v=4` response gives. */
export type ConfigV2LocalResult = {
  /** The legacy rendering of the record, which the existing getters read. */
  readonly detail: FeatureFlagDetail
  readonly record: ParsedFlagRecord
  /** The value the legacy getters return: the variant, or whether the flag is enabled. */
  readonly value: FeatureFlagValue
  /** The decoded payload of a number or object value, or `null`. */
  readonly payload: JsonType | null
}

/** Parses each config version 2 definition of a definitions list, by flag key. */
export function parseConfigV2Definitions(
  flags: readonly PostHogFeatureFlag[]
): ReadonlyMap<string, ParsedConfigV2Definition> {
  const parsed = new Map<string, ParsedConfigV2Definition>()
  for (const flag of flags) {
    if (!isConfigVersion1(flag)) {
      parsed.set(flag.key, { definition: flag, config: parseConfigV2(flag.filters) })
    }
  }
  return parsed
}

/** The parsed `filters` of a definition, read now if it was not parsed on load. */
function configFor(
  flag: PostHogFeatureFlag,
  parsed: ReadonlyMap<string, ParsedConfigV2Definition>
): ConfigV2 | ConfigV2Unsupported {
  const entry = parsed.get(flag.key)
  return entry !== undefined && entry.definition === flag ? entry.config : parseConfigV2(flag.filters)
}

/** The reason the definition alone leaves the flag unresolved, known on load. */
export function configV2UnresolvedReason(
  flag: PostHogFeatureFlag,
  parsed: ReadonlyMap<string, ParsedConfigV2Definition>
): UnresolvedFlagReason | undefined {
  return flag.active && isConfigV2Unsupported(configFor(flag, parsed)) ? 'unsupported_definition' : undefined
}

/**
 * Evaluates a config version 2 definition for one person.
 *
 * Returns the record a `/flags?v=4` response gives for the same result, so the client reads it and
 * sends its flag events as for a remote record. Throws `InconclusiveMatchError` with the
 * unresolved reason when the evaluator gives no value; the caller then falls back as for a
 * version 1 flag.
 *
 * The flags service evaluates these flags with the distinct ID only, so experience continuity and
 * device bucketing do not apply. The caller never knows that its properties are complete, and
 * dates without an offset are read in UTC, as version 1 local evaluation reads them.
 */
export async function evaluateConfigV2Definition(
  flag: PostHogFeatureFlag,
  parsed: ReadonlyMap<string, ParsedConfigV2Definition>,
  context: { distinctId: string; properties: Record<string, unknown>; propertyMatchingVersion: number | undefined }
): Promise<ConfigV2LocalResult> {
  let outcome: ConfigV2Outcome = await evaluateConfigV2(
    configFor(flag, parsed),
    {
      identifier: String(context.distinctId),
      properties: context.properties,
      propertiesComplete: false,
      explicitExactMatching: context.propertyMatchingVersion === 2,
      timeZone: 'UTC',
    },
    { active: Boolean(flag.active) }
  )
  if (outcome.outcome === 'evaluated') {
    const result = localResult(flag, outcome)
    if (!result.record.failed) {
      return result
    }
    outcome = { outcome: 'unsupported', kind: 'malformed', field: result.record.unreadableField ?? 'record' }
  }
  throw new InconclusiveMatchError(describe(outcome), reasonOf(outcome))
}

/** Builds the `/flags?v=4` record of a result and reads it as the response reader does. */
function localResult(flag: PostHogFeatureFlag, outcome: ConfigV2Evaluated): ConfigV2LocalResult {
  const definition = flag as PostHogFeatureFlag & { version?: unknown }
  const metadata: Record<string, unknown> = { config_version: CONFIG_VERSION, description: null }
  // A field the reader would reject is left out, so that it does not fail the whole record.
  if (Number.isInteger(definition.id)) {
    metadata.id = definition.id
  }
  if (Number.isInteger(definition.version)) {
    metadata.version = definition.version
  }
  if (typeof definition.has_experiment === 'boolean') {
    metadata.has_experiment = definition.has_experiment
  }
  if (outcome.ruleType !== undefined) {
    metadata.rule_type = outcome.ruleType
    metadata.rule_id = outcome.ruleId
  }
  if (outcome.variantKey !== undefined) {
    metadata.variant_key = outcome.variantKey
  }
  const raw = {
    key: flag.key,
    // An object value is the configuration's own object, so the record gets a copy.
    value: outcome.value === null ? null : JSON.parse(JSON.stringify(outcome.value)),
    reason: {
      code: outcome.reason,
      condition_index: outcome.ruleIndex ?? null,
      description: LOCAL_REASON_DESCRIPTION,
    },
    metadata,
  }
  const { body } = readFlagRecords({ flags: { [flag.key]: raw } }) as {
    body: { flags: Record<string, FeatureFlagDetail> }
  }
  const detail = body.flags[flag.key]
  const record = parsedFlagRecordOf(detail)
  const rendered = detail.metadata?.payload
  return {
    detail,
    record,
    value: detail.variant ?? detail.enabled,
    payload: rendered === undefined || rendered === null ? null : (JSON.parse(rendered) as JsonType),
  }
}

/** The unresolved reason of an outcome without a value, as the contract maps it. */
function reasonOf(outcome: ConfigV2Inconclusive | ConfigV2Unsupported | ConfigV2EvaluationError): UnresolvedFlagReason {
  if (outcome.outcome === 'inconclusive') {
    return outcome.reason
  }
  if (outcome.outcome === 'error' && outcome.kind === 'invalid_property') {
    // The person property is not in a form the rule can compare.
    return 'missing_context'
  }
  return 'unsupported_definition'
}

function describe(outcome: ConfigV2Inconclusive | ConfigV2Unsupported | ConfigV2EvaluationError): string {
  if (outcome.outcome === 'unsupported') {
    return `The config version 2 document is ${outcome.kind} at '${outcome.field}'`
  }
  return outcome.detail
}
