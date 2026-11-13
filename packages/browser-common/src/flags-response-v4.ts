import { isBoolean, isNull, isNullish, isNumber, isObject, isString } from '@posthog/core'
import type { FeatureFlagDetail } from '@posthog/types'
import type { FlagsResponseFormat } from './feature-flags'
import { configVersion2FlagEvents } from './flag-events'
import { legacyValueOf, type FlagRecordValue, type TypedFlagDetail } from './typed-flag-detail'
import type { FlagsResponse } from './types/feature-flags'

/**
 * Reads the flag records of the `/flags?v=4` response.
 *
 * A v4 record carries one typed `value` (boolean, string, number, object or null) instead of
 * `enabled` and `variant`, plus a structured reason and rule metadata. The getters, the events and
 * the stored flag state read the legacy rendering of each record, which is derived from `value`
 * here: a boolean as is, a string as the variant, `null` as `false`, and a number or object as
 * `true` with the value as its JSON payload.
 *
 * A record without `value` comes from a server that does not serve v4. It is returned as sent,
 * which is how the SDK read it before.
 *
 * The rendering of a typed record keeps the typed value and the rule metadata beside the legacy
 * members, under their wire names, so they are stored with the flag and survive a page load. They
 * are internal: no public type declares them. A stored record without `value` has no typed value.
 */

export { typedFlagDetailOf, type FlagRecordValue, type TypedFlagDetail } from './typed-flag-detail'

// Thrown for a known field with the wrong JSON type. Any throw makes only its own record unreadable.
const UNREADABLE = {}

type Check = (value: unknown) => boolean
type Fields = readonly (readonly [name: string, is: Check])[]

// JSON has one number type, so an integral number such as 2.0 is an integer.
const isInteger: Check = (value) => isNumber(value) && value % 1 === 0

// The known fields of a record and the JSON type of each. Unknown fields are ignored.
const RECORD_FIELDS: Fields = [
    // The flag key is the record's map key. A `key` member that is not a string fails the record;
    // a string that differs from the map key is ignored.
    ['key', isString],
    ['failed', isBoolean],
]
const REASON_FIELDS: Fields = [
    ['code', isString],
    ['condition_index', isInteger],
    ['description', isString],
]
const METADATA_FIELDS: Fields = [
    ['id', isInteger],
    ['version', isInteger],
    ['description', isString],
    ['has_experiment', isBoolean],
    ['config_version', isInteger],
    ['rule_type', isString],
    ['rule_id', isString],
    ['variant_key', isString],
    ['forced_variant', isBoolean],
    // Only config version 1 records carry an experiment ID. It is checked, like every known
    // field, but not kept.
    ['experiment_id', isInteger],
]

/**
 * The known fields of an object. An absent or null object reads as absent, and so does an absent
 * or null field. Anything of the wrong JSON type throws.
 */
const readFields = (raw: unknown, fields: Fields): Record<string, any> | undefined => {
    if (isNullish(raw)) {
        return undefined
    }
    if (!isObject(raw)) {
        throw UNREADABLE
    }
    const read: Record<string, any> = {}
    for (const [name, is] of fields) {
        const value = raw[name]
        if (!isNullish(value)) {
            if (!is(value)) {
                throw UNREADABLE
            }
            read[name] = value
        }
    }
    return read
}

/**
 * Reads a `/flags?v=4` record into its stored rendering, which holds only the fields this SDK
 * reads. A record that is not an object throws, as does a field with the wrong JSON type and a
 * value nested too deeply to encode as a payload.
 */
const readTypedRecord = (key: string, raw: unknown): TypedFlagDetail => {
    const record = readFields(raw, RECORD_FIELDS)
    const sent: unknown = (raw as Record<string, unknown> | null | undefined)?.value
    if (
        !record ||
        !(isNull(sent) || isBoolean(sent) || isString(sent) || isObject(sent) || (isNumber(sent) && isFinite(sent)))
    ) {
        throw UNREADABLE
    }
    const rawMetadata = (raw as Record<string, any>).metadata
    const metadata = readFields(rawMetadata, METADATA_FIELDS)

    // A failed record has no value, whatever it carries.
    const failed = record.failed === true
    const value = (failed ? null : sent) as FlagRecordValue
    const isJsonValue = isNumber(value) || isObject(value)
    const legacyValue = legacyValueOf(value)

    const detail = {
        key,
        enabled: legacyValue !== false,
        // `null`, not `undefined`, for a flag without a variant: a v2 record carries `null` there.
        variant: isString(legacyValue) ? legacyValue : null,
        value,
        reason: readFields((raw as Record<string, unknown>).reason, REASON_FIELDS),
        metadata:
            metadata || isJsonValue
                ? {
                      ...metadata,
                      // A number or object value is its own payload; a payload the record also
                      // carries is ignored. Other payloads are kept as sent, like a v2 record's.
                      // A failed record reads as disabled, so it has no payload.
                      payload: failed ? null : isJsonValue ? JSON.stringify(value) : rawMetadata?.payload,
                      experiment_id: undefined,
                  }
                : undefined,
        failed: failed || undefined,
    }
    return detail as unknown as TypedFlagDetail
}

/**
 * Reads the flag records of a `/flags` response body. Each typed record in `flags` is replaced by
 * its stored rendering, and the rest of the body is returned unchanged. A record that cannot be
 * read is replaced by a disabled, failed flag, and the other records are not affected.
 *
 * `withoutTypedValues` says whether the body has a record without a typed `value`, which a server
 * that does not serve v4 sends.
 */
export const readFlagRecords = (
    body: Partial<FlagsResponse>
): { body: Partial<FlagsResponse>; withoutTypedValues: boolean } => {
    const flags: Record<string, unknown> | undefined = isObject(body) ? body.flags : undefined
    let withoutTypedValues = false
    if (!isObject(flags)) {
        return { body, withoutTypedValues }
    }

    // A record that cannot be read is stored without the members it has no value for.
    const rendered: Record<string, Pick<FeatureFlagDetail, 'key' | 'enabled'> & Partial<FeatureFlagDetail>> = {}
    for (const key of Object.keys(flags)) {
        const raw = flags[key]
        if (isObject(raw) && !('value' in raw)) {
            withoutTypedValues = true
            rendered[key] = raw as FeatureFlagDetail
            continue
        }
        try {
            rendered[key] = readTypedRecord(key, raw) as unknown as FeatureFlagDetail
        } catch {
            rendered[key] = { key, enabled: false, failed: true }
        }
    }
    return { body: { ...body, flags: rendered as Record<string, FeatureFlagDetail> }, withoutTypedValues }
}

/**
 * Requests `/flags?v=4`, reads its typed records, and builds the flag events of the config version
 * 2 records among them. A client opts in by returning it from the flags extension's
 * `_responseFormat`.
 */
export const flagsResponseV4: FlagsResponseFormat = {
    version: 4,
    read: readFlagRecords,
    flagEvents: configVersion2FlagEvents,
}
