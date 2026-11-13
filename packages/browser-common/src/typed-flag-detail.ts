import { isNumber, isObject, isString } from '@posthog/core'
import type { FeatureFlagDetail, FeatureFlagMetadata, JsonType } from '@posthog/types'

/**
 * The stored rendering of a typed `/flags` record: what the reader of the `/flags?v=4` response
 * writes and what the flag events read.
 */

/** A flag's typed value. `null` means the flag has no value. */
export type FlagRecordValue = boolean | string | number | { [key: string]: JsonType } | null

/** The stored rendering of a typed flag record: the legacy members plus the typed ones. */
export type TypedFlagDetail = Omit<FeatureFlagDetail, 'metadata'> & {
    /** The typed value. `null` for a failed record, whatever it carried. */
    value: FlagRecordValue
    metadata:
        | (Omit<FeatureFlagMetadata, 'has_experiment'> & {
              has_experiment: boolean | undefined
              /** The flag's configuration format. */
              config_version: number | undefined
              /** The rule that produced the result. */
              rule_type: string | undefined
              rule_id: string | undefined
              /** The assigned variant. */
              variant_key: string | undefined
              forced_variant: boolean | undefined
          })
        | undefined
}

/**
 * The typed record of a stored flag detail, or `undefined` when the detail has none: it came from
 * a server that does not serve v4, from an older SDK version, from bootstrap or `updateFlags`, or
 * its record could not be read.
 */
export const typedFlagDetailOf = (detail: FeatureFlagDetail | undefined): TypedFlagDetail | undefined =>
    isObject(detail) && 'value' in detail ? (detail as unknown as TypedFlagDetail) : undefined

/**
 * The legacy rendering of a typed value, as responses before `/flags?v=4` carried it: a boolean as
 * is, a string as the variant, `null` as `false`, and a number or object as `true`.
 */
export const legacyValueOf = (value: FlagRecordValue): string | boolean =>
    isString(value) ? value : isNumber(value) || isObject(value) || value === true
