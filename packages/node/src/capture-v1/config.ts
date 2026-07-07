/** Capture submission mode: `v0` is the legacy `/batch/` endpoint, `v1` is `/i/v1/analytics/events`. */
export type CaptureMode = 'v0' | 'v1'

function isCaptureMode(value: unknown): value is CaptureMode {
  return value === 'v0' || value === 'v1'
}

/**
 * Resolve the effective capture mode. The explicit option wins; otherwise the
 * `POSTHOG_CAPTURE_MODE` environment variable is consulted (guarded for edge /
 * no-`process` runtimes); the default is `v0`, so existing users are unaffected
 * until they opt in.
 */
export function resolveCaptureMode(optionMode?: CaptureMode): CaptureMode {
  if (isCaptureMode(optionMode)) {
    return optionMode
  }
  const envMode = typeof process !== 'undefined' ? process.env?.POSTHOG_CAPTURE_MODE : undefined
  if (isCaptureMode(envMode)) {
    return envMode
  }
  return 'v0'
}
