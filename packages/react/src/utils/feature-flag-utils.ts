/* oxlint-disable no-console */
import { isBoolean, isNull, isString, isUndefined } from './type-utils'

const warnedFlags = new Set<string>()

function warnOnce(flag: string, message: string): void {
    if (warnedFlags.has(flag)) {
        return
    }
    warnedFlags.add(flag)
    console.warn(`[PostHog.js] Invalid bootstrapped value for feature flag "${flag}": ${message}`)
}

/**
 * Bootstrapped flag values must be a variant string or a boolean. Apps that pass the
 * `/flags?v=2` detail shape (`{ key, enabled, variant }`) are flattened to the value the
 * detail describes, because returning the object mis-buckets the user with no other signal.
 */
export function normalizeBootstrappedFlagValue(flag: string, value: unknown): string | boolean | undefined {
    if (isUndefined(value) || isString(value) || isBoolean(value)) {
        return value
    }

    if (typeof value === 'object' && !isNull(value)) {
        const detail = value as { enabled?: unknown; variant?: unknown }
        if (isBoolean(detail.enabled) || isString(detail.variant)) {
            const flattened = isString(detail.variant) ? detail.variant : !!detail.enabled
            warnOnce(
                flag,
                `expected a variant string or a boolean, got a flag detail object. Using ${JSON.stringify(
                    flattened
                )} instead. Pass \`variant ?? enabled\` in \`bootstrap.featureFlags\`.`
            )
            return flattened
        }
    }

    warnOnce(flag, `expected a variant string or a boolean, got ${typeof value}. Ignoring it.`)
    return undefined
}
