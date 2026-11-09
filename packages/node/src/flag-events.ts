import { FeatureFlagValue, minimizeFlagCalledEventProperties } from '@posthog/core'

import type { ParsedFlagRecord } from './flags-response'

/**
 * The flag events of one flag read: `$feature_flag_called` and, for a config version 2 experiment
 * split, `$experiment_exposure`.
 *
 * {@link buildConfigVersion2FlagEvents} builds both events and their dedupe keys in one step, from
 * the parsed `/flags` record that supplied the read's value and the read's `$feature_flag_called`
 * properties. It never reads the value the read returned, and it never evaluates or fetches flags.
 * A read whose record is not a readable config version 2 record gets no events from it, and the
 * client sends its `$feature_flag_called` event exactly as before.
 */

export const FEATURE_FLAG_CALLED_EVENT = '$feature_flag_called'
export const EXPERIMENT_EXPOSURE_EVENT = '$experiment_exposure'

// The reason code and rule type of the one outcome that sends `$experiment_exposure`: a variant
// assigned by an experiment rule.
const EXPERIMENT_SPLIT_REASON = 'experiment_split'
const EXPERIMENT_RULE_TYPE = 'experiment'

// The reason codes of a config version 2 record that report the rule that produced the result,
// and the rule types each one allows. Any other reason code, and any failed record, reports no
// rule, even when the record names one.
const RULE_TYPES_BY_REASON_CODE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['targeting_match', new Set(['targeted_release', 'percentage_rollout'])],
  [EXPERIMENT_SPLIT_REASON, new Set([EXPERIMENT_RULE_TYPE])],
  ['rollout_miss', new Set(['percentage_rollout', EXPERIMENT_RULE_TYPE])],
  ['experiment_paused', new Set([EXPERIMENT_RULE_TYPE])],
  ['holdout', new Set([EXPERIMENT_RULE_TYPE])],
])

/** The attribution a config version 2 `$feature_flag_called` carries, and keeps when minimized. */
export const CONFIG_VERSION_2_ATTRIBUTION_PROPERTIES: readonly string[] = [
  '$feature_flag_config_version',
  '$feature_flag_reason_code',
  '$feature_flag_rule_id',
  '$feature_flag_rule_type',
  '$feature_flag_variant',
]

// Properties a super or context property must not add to, or change on, a config version 2
// `$feature_flag_called`: the attribution, which is set again from the record, and the fields such
// an event never carries.
const CONFIG_VERSION_2_FLAG_CALLED_REMOVED: ReadonlySet<string> = new Set([
  ...CONFIG_VERSION_2_ATTRIBUTION_PROPERTIES,
  '$feature_flag_reason',
  '$feature_flag_forced_variant',
  '$feature_flag_experiment_id',
])

// Properties an `$experiment_exposure` never carries, even from a super or context property.
const EXPOSURE_REMOVED: ReadonlySet<string> = new Set([
  '$feature_flag_config_version',
  '$feature_flag_reason_code',
  '$feature_flag_rule_type',
  '$experiment_exposure_source',
  '$feature_flag_experiment_id',
  '$feature_flag_forced_variant',
])

// `$experiment_exposure` copies these from the `$feature_flag_called` of the same read, when it has
// them.
const EXPOSURE_PROPERTIES_FROM_FLAG_CALLED = [
  '$feature_flag_id',
  '$feature_flag_version',
  '$feature_flag_request_id',
  '$feature_flag_evaluated_at',
]

// The rule ID's wire format: a hyphenated UUID, as the contract's event schemas require.
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * What a config version 2 flag record reports on its flag events.
 *
 * @internal
 */
export type RuleAttribution = {
  readonly reasonCode: string | undefined
  readonly ruleId: string | undefined
  readonly ruleType: string | undefined
  /** Set only for a complete experiment split, the outcome that sends an exposure. */
  readonly variantKey: string | undefined
}

/**
 * Reads the event attribution of a config version 2 flag record.
 *
 * Returns `undefined` for anything else: no record, an unreadable record, a config version 1
 * record, or a record from a server without typed values.
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
 *
 * @internal
 */
export function ruleAttribution(record: ParsedFlagRecord | undefined): RuleAttribution | undefined {
  if (record === undefined || record.unreadableField !== undefined || record.metadata.configVersion !== 2) {
    return undefined
  }
  const reasonCode = record.reason?.code || undefined
  const noRule: RuleAttribution = { reasonCode, ruleId: undefined, ruleType: undefined, variantKey: undefined }
  const allowedRuleTypes = reasonCode === undefined ? undefined : RULE_TYPES_BY_REASON_CODE.get(reasonCode)
  if (record.failed || allowedRuleTypes === undefined) {
    return noRule
  }
  const { ruleId, ruleType, variantKey } = record.metadata
  if (ruleId === undefined || !UUID_PATTERN.test(ruleId) || ruleType === undefined || !allowedRuleTypes.has(ruleType)) {
    return noRule
  }
  if (reasonCode !== EXPERIMENT_SPLIT_REASON) {
    // Only an experiment split assigns a variant.
    return { ...noRule, ruleId, ruleType }
  }
  if (variantKey === undefined) {
    return noRule
  }
  return { reasonCode, ruleId, ruleType, variantKey }
}

/**
 * How the client captures a config version 2 flag event, after super and context properties are
 * merged: `removed` names are dropped, then `pinned` properties are set. A super property can
 * therefore neither change the event's attribution nor add a field the event never carries.
 *
 * @internal
 */
