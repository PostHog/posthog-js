import { EventHint, StackFrameModifierFn, StackParser } from './types'
import { addUncaughtExceptionListener, addUnhandledRejectionListener } from './autocapture'
import { PostHogBackendClient } from '../../client'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'
import { propertiesFromUnknownInput } from './error-conversion'
import { EventMessage, PostHogOptions } from '../../types'
import { BucketedRateLimiter } from '@posthog/core'

const SHUTDOWN_TIMEOUT = 2000

export default class ErrorTracking {
  private client: PostHogBackendClient
  private _exceptionAutocaptureEnabled: boolean
  private _rateLimiter: BucketedRateLimiter<string>
  private _logMsgIfDebug: (fn: () => void) => void

  static stackParser: StackParser
  static frameModifiers: StackFrameModifierFn[]

  static async buildEventMessage(
    error: unknown,
    hint: EventHint,
    distinctId?: string,
    additionalProperties?: Record<string | number, any>
  ): Promise<EventMessage> {
    const properties: EventMessage['properties'] = { ...additionalProperties }

    // Given stateless nature of Node SDK we capture exceptions using personless processing when no
    // user can be determined because a distinct_id is not provided e.g. exception autocapture
    if (!distinctId) {
      properties.$process_person_profile = false
    }

    const exceptionProperties = await propertiesFromUnknownInput(this.stackParser, this.frameModifiers, error, hint)

    return {
      event: '$exception',
      distinctId: distinctId || uuidv7(),
      properties: {
        ...exceptionProperties,
        ...properties,
      },
    }
  }

  constructor(client: PostHogBackendClient, options: PostHogOptions, logMsgIfDebug) {
    this.client = client
    this._exceptionAutocaptureEnabled = options.enableExceptionAutocapture || false
    this._logMsgIfDebug = logMsgIfDebug

    // by default captures ten exceptions before rate limiting by exception type
    // refills at a rate of one token / 10 second period
    // e.g. will capture 1 exception rate limited exception every 10 seconds until burst ends
    this._rateLimiter = new BucketedRateLimiter({
      refillRate: 1,
      bucketSize: 10,
      refillInterval: 10000, // ten seconds in milliseconds
    })

    this.startAutocaptureIfEnabled()
  }

  private startAutocaptureIfEnabled(): void {
    if (this.isEnabled()) {
      addUncaughtExceptionListener(this.onException.bind(this), this.onFatalError.bind(this))
      addUnhandledRejectionListener(this.onException.bind(this))
    }
  }

  private onException(exception: unknown, hint: EventHint): Promise<void> {
    return ErrorTracking.buildEventMessage(exception, hint).then((msg) => {
      const exceptionProperties = msg.properties
      const exceptionType = exceptionProperties?.$exception_list[0].type ?? 'Exception'
      const isRateLimited = this._rateLimiter.consumeRateLimit(exceptionType)

      if (isRateLimited) {
        this._logMsgIfDebug(() =>
          console.info('Skipping exception capture because of client rate limiting.', {
            exception: exceptionType,
          })
        )
        return
      }

      this.client.capture(msg)
    })
  }

  private async onFatalError(): Promise<void> {
    await this.client.shutdown(SHUTDOWN_TIMEOUT)
  }

  isEnabled(): boolean {
    return !this.client.isDisabled && this._exceptionAutocaptureEnabled
  }
}
