/* oxlint-disable no-console */
import { isBoolean, isObject, isString, isUndefined } from './type-utils'

// Hooks re-run on every render, so a flag is only warned about once.
const warnedFlags = new Set<string>()

/**
 * Bootstrapped flag values must be a variant string or a boolean. Apps that pass the
 * `/flags?v=2` detail shape (`{ key, enabled, variant }`) are flattened to the value the
 * detail describes, because returning the object mis-buckets the user with no other signal.
 */
export function normalizeBootstrappedFlagValue(flag: string, value: unknown): string | boolean | undefined {
    if (isUndefined(value) || isString(value) || isBoolean(value)) {
        return value
    }

    let flattened: string | boolean | undefined
    if (isObject(value) && (isBoolean(value.enabled) || isString(value.variant))) {
        flattened = isString(value.variant) ? value.variant : !!value.enabled
    }

    if (!warnedFlags.has(flag)) {
        warnedFlags.add(flag)
        console.warn(
            `[PostHog.js] Invalid bootstrapped value for feature flag "${flag}": expected a variant string or a boolean. ` +
                (isUndefined(flattened) ? 'Ignoring it.' : `Using ${JSON.stringify(flattened)} from the flag detail.`)
        )
    }
    return flattened
}