export type FlagEventCapture = {
  readonly removed: ReadonlySet<string>
  readonly pinned: Readonly<Record<string, unknown>>
}

/** @internal */
export function applyFlagEventCapture(properties: Record<string, any>, capture: FlagEventCapture): Record<string, any> {
  const kept = Object.fromEntries(Object.entries(properties).filter(([name]) => !capture.removed.has(name)))
  return { ...kept, ...capture.pinned }
}

/**
 * The minimal property set of a config version 2 `$feature_flag_called`: the shared allowlist plus
 * the config version 2 attribution. A config version 1 event keeps the shared allowlist alone.
 *
 * @internal
 */
export function minimizeConfigVersion2FlagCalledProperties(properties: Record<string, any>): Record<string, any> {
  const minimal = minimizeFlagCalledEventProperties(properties)
  for (const name of CONFIG_VERSION_2_ATTRIBUTION_PROPERTIES) {
    if (properties[name] !== undefined) {
      minimal[name] = properties[name]
    }
  }
  return minimal
}

/**
 * One flag event of a read, sent once per key in its own dedupe namespace.
 *
 * @internal
 */
export type FlagEvent = {
  readonly event: typeof FEATURE_FLAG_CALLED_EVENT | typeof EXPERIMENT_EXPOSURE_EVENT
  readonly dedupeKey: string
  readonly properties: Record<string, any>
  readonly capture: FlagEventCapture
}

/** @internal */
export type ConfigVersion2FlagEvents = {
  readonly flagCalled: FlagEvent
  /** Present only for a complete experiment split whose record supplied the read's value. */
  readonly exposure: FlagEvent | undefined
}

/**
 * Builds the flag events of a read whose value a config version 2 record supplied.
 *
 * Returns `undefined` when `record` has no config version 2 attribution (see
 * {@link ruleAttribution}), including when it is absent because the value came from local
 * evaluation, an override or no flag at all. The caller then sends its `$feature_flag_called` as
 * before.
 *
 * `$feature_flag_called` gets the record's attribution in place of the human-readable
 * `$feature_flag_reason`. Its dedupe key is the flag key, the response, the groups, the config
 * version and the attribution, so equal-valued A/A variants, successive experiments of one flag
 * and a holdout followed by a split of the same rule are each reported. `$experiment_exposure`
 * is built for a complete experiment split only. Its dedupe key is the groups, the flag key, the
 * config version, the rule ID and the variant key, so one assignment sends one exposure however
 * often it is read. The value, request ID and evaluation time are left out of it.
 *
 * @internal
 */
export function buildConfigVersion2FlagEvents(params: {
  key: string
  response: FeatureFlagValue | undefined
  groups: Record<string, string | number> | undefined
  properties: Record<string, any>
  record: ParsedFlagRecord | undefined
}): ConfigVersion2FlagEvents | undefined {
  const { key, response, groups, record } = params
  const attribution = ruleAttribution(record)
  if (attribution === undefined) {
    return undefined
  }
  const { reasonCode, ruleId, ruleType, variantKey } = attribution
  // Sorted by group type, as the `$feature_flag_called` tracker normalizes groups.
  const groupEntries = Object.entries(groups ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const attributionProperties: Record<string, unknown> = { $feature_flag_config_version: 2 }
  if (reasonCode !== undefined) {
    attributionProperties.$feature_flag_reason_code = reasonCode
  }
  if (ruleId !== undefined) {
    attributionProperties.$feature_flag_rule_id = ruleId
    attributionProperties.$feature_flag_rule_type = ruleType
  }
  if (variantKey !== undefined) {
    attributionProperties.$feature_flag_variant = variantKey
  }
  const { $feature_flag_reason: _reason, ...flagCalledProperties } = params.properties
  Object.assign(flagCalledProperties, attributionProperties)

  // A JSON array cannot equal a config version 1 key, which starts with the flag key, so the two
  // kinds of key never collide in one tracker. `null` stands for an absent field.
  const flagCalled: FlagEvent = {
    event: FEATURE_FLAG_CALLED_EVENT,
    dedupeKey: JSON.stringify([
      key,
      response ?? null,
      groupEntries,
      2,
      reasonCode ?? null,
      ruleId ?? null,
      ruleType ?? null,
      variantKey ?? null,
    ]),
    properties: flagCalledProperties,
    capture: { removed: CONFIG_VERSION_2_FLAG_CALLED_REMOVED, pinned: attributionProperties },
  }

  if (variantKey === undefined) {
    return { flagCalled, exposure: undefined }
  }

  const exposureIdentity: Record<string, unknown> = {
    $feature_flag: key,
    $feature_flag_response: response,
    $feature_flag_variant: variantKey,
    $feature_flag_rule_id: ruleId,
    locally_evaluated: flagCalledProperties.locally_evaluated === true,
  }
  const exposureProperties: Record<string, any> = {}
  for (const name of EXPOSURE_PROPERTIES_FROM_FLAG_CALLED) {
    if (flagCalledProperties[name] !== undefined) {
      exposureProperties[name] = flagCalledProperties[name]
    }
  }
  Object.assign(exposureProperties, exposureIdentity)

  return {
    flagCalled,
    exposure: {
      event: EXPERIMENT_EXPOSURE_EVENT,
      dedupeKey: JSON.stringify([key, groupEntries, 2, ruleId, variantKey]),
      properties: exposureProperties,
      capture: { removed: EXPOSURE_REMOVED, pinned: exposureIdentity },
    },
  }
}
