import type { PostHogOptions } from '../types'

export const DEFAULT_CAPTURE_MAX_RETRIES = 3
export const MAX_CAPTURE_MAX_RETRIES = 9

/** Capture settings resolved once per client from `PostHogOptions`. */
export interface CaptureSettings {
  /** Retries after the first attempt, for both lanes. */
  maxRetries: number
}

const isIntegerInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/**
 * Validates the capture options. An invalid value is reported once through `logInvalid` and
 * behaves as if it were not set, so a bad option never throws.
 */
export function resolveCaptureSettings(
  options: PostHogOptions,
  logInvalid: (message: string) => void
): CaptureSettings {
  return { maxRetries: resolveMaxRetries(options, logInvalid) }
}

function resolveMaxRetries(options: PostHogOptions, logInvalid: (message: string) => void): number {
  const { captureMaxRetries, fetchRetryCount } = options
  if (captureMaxRetries != null) {
    if (isIntegerInRange(captureMaxRetries, 0, MAX_CAPTURE_MAX_RETRIES)) {
      return captureMaxRetries
    }
    logInvalid(`captureMaxRetries must be an integer from 0 to ${MAX_CAPTURE_MAX_RETRIES}; using the default.`)
  }
  // fetchRetryCount also configures other requests, so an out-of-range value is clamped for capture, not reported.
  if (typeof fetchRetryCount === 'number' && Number.isFinite(fetchRetryCount)) {
    return Math.min(Math.max(Math.trunc(fetchRetryCount), 0), MAX_CAPTURE_MAX_RETRIES)
  }
  return DEFAULT_CAPTURE_MAX_RETRIES
}
