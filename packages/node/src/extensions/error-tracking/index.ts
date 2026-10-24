import { addUncaughtExceptionListener, addUnhandledRejectionListener } from './autocapture'
import { PostHogBackendClient } from '@/client'
import { isObject } from '@posthog/core'
import { EventMessage, PostHogOptions } from '@/types'
import type { Logger } from '@posthog/core'
import { BucketedRateLimiter, resolveExceptionRateLimiterConfig } from '@posthog/core'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

const SHUTDOWN_TIMEOUT = 2000

/**
 * Exception properties that the SDK or PostHog owns (sdk-specs `exception-event-metadata`), so
 * a caller's properties never set them.
 */
const RESERVED_EXCEPTION_PROPERTIES: ReadonlySet<string> = new Set([
  '$exception_list',
  '$exception_level',
  '$exception_source',
  '$debug_images',
  '$exception_types',
  '$exception_values',
  '$exception_sources',
  '$exception_functions',
  '$exception_fingerprint_version',
  '$exception_fingerprint_record',
  '$exception_issue_id',
  '$exception_release',
  '$cymbal_errors',
])

/** The `$exception_level` values a caller may set (sdk-specs `exception-event-metadata`). */
const EXCEPTION_LEVELS: ReadonlySet<string> = new Set<CoreErrorTracking.SeverityLevel>([
  'fatal',
  'error',
  'warning',
  'log',
  'info',
  'debug',
])

export default class ErrorTracking {
  private client: PostHogBackendClient
  private _exceptionAutocaptureEnabled: boolean
  private _rateLimiter: BucketedRateLimiter<string>
  private _logger: Logger

  constructor(client: PostHogBackendClient, options: PostHogOptions, _logger: Logger) {
    this.client = client
    this._exceptionAutocaptureEnabled = options.enableExceptionAutocapture || false
    this._logger = _logger

    // Burst protection is scoped PER EXCEPTION TYPE: the rate limiter is keyed by exception type
    // (see `consumeRateLimit(exceptionType)` below), so each distinct type gets its own fresh
    // token bucket. There is no aggregate cap across all types — a burst made up of many distinct
    // types is not throttled in total, only per individual type.
    //
    // By default each exception type captures ten exceptions before being rate limited, then
    // refills at a rate of one token / 10 second period (e.g. captures 1 rate-limited exception of
    // that type every 10 seconds until the burst ends). The bucket size and refill rate can be
    // tuned via the `exceptionRateLimiterBucketSize` and `exceptionRateLimiterRefillRate`
    // options.
    this._rateLimiter = new BucketedRateLimiter({
      ...resolveExceptionRateLimiterConfig(options),
      refillInterval: 10000, // ten seconds in milliseconds
      _logger: this._logger,
    })

    this.startAutocaptureIfEnabled()
  }

  static isPreviouslyCapturedError(x: unknown): boolean {
    return isObject(x) && '__posthog_previously_captured_error' in x && x.__posthog_previously_captured_error === true
  }

  static async buildEventMessage(
    builder: CoreErrorTracking.ErrorPropertiesBuilder,
    error: unknown,
    hint: CoreErrorTracking.EventHint,
    distinctId?: string,
    additionalProperties?: Record<string | number, any>,
    level?: CoreErrorTracking.SeverityLevel
  ): Promise<EventMessage> {
    const properties: EventMessage['properties'] = {}
    for (const [key, value] of Object.entries(additionalProperties ?? {})) {
      if (!RESERVED_EXCEPTION_PROPERTIES.has(key)) {
        properties[key] = value
      }
    }

    const exceptionProperties = builder.buildFromUnknown(error, hint)
    exceptionProperties.$exception_list = await builder.modifyFrames(exceptionProperties.$exception_list)
    if (level !== undefined && EXCEPTION_LEVELS.has(level)) {
      exceptionProperties.$exception_level = level
    }

    return {
      event: '$exception',
      // The client resolves a missing id: the context id, else a personless id.
      distinctId: distinctId,
      properties: {
        ...exceptionProperties,
        ...properties,
      },
      _originatedFromCaptureException: true,
    }
  }

  private startAutocaptureIfEnabled(): void {
    if (this.isEnabled()) {
      addUncaughtExceptionListener(this.onException.bind(this), this.onFatalError.bind(this))
      addUnhandledRejectionListener(this.onException.bind(this))
    }
  }

  private onException(exception: unknown, hint: CoreErrorTracking.EventHint): void {
    this.client.addPendingPromise(
      (async () => {
        if (!ErrorTracking.isPreviouslyCapturedError(exception)) {
          const eventMessage = await ErrorTracking.buildEventMessage(
            this.client.getErrorPropertiesBuilder(),
            exception,
            hint
          )
          const exceptionProperties = eventMessage.properties
          const exceptionType = exceptionProperties?.$exception_list[0]?.type ?? 'Exception'
          const isRateLimited = this._rateLimiter.consumeRateLimit(exceptionType)
          if (isRateLimited) {
            this._logger.info('Skipping exception capture because of client rate limiting.', {
              exception: exceptionType,
            })
            return
          }
          return this.client._capturePreparedEvent(eventMessage, false)
        }
      })()
    )
  }

  private async onFatalError(exception: Error): Promise<void> {
    console.error(exception)
    await this.client.shutdown(SHUTDOWN_TIMEOUT)
    globalThis.process.exit(1)
  }

  isEnabled(): boolean {
    return !this.client.isDisabled && this._exceptionAutocaptureEnabled
  }

  shutdown(): void {
    this._rateLimiter.stop()
  }
}
