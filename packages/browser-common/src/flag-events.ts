import { hasOwnProperty, isString, isUndefined } from '@posthog/core'
import type { FeatureFlagDetail } from '@posthog/types'
import type { ConfigVersion2FlagEvents, FlagEvent } from './feature-flags'
import { legacyValueOf, typedFlagDetailOf } from './typed-flag-detail'

/**
 * The flag events of one flag read: `$feature_flag_called` and, for a config version 2 experiment
 * split, `$experiment_exposure`.
 *
 * {@link configVersion2FlagEvents} builds both events and their dedupe keys in one step, from the
 * stored `/flags` record that supplied the read's value and the read's `$feature_flag_called`
 * properties. It never evaluates or fetches flags. A read whose record is not a readable config
 * version 2 record gets no events from it, and the client sends its `$feature_flag_called` event
 * exactly as before.
 */

const FEATURE_FLAG_CALLED_EVENT = '$feature_flag_called'
const EXPERIMENT_EXPOSURE_EVENT = '$experiment_exposure'

// The reason code and rule type of the one outcome that sends `$experiment_exposure`: a variant
// assigned by an experiment rule.
const EXPERIMENT_SPLIT_REASON = 'experiment_split'
const EXPERIMENT_RULE_TYPE = 'experiment'

// The reason codes of a config version 2 record that report the rule that produced the result,
// and the rule types each one allows. Any other reason code, and any failed record, reports no
// rule, even when the record names one.
const RULE_TYPES_BY_REASON_CODE: Record<string, readonly string[]> = {
    targeting_match: ['targeted_release', 'percentage_rollout'],
    [EXPERIMENT_SPLIT_REASON]: [EXPERIMENT_RULE_TYPE],
    rollout_miss: ['percentage_rollout', EXPERIMENT_RULE_TYPE],
    experiment_paused: [EXPERIMENT_RULE_TYPE],
    holdout: [EXPERIMENT_RULE_TYPE],
}

const CONFIG_VERSION = '$feature_flag_config_version'
const REASON_CODE = '$feature_flag_reason_code'
const RULE_ID = '$feature_flag_rule_id'
const RULE_TYPE = '$feature_flag_rule_type'
const VARIANT_KEY = '$feature_flag_variant_key'
const EXPERIMENT_ID = '$feature_flag_experiment_id'
const FORCED_VARIANT = '$feature_flag_forced_variant'

/** The attribution a config version 2 `$feature_flag_called` carries, and keeps when minimized. */
const ATTRIBUTION_PROPERTIES: readonly string[] = [CONFIG_VERSION, REASON_CODE, RULE_ID, RULE_TYPE, VARIANT_KEY]

// Properties a super property must not add to a config version 2 `$feature_flag_called`: the
// attribution the record does not report, and the fields such an event never carries.
const FLAG_CALLED_NEVER_CARRIES: readonly string[] = [
    ...ATTRIBUTION_PROPERTIES,
    '$feature_flag_reason',
    FORCED_VARIANT,
    EXPERIMENT_ID,
]

// Properties an `$experiment_exposure` never carries, even from a super property.
const EXPOSURE_NEVER_CARRIES: readonly string[] = [
    CONFIG_VERSION,
    REASON_CODE,
    RULE_TYPE,
    '$experiment_exposure_source',
    EXPERIMENT_ID,
    FORCED_VARIANT,
]

// `$experiment_exposure` copies these from the `$feature_flag_called` of the same read, when it has
// them.
const EXPOSURE_PROPERTIES_FROM_FLAG_CALLED = [
    '$feature_flag_id',
    '$feature_flag_version',
    '$feature_flag_request_id',
    '$feature_flag_evaluated_at',
]

// The rule ID's wire format: a hyphenated UUID, as the contract's event schemas require.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const stringOf = (value: unknown): string | undefined => (isString(value) ? value : undefined)

/** What a config version 2 flag record reports on its flag events. */
export type RuleAttribution = {
    readonly reasonCode: string | undefined
    readonly ruleId: string | undefined
    readonly ruleType: string | undefined
    /** Set only for a complete experiment split, the outcome that sends an exposure. */
    readonly variantKey: string | undefined
}

/**
 * Reads the event attribution of a stored config version 2 flag record.
 *
 * Returns `undefined` for anything else: no record, a record that could not be read, a config
 * version 1 record, or a record without a typed value, which a server that does not serve v4 and
 * an older SDK version store.
 *
 * The config version and reason code are always reported. The rule ID and rule type are reported
 * together or not at all, only for a targeting match, a rollout miss, a paused experiment, a
 * holdout and a complete experiment split, and only with a rule type the reason code allows. A
 * record with no rule ID, no rule type or another rule type, such as a targeting match that names
 * an experiment rule, reports neither. A rule ID that is not a UUID counts as missing. A failed
 * record, any other reason code (including one this SDK does not know) and a record without a
 * reason code report neither. The variant key is reported only for a complete experiment split:
 * reason `experiment_split`, rule type `experiment`, a rule ID and a variant key (any string,
 * including an empty one). A split without all of them is malformed: it reports its reason but no
 * rule ID, rule type or variant, and sends no exposure. The SDK never guesses the missing fields
 * from the value, the flag key or an earlier result.
 */
