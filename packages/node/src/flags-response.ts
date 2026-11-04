import {
  FeatureFlagDetail,
  hasOwnProperty,
  isBoolean,
  isNull,
  isNullish,
  isNumber,
  isPlainObject,
  isString,
  JsonType,
} from '@posthog/core'

/**
 * Reads the flag records of the `/flags?v=4` response.
 *
 * A v4 record carries one typed `value` (boolean, string, number, object or null) instead of
 * `enabled` and `variant`, plus a structured reason and rule metadata. A record without `value`
 * comes from a server that does not serve v4: its value is `variant`, or `enabled` when there is
 * no variant, and its config version is 1.
 *
 * The existing getters and events read the legacy rendering of each record, which is derived
 * from `value` here, in {@link renderValue}. The parsed record is kept for the typed flag API
 * and is internal: {@link parsedFlagRecordOf} returns it.
 */

/**
 * A flag's typed value. `null` means the flag has no value.
 *
 * @internal
 */
export type FlagRecordValue = boolean | string | number | { [key: string]: JsonType } | null

/**
 * A `/flags` flag record as this SDK read it. Internal: it is not part of the public API.
 *
 * @internal
 */
export type ParsedFlagRecord = {
  /**
   * The typed value. `null` for an unreadable record and a failed v4 record. A record without a
   * typed `value` keeps `variant`, or `enabled` when there is no variant, even when it failed.
   */
  readonly value: FlagRecordValue
  /** Whether the flag failed to evaluate, or its record could not be read. */
  readonly failed: boolean
  /**
   * The wire path of the known field with the wrong JSON type that made the record unreadable,
   * such as `metadata.id`. Absent from a readable record, including one the server marks failed.
   */
  readonly unreadableField?: string
  readonly reason?: {
    readonly code?: string
    readonly conditionIndex?: number
    readonly description?: string
  }
  readonly metadata: {
    readonly id?: number
    readonly version?: number
    /** The flag's configuration format: `1` for a record without a typed `value`; absent when a record has none. */
    readonly configVersion?: number
    readonly description?: string
    readonly hasExperiment?: boolean
    /** The rule that produced the result. */
    readonly ruleType?: string
    readonly ruleId?: string
    /** The assigned variant. */
    readonly variantKey?: string
    readonly forcedVariant?: boolean
  }
}

/** Logged once per client, the first time a `/flags` response has a record without a typed value. */
export const FLAGS_RESPONSE_WITHOUT_TYPED_VALUES_MESSAGE =
  '[FEATURE FLAGS] The /flags response has no typed flag values, so the server may not support /flags?v=4. ' +
  'Its flags are read as config version 1.'

type ReadRecord = { detail: FeatureFlagDetail; record: ParsedFlagRecord }

// The parsed record of each legacy rendering this module created, so the public detail type
// stays unchanged. Details that were not read here, such as those of a v1 response, have none.
const parsedRecords = new WeakMap<FeatureFlagDetail, ParsedFlagRecord>()

class UnreadableField extends Error {
  readonly field: string

  constructor(field: string) {
    super(field)
    this.field = field
  }
}

/**
 * Reads the flag records of a `/flags` response body. Each record in `flags` is replaced by its
 * legacy rendering, the shape the shared v2 reader reads, and the rest of the body is returned
 * unchanged. A body without a `flags` object is returned as is.
 *
 * `withoutTypedValues` says whether the body has a record without a typed `value`, or is a v1
 * response with flags, which a server that does not serve v4 sends.
 */
export function readFlagRecords(body: unknown): { body: unknown; withoutTypedValues: boolean } {
  if (!isPlainObject(body)) {
    return { body, withoutTypedValues: false }
  }
  const flags = body.flags
  if (!isPlainObject(flags)) {
    const featureFlags = body.featureFlags
    return { body, withoutTypedValues: isPlainObject(featureFlags) && Object.keys(featureFlags).length > 0 }
  }

  let withoutTypedValues = false
  const rendered = Object.fromEntries(
    Object.entries(flags).map(([key, raw]) => {
      if (isPlainObject(raw) && !hasOwnProperty.call(raw, 'value')) {
        withoutTypedValues = true
      }
      const { detail, record } = readRecord(key, raw)
      parsedRecords.set(detail, record)
      return [key, detail]
    })
  )
  return { body: { ...body, flags: rendered }, withoutTypedValues }
}

