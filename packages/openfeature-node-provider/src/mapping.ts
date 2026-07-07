/**
 * Mapping between PostHog feature flag results and OpenFeature resolution
 * details for the **server** provider.
 *
 * `posthog-node`'s `getFeatureFlagResult` returns `{ key, enabled, variant?,
 * payload? }`, and this module turns that into the OpenFeature
 * `ResolutionDetails` shape (and the reserved-attribute context split).
 *
 * Everything is imported from `@openfeature/core` (a peer dependency shared by
 * the server SDK) so the error classes thrown here are the same identities the
 * active SDK catches.
 */
import {
  FlagNotFoundError,
  StandardResolutionReasons,
  TypeMismatchError,
  type EvaluationContext,
  type JsonValue,
  type ResolutionDetails,
  type ResolutionReason,
} from '@openfeature/core'

/**
 * The minimal flag-result shape returned by `posthog-node`'s
 * `getFeatureFlagResult`. The client's result structurally satisfies this, so
 * the SDK does not need to be imported here.
 */
export interface PostHogFlagResult {
  readonly key: string
  readonly enabled: boolean
  readonly variant?: string
  readonly payload?: unknown
}

/**
 * Reserved evaluation-context attribute keys. Every other attribute (besides
 * the standard `targetingKey`) is forwarded to PostHog as a person property.
 */
export const GROUPS_KEY = 'groups'
export const GROUP_PROPERTIES_KEY = 'groupProperties'

/** PostHog evaluation inputs derived from an OpenFeature evaluation context. */
export interface SplitContext {
  personProperties: Record<string, unknown>
  groups: Record<string, string>
  groupProperties: Record<string, Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Split an OpenFeature evaluation context into PostHog's evaluation inputs:
 *   - reserved `groups`            -> PostHog `groups`
 *   - reserved `groupProperties`   -> PostHog `groupProperties`
 *   - every other attribute        -> PostHog `personProperties`
 *
 * `targetingKey` is consumed separately (as the distinct id) and never becomes
 * a person property.
 */
export function splitContext(context?: EvaluationContext): SplitContext {
  if (!context) {
    return { personProperties: {}, groups: {}, groupProperties: {} }
  }
  const {
    targetingKey: _targetingKey,
    [GROUPS_KEY]: rawGroups,
    [GROUP_PROPERTIES_KEY]: rawGroupProperties,
    ...rest
  } = context
  return {
    personProperties: rest,
    groups: isRecord(rawGroups) ? (rawGroups as Record<string, string>) : {},
    groupProperties: isRecord(rawGroupProperties)
      ? (rawGroupProperties as Record<string, Record<string, unknown>>)
      : {},
  }
}

/**
 * Map PostHog's enabled state to an OpenFeature reason. PostHog's JS
 * `FeatureFlagResult` carries no free-text reason (unlike the Python client), so
 * an enabled flag means a targeting condition matched and a disabled one falls
 * back to the default rollout.
 */
function reasonFor(result: PostHogFlagResult): ResolutionReason {
  return result.enabled ? StandardResolutionReasons.TARGETING_MATCH : StandardResolutionReasons.DEFAULT
}

/**
 * A `undefined` result means the flag does not exist (or was archived) —
 * `getFeatureFlagResult` returns a populated result with `enabled: false` for a
 * flag that exists but did not match. Surface the former as the OpenFeature
 * `FLAG_NOT_FOUND` error so callers get their default value.
 */
function ensureResolved(result: PostHogFlagResult | undefined, flagKey: string): PostHogFlagResult {
  if (result == null) {
    throw new FlagNotFoundError(`Flag '${flagKey}' not found.`)
  }
  return result
}

export function resolveBooleanDetails(
  result: PostHogFlagResult | undefined,
  flagKey: string
): ResolutionDetails<boolean> {
  const resolved = ensureResolved(result, flagKey)
  return { value: resolved.enabled, variant: resolved.variant, reason: reasonFor(resolved) }
}

export function resolveStringDetails(
  result: PostHogFlagResult | undefined,
  flagKey: string,
  defaultValue: string
): ResolutionDetails<string> {
  const resolved = ensureResolved(result, flagKey)
  if (resolved.variant === undefined) {
    if (!resolved.enabled) {
      // A disabled or unmatched flag has no variant. Resolve to the caller's
      // default (per the OpenFeature spec) rather than throwing — a throw would
      // set reason=ERROR and fire every registered error hook on an ordinary
      // disabled-flag read.
      return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT }
    }
    // An enabled boolean flag has no string variant: a genuine type mismatch.
    throw new TypeMismatchError(`Flag '${flagKey}' has no string variant (boolean flag).`)
  }
  return { value: resolved.variant, variant: resolved.variant, reason: reasonFor(resolved) }
}

export function resolveNumberDetails(
  result: PostHogFlagResult | undefined,
  flagKey: string,
  defaultValue: number
): ResolutionDetails<number> {
  const resolved = ensureResolved(result, flagKey)
  if (resolved.variant === undefined) {
    if (!resolved.enabled) {
      return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT }
    }
    throw new TypeMismatchError(`Flag '${flagKey}' has no variant to parse as a number.`)
  }
  const value = Number(resolved.variant)
  if (!Number.isFinite(value)) {
    throw new TypeMismatchError(`Flag '${flagKey}' variant '${resolved.variant}' is not a valid number.`)
  }
  return { value, variant: resolved.variant, reason: reasonFor(resolved) }
}

export function resolveObjectDetails<T extends JsonValue>(
  result: PostHogFlagResult | undefined,
  flagKey: string,
  defaultValue: T
): ResolutionDetails<T> {
  const resolved = ensureResolved(result, flagKey)
  const payload = resolved.payload
  if (typeof payload !== 'object' || payload === null) {
    if (!resolved.enabled) {
      return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT }
    }
    throw new TypeMismatchError(`Flag '${flagKey}' has no object/JSON payload.`)
  }
  return { value: payload as T, variant: resolved.variant, reason: reasonFor(resolved) }
}