export const ruleAttribution = (record: FeatureFlagDetail | undefined): RuleAttribution | undefined => {
    const typed = typedFlagDetailOf(record)
    const metadata = typed?.metadata
    if (!typed || metadata?.config_version !== 2) {
        return undefined
    }
    const reasonCode = stringOf(typed.reason?.code) || undefined
    let ruleId: string | undefined
    let ruleType: string | undefined
    let variantKey: string | undefined
    const allowedRuleTypes =
        reasonCode && hasOwnProperty.call(RULE_TYPES_BY_REASON_CODE, reasonCode)
            ? RULE_TYPES_BY_REASON_CODE[reasonCode]
            : undefined
    const sentRuleId = stringOf(metadata.rule_id)
    const sentRuleType = stringOf(metadata.rule_type)
    if (
        !typed.failed &&
        allowedRuleTypes &&
        sentRuleId &&
        UUID_PATTERN.test(sentRuleId) &&
        sentRuleType &&
        allowedRuleTypes.indexOf(sentRuleType) !== -1
    ) {
        if (reasonCode !== EXPERIMENT_SPLIT_REASON) {
            // Only an experiment split assigns a variant.
            ruleId = sentRuleId
            ruleType = sentRuleType
        } else if (isString(metadata.variant_key)) {
            ruleId = sentRuleId
            ruleType = sentRuleType
            variantKey = metadata.variant_key
        }
    }
    return { reasonCode, ruleId, ruleType, variantKey }
}

/**
 * Builds the flag events of a read whose value a stored config version 2 record supplied.
 *
 * Returns `undefined` when `record` has no config version 2 attribution (see
 * {@link ruleAttribution}), or when it did not supply `response`. The stored flag values and the
 * stored records are separate properties, and other code can write the one without the other, so
 * a record supplied a value only when the legacy rendering of its typed value is that value. The
 * caller then sends its `$feature_flag_called` as before.
 *
 * `$feature_flag_called` gets the record's attribution in place of the human-readable
 * `$feature_flag_reason`. Its dedupe key is the response, the groups, the config version and the
 * attribution, so equal-valued A/A variants, successive experiments of one flag and a holdout
 * followed by a split of the same rule are each reported. `$experiment_exposure` is built for a
 * complete experiment split only. Its dedupe key is the event name, the groups, the config
 * version, the rule ID and the variant key, so one assignment sends one exposure however often it
 * is read. The value, request ID and evaluation time are left out of it. Both keys are stored per
 * flag key, next to the values that config version 1 calls are deduped by.
 */
export const configVersion2FlagEvents = (params: {
    key: string
    response: string | boolean
    groups: Readonly<Record<string, string>>
    record: FeatureFlagDetail | undefined
}): ConfigVersion2FlagEvents | undefined => {
    const { key, response, record } = params
    const attribution = ruleAttribution(record)
    if (!attribution || legacyValueOf(typedFlagDetailOf(record)!.value) !== response) {
        return undefined
    }
    const { reasonCode, ruleId, ruleType, variantKey } = attribution
    // Sorted by group type, so the order the groups were set in does not make a new key.
    const groups = Object.keys(params.groups)
        .sort()
        .map((type) => [type, params.groups[type]])

    const attributionProperties: Record<string, unknown> = { [CONFIG_VERSION]: 2 }
    if (reasonCode) {
        attributionProperties[REASON_CODE] = reasonCode
    }
    if (ruleId) {
        attributionProperties[RULE_ID] = ruleId
        attributionProperties[RULE_TYPE] = ruleType
    }
    const isSplit = isString(variantKey)
    if (isSplit) {
        attributionProperties[VARIANT_KEY] = variantKey
    }

    return {
        // A JSON array cannot equal a config version 1 entry, which is the response as a string.
        // `null` stands for an absent field.
        calledKey: JSON.stringify([
            response,
            groups,
            2,
            reasonCode || null,
            ruleId || null,
            ruleType || null,
            isSplit ? variantKey : null,
        ]),
        // The event name keeps this key apart from every `$feature_flag_called` key.
        exposureKey: isSplit ? JSON.stringify([EXPERIMENT_EXPOSURE_EVENT, groups, 2, ruleId, variantKey]) : undefined,
        build: (flagCalledProperties) => {
            const calledProperties: Record<string, unknown> = { ...flagCalledProperties, ...attributionProperties }
            delete calledProperties.$feature_flag_reason
            const called: FlagEvent = {
                event: FEATURE_FLAG_CALLED_EVENT,
                properties: calledProperties,
                capture: {
                    omit: FLAG_CALLED_NEVER_CARRIES.filter((name) => !(name in calledProperties)),
                    keep: ATTRIBUTION_PROPERTIES,
                },
            }
            if (!isSplit) {
                return { called, exposure: undefined }
            }
            const exposureProperties: Record<string, unknown> = {}
            for (const name of EXPOSURE_PROPERTIES_FROM_FLAG_CALLED) {
                if (!isUndefined(calledProperties[name])) {
                    exposureProperties[name] = calledProperties[name]
                }
            }
            exposureProperties.$feature_flag = key
            exposureProperties.$feature_flag_response = response
            exposureProperties[VARIANT_KEY] = variantKey
            exposureProperties[RULE_ID] = ruleId
            // The flags service evaluated the flag, as it does for every flag this SDK reads.
            exposureProperties.locally_evaluated = false
            return {
                called,
                exposure: {
                    event: EXPERIMENT_EXPOSURE_EVENT,
                    properties: exposureProperties,
                    capture: { omit: EXPOSURE_NEVER_CARRIES, keep: [] },
                },
            }
        },
    }
}