/**
 * The parsed record of a flag detail from a `/flags` response. A detail that was not read by
 * {@link readFlagRecords}, such as one from a v1 response, reads as a config version 1 record.
 *
 * @internal
 */
export function parsedFlagRecordOf(detail: FeatureFlagDetail): ParsedFlagRecord {
  const record = parsedRecords.get(detail)
  if (record) {
    return record
  }
  return {
    value: detail.variant ?? detail.enabled ?? null,
    failed: detail.failed === true,
    reason: detail.reason && {
      code: detail.reason.code,
      conditionIndex: detail.reason.condition_index,
      description: detail.reason.description,
    },
    metadata: {
      id: detail.metadata?.id,
      version: detail.metadata?.version,
      configVersion: 1,
      description: detail.metadata?.description,
      hasExperiment: detail.metadata?.has_experiment,
    },
  }
}

/** Whether a flag's record had a known field with the wrong JSON type, so it could not be read. */
export function isUnreadableFlagRecord(detail: FeatureFlagDetail): boolean {
  return parsedRecords.get(detail)?.unreadableField !== undefined
}

function readRecord(key: string, raw: unknown): ReadRecord {
  try {
    if (isPlainObject(raw) && !hasOwnProperty.call(raw, 'value')) {
      return readOlderRecord(raw)
    }
    return readTypedRecord(key, raw)
  } catch (error) {
    if (error instanceof UnreadableField) {
      return unreadableRecord(key, error.field)
    }
    if (error instanceof RangeError) {
      // A value nested too deeply to encode as a payload fails only its own record.
      return unreadableRecord(key, 'value')
    }
    throw error
  }
}

/**
 * Reads a `/flags?v=4` record. Unknown fields are ignored. An absent or null field reads as
 * absent, except `value`, where null means the flag has no value.
 */
function readTypedRecord(key: string, raw: unknown): ReadRecord {
  if (!isPlainObject(raw)) {
    throw new UnreadableField('record')
  }
  readRecordKey(raw)
  const sentValue = readValue(raw.value)
  const failed = optional(raw.failed, 'failed', isBoolean) === true
  const reason = readReason(raw.reason)
  const rawMetadata = optional(raw.metadata, 'metadata', isPlainObject)
  const metadata = {
    ...readMetadata(rawMetadata),
    configVersion: optionalInteger(rawMetadata?.config_version, 'metadata.config_version'),
    ruleType: optional(rawMetadata?.rule_type, 'metadata.rule_type', isString),
    ruleId: optional(rawMetadata?.rule_id, 'metadata.rule_id', isString),
    variantKey: optional(rawMetadata?.variant_key, 'metadata.variant_key', isString),
    forcedVariant: optional(rawMetadata?.forced_variant, 'metadata.forced_variant', isBoolean),
  }
  // Only config version 1 records carry an experiment ID. It is checked, like every known field,
  // but not kept.
  optionalInteger(rawMetadata?.experiment_id, 'metadata.experiment_id')

  // A failed record has no value, whatever it carries.
  const value = failed ? null : sentValue
  const { enabled, variant, payload } = renderValue(value)

  const detail: FeatureFlagDetail = {
    key,
    enabled,
    variant,
    reason: reason && {
      code: reason.code,
      condition_index: reason.conditionIndex,
      description: reason.description,
    },
    metadata:
      rawMetadata || payload !== undefined
        ? {
            id: metadata.id,
            version: metadata.version,
            description: metadata.description,
            // A number or object value is its own payload; a payload the record also carries
            // is ignored. Other payloads are kept as sent, like a v2 record's.
            payload: payload ?? (rawMetadata?.payload as string | undefined),
            has_experiment: metadata.hasExperiment,
          }
        : undefined,
  }
  if (failed) {
    detail.failed = true
  }
  return { detail, record: { value, failed, reason, metadata } }
}

