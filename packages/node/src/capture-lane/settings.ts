import { CAPTURE_COMPRESSIONS, type CaptureCompression } from '../capture-v1/compression'
import type { PostHogOptions } from '../types'

export const DEFAULT_CAPTURE_MAX_RETRIES = 3
export const MAX_CAPTURE_MAX_RETRIES = 9
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 30_000
export const DEFAULT_AI_MAX_QUEUE_SIZE = 1000

/** Capture settings resolved once per client from `PostHogOptions`. */
export interface CaptureSettings {
  /** Retries after the first attempt, for both lanes. */
  maxRetries: number
  analytics: CaptureLaneSettings
  ai: CaptureLaneSettings & {
    /** Queued AI events; the analytics queue size stays a client setting. */
    maxQueueSize: number
  }
}

export interface CaptureLaneSettings {
  /** The requested body encoding; the runtime may not support it. */
  compression: CaptureCompression
  requestTimeoutMs: number
}

type LogInvalid = (message: string) => void

const isIntegerInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/**
 * Validates the capture options. An invalid value is reported once through `logInvalid` and
 * behaves as if it were not set, so a bad option never throws.
 */
export function resolveCaptureSettings(options: PostHogOptions, logInvalid: LogInvalid): CaptureSettings {
  return {
    maxRetries: resolveMaxRetries(options, logInvalid),
    analytics: {
      compression:
        resolveCompression('captureCompression', options.captureCompression, logInvalid) ??
        (options.disableCompression ? 'none' : 'gzip'),
      requestTimeoutMs: options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS,
    },
    ai: {
      // The AI lane does not read captureCompression or disableCompression.
      compression: resolveCompression('captureAiCompression', options.captureAiCompression, logInvalid) ?? 'gzip',
      requestTimeoutMs: resolvePositive(
        'captureAiRequestTimeoutMs',
        options.captureAiRequestTimeoutMs,
        DEFAULT_AI_REQUEST_TIMEOUT_MS,
        logInvalid,
        { integer: false }
      ),
      maxQueueSize: resolvePositive(
        'captureAiMaxQueueSize',
        options.captureAiMaxQueueSize,
        DEFAULT_AI_MAX_QUEUE_SIZE,
        logInvalid,
        { integer: true }
      ),
    },
  }
}

function resolveCompression(name: string, value: unknown, logInvalid: LogInvalid): CaptureCompression | undefined {
  if (value == null) {
    return undefined
  }
  if ((CAPTURE_COMPRESSIONS as readonly unknown[]).includes(value)) {
    return value as CaptureCompression
  }
  logInvalid(
    `${name} must be one of ${CAPTURE_COMPRESSIONS.map((codec) => `'${codec}'`).join(', ')}; using the default.`
  )
  return undefined
}

function resolvePositive(
  name: string,
  value: unknown,
  fallback: number,
  logInvalid: LogInvalid,
  { integer }: { integer: boolean }
): number {
  if (value == null) {
    return fallback
  }
  if (typeof value === 'number' && value > 0 && (integer ? Number.isSafeInteger(value) : Number.isFinite(value))) {
    return value
  }
  logInvalid(`${name} must be a positive ${integer ? 'integer' : 'number'}; using the default.`)
  return fallback
}

function resolveMaxRetries(options: PostHogOptions, logInvalid: LogInvalid): number {
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
