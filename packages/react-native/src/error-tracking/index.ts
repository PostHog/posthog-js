import {
  chromeStackLineParser,
  ErrorCoercer,
  ErrorPropertiesBuilder,
  EventHint,
  geckoStackLineParser,
  ObjectCoercer,
  PrimitiveCoercer,
  PromiseRejectionEventCoercer,
  SeverityLevel,
  StringCoercer,
} from '@posthog/core/error-tracking'
import type { PostHog } from '../posthog-rn'
import { Logger, PostHogEventProperties } from '@posthog/core'
import { trackUncaughtExceptions, trackUnhandledRejections } from './utils'

interface AutocaptureOptions {
  uncaughtExceptions?: boolean
  unhandledRejections?: boolean
}

export interface ErrorTrackingOptions {
  autocapture?: AutocaptureOptions | boolean
}

export class ErrorTracking {
  private errorPropertiesBuilder: ErrorPropertiesBuilder
  private logger: Logger

  constructor(
    private instance: PostHog,
    options: ErrorTrackingOptions = {},
    logger: Logger
  ) {
    this.errorPropertiesBuilder = new ErrorPropertiesBuilder(
      [
        new PromiseRejectionEventCoercer(),
        new ErrorCoercer(),
        new ObjectCoercer(),
        new StringCoercer(),
        new PrimitiveCoercer(),
      ],
      [chromeStackLineParser, geckoStackLineParser]
    )
    this.logger = logger.createLogger('[ErrorTracking]')
    const autocaptureOptions = this.resolveAutocaptureOptions(options.autocapture)
    this.autocapture(autocaptureOptions)
  }

  captureException(input: unknown, additionalProperties: PostHogEventProperties, hint: EventHint) {
    try {
      const properties = this.errorPropertiesBuilder.buildFromUnknown(input, hint)
      return this.instance.capture('$exception', {
        ...properties,
        ...additionalProperties,
      } as unknown as PostHogEventProperties)
    } catch (error) {
      this.logger.error('An error occurred while capturing an $exception event:', error)
    }
  }

  private resolveAutocaptureOptions(autocapture: AutocaptureOptions | boolean = false): AutocaptureOptions {
    if (typeof autocapture === 'boolean') {
      return {
        uncaughtExceptions: autocapture,
        unhandledRejections: autocapture,
      }
    }
    return {
      uncaughtExceptions: !!autocapture.uncaughtExceptions,
      unhandledRejections: !!autocapture.unhandledRejections,
    }
  }

  private autocaptureUncaughtErrors() {
    const onUncaughtException = (error: unknown, isFatal: boolean) => {
      const hint: EventHint = {
        mechanism: {
          type: 'onuncaughtexception',
          handled: false,
        },
      }
      const additionalProperties: any = {}
      if (isFatal) {
        additionalProperties['$exception_level'] = 'fatal' as SeverityLevel
      }
      this.captureException(error, additionalProperties, hint)
    }
    try {
      trackUncaughtExceptions(onUncaughtException)
    } catch (err) {
      this.logger.warn('Failed to track uncaught exceptions: ', err)
    }
  }

  private autocaptureUnhandledRejections() {
    const onUnhandledRejection = (error: unknown) => {
      const hint: EventHint = {
        mechanism: {
          type: 'onunhandledrejection',
          handled: false,
        },
      }
      this.captureException(error, {}, hint)
    }

    try {
      trackUnhandledRejections(onUnhandledRejection)
    } catch (err) {
      this.logger.warn('Failed to track unhandled rejections: ', err)
    }
  }

  private autocapture(autocaptureOptions: AutocaptureOptions = {}) {
    if (autocaptureOptions.uncaughtExceptions === true) {
      this.autocaptureUncaughtErrors()
    }
    if (autocaptureOptions.unhandledRejections === true) {
      this.autocaptureUnhandledRejections()
    }
  }
}