/**
 * Reads a record without a typed `value`, from a server that does not serve v4. Its legacy
 * rendering is the record as sent, which is what the SDK read before. Any rule context in it is
 * ignored. As for a v4 record, a known field with the wrong JSON type fails only this record.
 */
function readOlderRecord(raw: Record<string, unknown>): ReadRecord {
  readRecordKey(raw)
  const enabled = optional(raw.enabled, 'enabled', isBoolean)
  const variant = optional(raw.variant, 'variant', isString)
  const failed = optional(raw.failed, 'failed', isBoolean) === true
  const reason = readReason(raw.reason)
  const metadata = readMetadata(optional(raw.metadata, 'metadata', isPlainObject))
  return {
    detail: raw as FeatureFlagDetail,
    record: {
      value: variant ?? enabled ?? null,
      failed,
      reason,
      metadata: { ...metadata, configVersion: 1 },
    },
  }
}

function unreadableRecord(key: string, field: string): ReadRecord {
  return {
    detail: { key, enabled: false, variant: undefined, reason: undefined, metadata: undefined, failed: true },
    record: { value: null, failed: true, unreadableField: field, metadata: {} },
  }
}

/**
 * The legacy rendering of a typed value, as responses before `/flags?v=4` carried it: a boolean
 * as is, a string as the variant, `null` as `false`, and a number or object as `true` with the
 * value as its JSON payload.
 */
function renderValue(value: FlagRecordValue): {
  enabled: boolean
  variant: string | undefined
  payload: string | undefined
} {
  if (isNull(value) || isBoolean(value)) {
    return { enabled: value === true, variant: undefined, payload: undefined }
  }
  if (isString(value)) {
    return { enabled: true, variant: value, payload: undefined }
  }
  return { enabled: true, variant: undefined, payload: JSON.stringify(value) }
}

function readValue(value: unknown): FlagRecordValue {
  if (isNull(value) || isBoolean(value) || isString(value) || isPlainObject(value)) {
    return value as FlagRecordValue
  }
  if (isNumber(value) && Number.isFinite(value)) {
    return value
  }
  throw new UnreadableField('value')
}

// The flag key is the record's map key. A `key` member of the wrong type fails the record, like
// any known field; a string that differs from the map key is ignored.
function readRecordKey(raw: Record<string, unknown>): void {
  optional(raw.key, 'key', isString)
}

function readReason(raw: unknown): ParsedFlagRecord['reason'] {
  const reason = optional(raw, 'reason', isPlainObject)
  if (reason === undefined) {
    return undefined
  }
  return {
    code: optional(reason.code, 'reason.code', isString),
    conditionIndex: optionalInteger(reason.condition_index, 'reason.condition_index'),
    description: optional(reason.description, 'reason.description', isString),
  }
}

function readMetadata(metadata: Record<string, unknown> | undefined): {
  id?: number
  version?: number
  description?: string
  hasExperiment?: boolean
} {
  return {
    id: optionalInteger(metadata?.id, 'metadata.id'),
    version: optionalInteger(metadata?.version, 'metadata.version'),
    description: optional(metadata?.description, 'metadata.description', isString),
    hasExperiment: optional(metadata?.has_experiment, 'metadata.has_experiment', isBoolean),
  }
}

function optional<T>(value: unknown, field: string, is: (value: unknown) => value is T): T | undefined {
  if (isNullish(value)) {
    return undefined
  }
  if (is(value)) {
    return value
  }
  throw new UnreadableField(field)
}

// JSON has one number type, so an integral number such as 2.0 is an integer.
function optionalInteger(value: unknown, field: string): number | undefined {
  return optional(value, field, (candidate): candidate is number => isNumber(candidate) && Number.isInteger(candidate))
}
