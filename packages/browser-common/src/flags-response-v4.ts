import { hasOwnProperty, isPlainObject } from '@posthog/core'
import type { FeatureFlagDetail } from '@posthog/types'
import type { FlagsResponseFormat } from './feature-flags'
import { configVersion2FlagEvents } from './flag-events'
import {
    isUnreadableFlagRecord,
    parsedFlagRecordOf,
    readFlagRecords,
    type FeatureFlagDetail as RenderedFlagDetail,
    type ParsedFlagRecord,
} from './flags-response'
import type { FlagsResponse } from './types/feature-flags'

/**
 * What a browser SDK does differently from posthog-node when it reads the `/flags?v=4` response.
 * `flags-response.ts` has the reader the two share, and this file only calls it.
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
 * Requests `/flags?v=4`, reads its typed records, and builds the flag events of the config version
 * 2 records among them. A client opts in by returning it from the flags extension's
 * `_responseFormat`.
 */
export const flagsResponseV4: FlagsResponseFormat = {
    version: 4,
    read: readFlagRecordsForStorage,
    flagEvents: configVersion2FlagEvents,
}
