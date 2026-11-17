import { capturePendingExceptions, claimExplicitCapture, startExceptionAutocapture } from './autocapture'
import type { AutocaptureClient } from './autocapture'
import { PostHogBackendClient } from '@/client'
import type { ContextData } from '../context/types'
import { snapshotEventContext } from '../context/event-context'
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

/**
 * The `$exception_level` values a caller may set (sdk-specs `exception-event-metadata`), read
 * case-insensitively with the same aliases as posthog-python. Any other value keeps the default.
 */
const EXCEPTION_LEVELS: ReadonlyMap<string, CoreErrorTracking.SeverityLevel> = new Map([
  ['fatal', 'fatal'],
  ['critical', 'fatal'],
  ['alert', 'fatal'],
  ['emergency', 'fatal'],
  ['error', 'error'],
  ['warning', 'warning'],
  ['warn', 'warning'],
  ['log', 'log'],
  ['notice', 'info'],
  ['info', 'info'],
  ['trace', 'debug'],
  ['debug', 'debug'],
])

export default class ErrorTracking {
  private client: PostHogBackendClient
  private _exceptionAutocaptureEnabled: boolean
  private _rateLimiter: BucketedRateLimiter<string>
  private _logger: Logger
  private _autocaptureClient?: AutocaptureClient
  private _stopAutocapture?: () => void

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
    level?: CoreErrorTracking.SeverityLevel,
    context?: ContextData
  ): Promise<EventMessage> {
    const applyContextSnapshot = snapshotEventContext(context)
    const properties: EventMessage['properties'] = {}
    for (const [key, value] of Object.entries(additionalProperties ?? {})) {
      if (!RESERVED_EXCEPTION_PROPERTIES.has(key)) {
        properties[key] = value
      }
    }

    const exceptionProperties = builder.buildFromUnknown(error, hint)
    exceptionProperties.$exception_list = await builder.modifyFrames(exceptionProperties.$exception_list)
    const exceptionLevel = typeof level === 'string' ? EXCEPTION_LEVELS.get(level.toLowerCase()) : undefined
    if (exceptionLevel !== undefined) {
      exceptionProperties.$exception_level = exceptionLevel
    }

    return applyContextSnapshot({
      event: '$exception',
      // The client resolves a missing id: the context id, else a personless id.
      distinctId: distinctId,
      properties: {
        ...exceptionProperties,
        ...properties,
      },
      _originatedFromCaptureException: true,
    })
  }

  // Clients with the same project token and host send to the same project.
  private get destinationKey(): string {
    return `${this.client.apiKey}@${this.client.host}`
  }

  private startAutocaptureIfEnabled(): void {
    if (this.isEnabled()) {
      this._autocaptureClient = {
        key: this.destinationKey,
        capture: (exception, hint) => this.onException(exception, hint),
        getContext: () => this.client.getContext(),
        flush: () => this.client.flush(),
        shutdown: () => this.client.shutdown(SHUTDOWN_TIMEOUT),
      }
      this._stopAutocapture = startExceptionAutocapture(this._autocaptureClient)
    }
  }

  /**
   * Whether captureException should capture this error. False when exception autocapture already sent the same error
   * object to this project in this turn of the event loop, for example when a framework passes an error from its own
   * process listener to an error hook that calls captureException.
   */
  claimExplicitCapture(error: unknown): boolean {
    return claimExplicitCapture(error, this.destinationKey)
  }

  /**
   * Captures at once the exceptions autocapture holds until the end of the turn, so that this client's flush or
   * shutdown sends them: an app's crash handler often flushes or shuts the client down and exits before the turn ends.
   * The capture can land in another client of the project, the one whose request context is active, so this client
   * waits for that client's flush too.
   */
  capturePendingExceptions(): void {
    for (const owner of capturePendingExceptions()) {
      if (owner !== this._autocaptureClient) {
        void this.client.addPendingPromise(owner.flush().catch(() => undefined))
      }
    }
  }

  private onException(exception: unknown, hint: CoreErrorTracking.EventHint): void {
    this.client.addPendingPromise(
      (async () => {
        if (!ErrorTracking.isPreviouslyCapturedError(exception)) {
          const eventMessage = await ErrorTracking.buildEventMessage(
            this.client.getErrorPropertiesBuilder(),
            exception,
            hint,
            undefined,
            undefined,
            undefined,
            this.client.getContext()
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
      })().catch((error) => {
        // shutdown() waits for every pending promise and stops before it flushes if one rejects, so an error that
        // cannot be turned into an event would take the others down with it.
        this._logger.error('Failed to capture an exception:', error)
      })
    )
  }

  isEnabled(): boolean {
    return !this.client.isDisabled && this._exceptionAutocaptureEnabled
  }

  shutdown(): void {
    this._rateLimiter.stop()
    this.capturePendingExceptions()
    this._stopAutocapture?.()
    this._stopAutocapture = undefined
  }
}
