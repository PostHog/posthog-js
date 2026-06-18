import { DO_NOT_TRACK_ENV, TELEMETRY_DEBUG_ENV, TELEMETRY_DISABLED_ENV } from './constants'

type EnvLike = Record<string, string | undefined>

function isTruthy(value: string | undefined): boolean {
    if (value === undefined) {
        return false
    }
    const normalized = value.trim().toLowerCase()
    return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

/**
 * Whether telemetry is allowed to be sent. Honors the cross-tool `DO_NOT_TRACK`
 * convention and the PostHog-specific `POSTHOG_CLI_TELEMETRY_DISABLED`, and lets
 * the host force-disable in code via `override === false`. Either opt-out env var
 * being truthy disables capture.
 *
 * This is consulted at the single sink chokepoint, so an opt-out applies to
 * every event regardless of which capture method produced it.
 */
export function isTelemetryEnabled(env: EnvLike = process.env, override?: boolean): boolean {
    if (override === false) {
        return false
    }
    if (isTruthy(env[DO_NOT_TRACK_ENV]) || isTruthy(env[TELEMETRY_DISABLED_ENV])) {
        return false
    }
    return true
}

/**
 * Whether debug mode is on. In debug mode the SDK prints each event payload to
 * stderr and sends nothing — the standard CLI transparency affordance, so users
 * (and reviewers) can see exactly what would be captured.
 */
export function isDebugMode(env: EnvLike = process.env): boolean {
    return isTruthy(env[TELEMETRY_DEBUG_ENV])
}
