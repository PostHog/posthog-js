import { hasOwnProperty, isNull, isPlainObject, isString } from '@posthog/core'
import type { FeatureFlagDetail } from '@posthog/types'
import type { FlagsResponseFormat } from './feature-flags'
import { buildConfigVersion2FlagEvents, ruleAttribution, type ConfigVersion2FlagEvents } from './flag-events'
import {
    isUnreadableFlagRecord,
    parsedFlagRecordOf,
    readFlagRecords,
    type FeatureFlagDetail as RenderedFlagDetail,
    type ParsedFlagRecord,
} from './flags-response'
import type { FlagsResponse } from './types/feature-flags'

/**
 * What a browser SDK does differently from posthog-node when it reads the `/flags?v=4` response
 * and builds the flag events of its records. `flags-response.ts` has the reader the two share and
 * `flag-events.ts` the events, and this file only calls them.
 *
 * 1. **The parsed record is stored.** posthog-node keeps the parsed record of a flag in memory,
 *    beside its legacy rendering. A browser SDK stores its flags, and other page loads, other tabs
 *    and other SDK versions read them back. So the typed members of the record are stored with
 *    the rendering, in `$feature_flag_details`, under their wire names: `value`, and
 *    `config_version`, `rule_type`, `rule_id`, `variant_key` and `forced_variant` in `metadata`.
 *    No stored property is added, because a released SDK adds every stored property it does not
 *    know to each event it sends. A stored record is read back with the shared reader, so the
 *    members are checked again: other code can have written them.
 * 2. **A record without a typed value is stored as sent.** posthog-node also checks the types of
 *    such a record. The browser never did, and a server that does not serve v4 is read exactly as
 *    before.
 * 3. **A flag without a variant has `variant: null`**, as a v2 record carries it. The events of an
 *    overridden flag depend on it.
 * 4. **A stored record must have supplied the stored value.** posthog-node passes the parsed
 *    record along with the value it read from it. A browser SDK stores flag values and flag
 *    records as separate properties, and other code and other SDK versions write the one without
 *    the other. So a stored record gets the flag events of a read only when the legacy rendering
 *    of its typed value is the value the read returns.
 *
 * The stored members are internal: no public type declares them.
 */

/** Whether a record, as sent or as stored, has a typed value. */
const hasTypedValue = (record: unknown): record is Record<string, unknown> =>
    isPlainObject(record) && hasOwnProperty.call(record, 'value')

// The parsed record of each stored rendering, by the stored object. `undefined` for a stored
// record that cannot be read.
const storedRecords = new WeakMap<object, ParsedFlagRecord | undefined>()

/** The stored rendering of a record that the shared reader read: its legacy rendering plus its typed members. */
function storedFlagDetail(detail: RenderedFlagDetail): FeatureFlagDetail {
    if (isUnreadableFlagRecord(detail)) {
        // A record that cannot be read is stored as the disabled, failed flag it reads as.
        return detail as FeatureFlagDetail
    }
    const record = parsedFlagRecordOf(detail)
    const { configVersion, ruleType, ruleId, variantKey, forcedVariant } = record.metadata
    const stored = {
        ...detail,
        variant: detail.variant ?? null,
        value: record.value,
        metadata: detail.metadata && {
            ...detail.metadata,
            config_version: configVersion,
            rule_type: ruleType,
            rule_id: ruleId,
            variant_key: variantKey,
            forced_variant: forcedVariant,
        },
    }
    storedRecords.set(stored, record)
    return stored as unknown as FeatureFlagDetail
}

/**
 * The parsed record of a stored flag detail, or `undefined` when the detail has no typed value: it
 * came from a server that does not serve v4, from an older SDK version, from bootstrap or
 * `updateFlags`, or its record could not be read.
 */
export function storedParsedFlagRecordOf(detail: FeatureFlagDetail | undefined): ParsedFlagRecord | undefined {
    if (!hasTypedValue(detail)) {
        return undefined
    }
    if (!storedRecords.has(detail)) {
        // The detail came from storage. Its typed members are read as a record from the wire is.
        const { flags } = readFlagRecords({ flags: { stored: detail } }).body as {
            flags: { stored: RenderedFlagDetail }
        }
        storedRecords.set(detail, isUnreadableFlagRecord(flags.stored) ? undefined : parsedFlagRecordOf(flags.stored))
    }
    return storedRecords.get(detail)
}

/**
 * Reads the flag records of a `/flags` response body into what the SDK stores. A typed record is
 * replaced by its stored rendering, a record without a typed value is kept as sent, and the rest
 * of the body is returned unchanged. A typed record that cannot be read is replaced by a disabled,
 * failed flag, and the other records are not affected.
 *
 * `withoutTypedValues` says whether the body has a record without a typed `value`, or is a v1
 * response with flags, which a server that does not serve v4 sends.
 */
export function readFlagRecordsForStorage(body: Partial<FlagsResponse>): {
    body: Partial<FlagsResponse>
    withoutTypedValues: boolean
} {
    const read = readFlagRecords(body)
    const sent: unknown = isPlainObject(body) ? body.flags : undefined
    const rendered: unknown = isPlainObject(read.body) ? read.body.flags : undefined
    if (!isPlainObject(sent) || !isPlainObject(rendered)) {
        return { body, withoutTypedValues: read.withoutTypedValues }
    }
    const flags = Object.fromEntries(
        Object.entries(rendered).map(([key, detail]) => {
            const record = sent[key]
            return [
                key,
                isPlainObject(record) && !hasTypedValue(record)
                    ? (record as FeatureFlagDetail)
                    : storedFlagDetail(detail as RenderedFlagDetail),
            ]
        })
    )
    return { body: { ...body, flags }, withoutTypedValues: read.withoutTypedValues }
}

/**
 * The legacy value of a typed value: a boolean as is, a string as the variant, `null` as `false`,
 * and a number or object as `true`. `renderValue` of the shared reader also encodes the payload,
 * which a read does not need.
 */
const legacyValueOf = (value: ParsedFlagRecord['value']): string | boolean =>
    isString(value) ? value : !isNull(value) && value !== false

/**
 * The config version 2 flag events of a read that returns `response`, built by the shared
 * `buildConfigVersion2FlagEvents` from the stored record of the flag. Returns `undefined` when the
 * stored record has no config version 2 attribution, or did not supply `response`. The read then
 * sends its `$feature_flag_called` as before.
 *
 * `properties` builds the properties of the read's `$feature_flag_called`. It is called only for
 * a record that has such events, so a read of any other flag does no more work than before.
 */
export function storedFlagEvents(params: {
    key: string
    response: string | boolean
    groups: Readonly<Record<string, string>>
    properties: () => Record<string, any>
    detail: FeatureFlagDetail | undefined
}): ConfigVersion2FlagEvents | undefined {
    const record = storedParsedFlagRecordOf(params.detail)
    if (!record || !ruleAttribution(record) || legacyValueOf(record.value) !== params.response) {
        return undefined
    }
    return buildConfigVersion2FlagEvents({
        key: params.key,
        response: params.response,
        groups: params.groups,
        properties: params.properties(),
        record,
    })
}

/**
 * Requests `/flags?v=4`, reads its typed records, and builds the flag events of the config version
 * 2 records among them. A client opts in by returning it from the flags extension's
 * `_responseFormat`.
 */
export const flagsResponseV4: FlagsResponseFormat = {
    version: 4,
    read: readFlagRecordsForStorage,
    flagEvents: storedFlagEvents,
}
